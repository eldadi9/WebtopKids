import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load .env (Node doesn't load it automatically) ──────────────────────────
function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  try {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch (e) { console.warn('[env] Load failed:', e.message); }
}
loadEnv();
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT             = process.env.PORT || 3000;
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

const STATUS_FILE         = join(__dirname, 'homework_status.json');
const DATA_CACHE_FILE     = join(__dirname, 'data_cache.json');
const SPECIAL_EVENTS_FILE = join(__dirname, 'special_events.json');
const REMINDERS_FILE      = join(__dirname, 'sent_reminders.json'); // persists across PM2 restarts
const CHILDREN_CONFIG_FILE = join(__dirname, 'children_config.json');
const EXTERNAL_LINKS_FILE  = join(__dirname, 'external_links.json');

// ─── In-memory cache ──────────────────────────────────────────────────────────
let cache = { data: null, timestamp: 0 };

// ─── Trigger flag (phone → VPS → home machine) ────────────────────────────────
let triggerPending = false;
let triggerRequestedAt = null;

// ─── Homework status persistence ──────────────────────────────────────────────
function loadStatus() {
  try {
    if (existsSync(STATUS_FILE)) return JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
  } catch {}
  return {};
}
function saveStatus(status) {
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

// ─── Persistent data cache (survives PM2 restart) ─────────────────────────────
function loadCacheFromFile() {
  try {
    if (!existsSync(DATA_CACHE_FILE)) return;
    const saved = JSON.parse(readFileSync(DATA_CACHE_FILE, 'utf8'));
    if (saved?.data) {
      cache = { data: saved.data, timestamp: saved.timestamp || Date.now() };
      const ageMin = Math.round((Date.now() - cache.timestamp) / 1000 / 60);
      console.log(`[cache] Loaded from disk — ${ageMin} min old`);
    }
  } catch (e) {
    console.warn('[cache] Failed to load from disk:', e.message);
  }
}
function saveCacheToFile() {
  try { writeFileSync(DATA_CACHE_FILE, JSON.stringify(cache)); }
  catch (e) { console.warn('[cache] Failed to save to disk:', e.message); }
}

// ─── Special events (birthdays, parent meetings) ──────────────────────────────
function loadSpecialEvents() {
  try {
    if (existsSync(SPECIAL_EVENTS_FILE))
      return JSON.parse(readFileSync(SPECIAL_EVENTS_FILE, 'utf8'));
  } catch {}
  return [];
}

// ─── Per-child configuration (subjects, grade, birthdate) ─────────────────────
function loadChildrenConfig() {
  try {
    if (existsSync(CHILDREN_CONFIG_FILE))
      return JSON.parse(readFileSync(CHILDREN_CONFIG_FILE, 'utf8'));
  } catch {}
  return { children: [] };
}

// ─── Sent-reminders persistence (survive PM2 restart — avoid re-alerting) ─────
function loadSentReminders() {
  try {
    if (existsSync(REMINDERS_FILE))
      return new Set(JSON.parse(readFileSync(REMINDERS_FILE, 'utf8')));
  } catch {}
  return new Set();
}
function saveSentReminders() {
  try { writeFileSync(REMINDERS_FILE, JSON.stringify([...sentReminders])); }
  catch {}
}

const sentReminders = loadSentReminders(); // ← persisted across restarts

// ─── ID helpers ───────────────────────────────────────────────────────────────
function hwId(n) { return `${(n.subject || '').trim()}_${(n.date || '').trim()}_${(n.lesson || '')}`; }
// Normalized — trim all parts to avoid duplicate alerts when scrape returns slight variations
function notifId(n) {
  return `${(n.type || '').trim()}_${(n.student || '').trim()}_${(n.subject || '').trim()}_${(n.date || '').trim()}_${(n.lesson || '')}`;
}

// ─── Scraper runner ───────────────────────────────────────────────────────────
function runScraper() {
  return new Promise((resolve, reject) => {
    const scraperPath = join(__dirname, 'webtop_scrape.mjs');
    const env = { ...process.env, WEBTOP_SESSION: join(__dirname, '.webtop_session.json') };
    const proc = spawn(process.execPath, [scraperPath], { env, cwd: __dirname });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => (stdout += d));
    proc.stderr.on('data', d => (stderr += d));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 500)}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error(`JSON parse failed: ${stdout.slice(0, 300)}`)); }
    });
  });
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}

// ─── New-alert Telegram sender ────────────────────────────────────────────────
// Fires IMMEDIATELY when a push arrives with notifications not seen before.
// Covers: late, absence, missing_equipment, grade, homework_not_done, homework
const ALERT_EMOJI = {
  late:              '⏰',
  absence:           '🚫',
  missing_equipment: '🎒',
  grade:             '⭐',
  homework_not_done: '📚',
  homework:          '📚',
};
const ALERT_NAME = {
  late:              'איחור',
  absence:           'חיסור',
  missing_equipment: 'ציוד חסר',
  grade:             'ציון חדש',
  homework_not_done: 'שיעורי בית לא הוכנו',
  homework:          'שיעורי בית חדשים',
};
const ALERT_TYPES_SET = new Set([
  'late', 'absence', 'missing_equipment', 'grade', 'homework_not_done', 'homework',
]);

async function sendNewAlerts(newNotifications, prevIds) {
  for (const n of newNotifications) {
    if (!ALERT_TYPES_SET.has(n.type)) continue;
    if (prevIds.has(notifId(n))) continue; // not new

    // Skip impossible absences (before 7am — school doesn't open that early)
    if (n.type === 'absence' && n.alertTime) {
      const alertH = parseInt(n.alertTime.split(':')[0], 10);
      if (!isNaN(alertH) && alertH < 7) {
        console.log(`[alert] Skipped impossible absence at ${n.alertTime} — ${n.student}/${n.date}`);
        continue;
      }
    }
    // Skip stale non-grade alerts (>7 days old) — only new notifications
    if (n.type !== 'grade' && n.date) {
      const [dd, mm, yyyy] = n.date.split('/').map(Number);
      if (dd && mm && yyyy) {
        const nDate   = new Date(yyyy, mm - 1, dd);
        const daysOld = Math.round((Date.now() - nDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld > 7) {
          console.log(`[alert] Skipped stale alert (${daysOld}d old) — ${n.type} / ${n.subject}`);
          continue;
        }
        // Skip homework past due — לא שיעורי בית שכבר עבר מועד הגשה
        if (n.type === 'homework' && daysOld > 0) {
          console.log(`[alert] Skipped past-due homework — ${n.subject} / ${n.date}`);
          continue;
        }
      }
    }

    const emoji = ALERT_EMOJI[n.type] || '⚠️';
    const name  = ALERT_NAME[n.type]  || n.type;

    const lines = [
      `${emoji} <b>התראה חדשה — ${name}!</b>`,
      '',
      n.student  ? `👤 תלמיד/ה: <b>${n.student}</b>`  : '',
      n.subject  ? `📖 מקצוע: <b>${n.subject}</b>`     : '',
      n.alertDay ? `📅 ${n.alertDay}` : (n.date ? `📅 תאריך: ${n.date}` : ''),
      n.lesson   ? `🔢 שיעור ${n.lesson}`              : '',
    ];

    // Grade: extract the numeric score from description
    if (n.type === 'grade') {
      const scoreMatch = (n.description || '').match(/(\d+)/);
      if (scoreMatch) lines.push(`📊 ציון: <b>${scoreMatch[1]}</b>`);
      else if (n.description) lines.push(`📋 ${n.description.slice(0, 200)}`);
    }

    // Homework not done: show what was missing
    if (n.type === 'homework_not_done' && n.description) {
      lines.push(`📋 ${n.description.slice(0, 200)}`);
    }

    // Homework: include task details (homeworkText / description)
    if (n.type === 'homework') {
      if (n.homeworkText) lines.push(`📝 מטלה: ${n.homeworkText.slice(0, 200)}`);
      else if (n.description) lines.push(`📋 ${n.description.slice(0, 200)}`);
    }

    await sendTelegram(lines.filter(Boolean).join('\n'));
    console.log(`[alert] Sent Telegram for new ${n.type}: ${n.subject} / ${n.student}`);
  }
}

// ─── Deadline reminder checker ─────────────────────────────────────────────────
// homework reminders (3 tiers):
//   Alert 1: immediate when new (via sendNewAlerts)
//   Tier 2d (key: id_2d) → 2 days before due  → 🟡 early warning
//   Tier 1d (key: id_1d) → 1 day before due   → 🟠 "מחר חייבים להגיש"
// Called both at push time AND every hour.
async function checkDeadlines() {
  if (!cache.data?.data?.notifications) return;
  const status = loadStatus();
  const now    = new Date();

  for (const n of cache.data.data.notifications) {
    if (n.type !== 'homework' || !n.date) continue;
    const id = hwId(n);
    if (status[id]?.done) continue; // marked done by parent

    const [dd, mm, yyyy] = n.date.split('/').map(Number);
    if (!dd || !mm || !yyyy) continue;
    const hwDate  = new Date(yyyy, mm - 1, dd);
    const daysLeft = (hwDate - now) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 0) continue; // past due, skip

    // ── Tier 2d: 2 days before due date ───────────────────────────────────────
    if (daysLeft >= 2 && daysLeft < 3 && !sentReminders.has(`${id}_2d`)) {
      sentReminders.add(`${id}_2d`);
      saveSentReminders();
      await sendTelegram([
        `🟡 <b>תזכורת — שיעורי בית</b>`,
        ``,
        `📚 מקצוע: <b>${n.subject || '?'}</b>`,
        `👧 תלמיד/ה: <b>${n.student || '?'}</b>`,
        `📅 מועד הגשה: ${n.date} — עוד <b>יומיים</b>`,
        n.homeworkText ? `📝 מטלה: ${n.homeworkText}` : '',
      ].filter(Boolean).join('\n'));
      console.log(`[deadline] Sent 2d reminder: ${n.subject} / ${n.student}`);
    }

    // ── Tier 1d: 1 day before — "מחר חייבים להגיש" ───────────────────────────
    else if (daysLeft >= 1 && daysLeft < 2 && !sentReminders.has(`${id}_1d`)) {
      sentReminders.add(`${id}_1d`);
      saveSentReminders();
      await sendTelegram([
        `🟠 <b>תזכורת דחופה — שיעורי בית!</b>`,
        ``,
        `⚠️ <b>מחר חייבים להגיש!</b>`,
        ``,
        `📚 מקצוע: <b>${n.subject || '?'}</b>`,
        `👧 תלמיד/ה: <b>${n.student || '?'}</b>`,
        `📅 מועד הגשה: ${n.date}`,
        n.homeworkText ? `📝 מטלה: ${n.homeworkText}` : '',
      ].filter(Boolean).join('\n'));
      console.log(`[deadline] Sent 1d reminder (מחר חייבים להגיש): ${n.subject} / ${n.student}`);
    }
  }
}

function startDeadlineReminders() {
  setTimeout(checkDeadlines, 60 * 1000);        // 1 min after startup
  setInterval(checkDeadlines, 60 * 60 * 1000);  // every hour
}

// ─── Local scheduled scraper (VPS runs scraper itself — no home-machine daemon) ─
async function runLocalScrape() {
  console.log('[scrape] Running local scraper...');
  try {
    const prevIds = new Set((cache.data?.data?.notifications || []).map(notifId));
    const raw     = await runScraper();
    const nowISO  = new Date().toISOString();
    cache = { data: { ...raw, extractedAt: nowISO }, timestamp: Date.now() };
    saveCacheToFile();
    const newNotifications = raw?.data?.notifications || [];
    await sendNewAlerts(newNotifications, prevIds);
    await checkDeadlines();
    console.log(`[scrape] Done — ${newNotifications.length} notifications`);
  } catch (e) {
    console.error('[scrape] Local scrape failed:', e.message);
  }
}

function startLocalScraper() {
  // Opt-out: set USE_LOCAL_SCRAPER=false in .env to disable (useful when pushing from home machine)
  if (process.env.USE_LOCAL_SCRAPER === 'false') {
    console.log('[scrape] Local scraper disabled (USE_LOCAL_SCRAPER=false) — expecting push from home machine');
    return;
  }
  console.log('[scrape] Local scraper enabled — first run in 30s, then every 15 min');
  setTimeout(runLocalScrape, 30 * 1000);          // first run 30s after startup
  setInterval(runLocalScrape, 15 * 60 * 1000);    // then every 15 min
}

// ─── Routes ───────────────────────────────────────────────────────────────────
const PUSH_SECRET = (process.env.PUSH_SECRET || 'webtop2026').trim();

// POST /api/push — receive scraped data from local machine
app.post('/api/push', async (req, res) => {
  try {
    const { secret, data } = req.body || {};
    if (secret !== PUSH_SECRET) {
      console.warn('[push] Rejected: wrong secret');
      return res.status(403).json({ ok: false, error: 'Unauthorized' });
    }
    if (!data) return res.status(400).json({ ok: false, error: 'missing data' });
    const links = data?.data?.usefulLinks || [];
    if (links.some(l => (l.href || '').includes('forgotPassword'))) {
      console.warn('[push] Rejected: data looks like login page (forgotPassword in links)');
      return res.status(400).json({ ok: false, error: 'Invalid data — login page detected. Run WEBTOP_CAPTURE=true to re-login.' });
    }

    // Capture previous IDs BEFORE updating cache
    const prevIds = new Set((cache.data?.data?.notifications || []).map(notifId));

    // Update in-memory + disk cache
    const nowISO = new Date().toISOString();
    cache = { data: { ...data, extractedAt: nowISO }, timestamp: Date.now() };
    saveCacheToFile();

    const newNotifications = data?.data?.notifications || [];

    // 1. Instant alerts for late/absence/missing_equipment/grade/homework_not_done
    await sendNewAlerts(newNotifications, prevIds);

    // 2. Deadline check — also run at push time (not just hourly)
    await checkDeadlines();

    // 3. New message Telegram alerts (one per unique message — stable key, no duplicates)
    const newMessages = data?.data?.messages || [];
    const seenMsgKeys = new Set();
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const normSubject = (s) => norm(s).replace(/^\s*תק\s+/, '').slice(0, 60);
    for (const m of newMessages) {
      if (m.read) continue; // already read — skip
      const subjNorm = normSubject(m.subject);
      const msgKey = `msg_|${norm(m.date)}|${subjNorm}`;
      if (sentReminders.has(msgKey) || seenMsgKeys.has(msgKey)) continue;
      sentReminders.add(msgKey);
      seenMsgKeys.add(msgKey);
      saveSentReminders();
      const lines = [
        `📨 <b>הודעה חדשה מהמורה!</b>`,
        ``,
        m.student  ? `👤 ל: <b>${m.student}</b>` : '',
        m.from     ? `✉️ מאת: <b>${m.from}</b>${m.fromRole ? ` (${m.fromRole})` : ''}` : '',
        `📌 נושא: <b>${m.subject || '(ללא נושא)'}</b>`,
        m.date     ? `📅 ${m.date}${m.time ? ` | ${m.time}` : ''}` : '',
        m.body     ? `\n📝 ${m.body.slice(0, 300)}` : '',
      ].filter(Boolean).join('\n');
      await sendTelegram(lines);
      console.log(`[messages] Sent Telegram for new message: "${m.subject}" from ${m.from}`);
    }

    console.log(`[push] Received ${newNotifications.length} notifications at ${nowISO}`);
    res.json({ ok: true, received: true, count: newNotifications.length });
  } catch (e) {
    console.error('[push] Error:', e.message);
    res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// GET /api/data — serve from cache; ?refresh=1 sets trigger for home machine
app.get('/api/data', (req, res) => {
  if (req.query.refresh === '1') {
    triggerPending = true;
    triggerRequestedAt = new Date().toISOString();
  }
  if (cache.data) {
    const cacheAge = Math.round((Date.now() - cache.timestamp) / 1000);
    const stale    = cacheAge > 30 * 60; // stale after 30 min
    return res.json({ ...cache.data, cached: true, cacheAge, stale });
  }
  res.status(503).json({
    ok: false,
    error: 'No data yet — run push_scrape.bat on the home computer',
    pushRequired: true,
  });
});

// GET /api/status — homework done/undone map
app.get('/api/status', (req, res) => { res.json(loadStatus()); });

// GET /api/status/system — system health (what works, what needs fix)
app.get('/api/status/system', (req, res) => {
  const cacheAge = cache.data ? Math.round((Date.now() - cache.timestamp) / 1000) : null;
  const notifCount = cache.data?.data?.notifications?.length ?? 0;
  const linkCount = cache.data?.data?.usefulLinks?.length ?? 0;
  const hasValidLinks = linkCount > 0 && !(cache.data?.data?.usefulLinks || []).some(l => (l.href || '').includes('forgotPassword'));
  res.json({
    ok: true,
    cacheAge,
    cacheAgeMin: cacheAge != null ? Math.round(cacheAge / 60) : null,
    stale: cacheAge != null && cacheAge > 30 * 60,
    notifCount,
    linkCount,
    dataValid: hasValidLinks && notifCount >= 0,
    triggerPending,
    message: !cache.data
      ? 'אין נתונים — הרץ fresh_pull או start_daemon במחשב הבית'
      : hasValidLinks ? 'המערכת פעילה' : 'הנתונים נראים לא תקינים (דף התחברות?) — הרץ WEBTOP_CAPTURE=true',
  });
});

// GET /api/events — special events (birthdays, parent meetings)
app.get('/api/events', (req, res) => { res.json(loadSpecialEvents()); });

// GET /api/children — per-child config (valid subjects, grade, birthdate)
app.get('/api/children', (req, res) => { res.json(loadChildrenConfig()); });

// GET /api/external-links — external sites (forms, webtop pages)
app.get('/api/external-links', (req, res) => {
  try {
    if (existsSync(EXTERNAL_LINKS_FILE))
      return res.json(JSON.parse(readFileSync(EXTERNAL_LINKS_FILE, 'utf8')));
  } catch {}
  res.json({ links: [] });
});

// POST /api/children/:name/photo — save base64 photo for a child
app.post('/api/children/:name/photo', express.json({ limit: '10mb' }), (req, res) => {
  const name  = decodeURIComponent(req.params.name).trim();
  const { photo } = req.body || {};
  if (!photo) return res.status(400).json({ ok: false, error: 'missing photo' });
  const config = loadChildrenConfig();
  // Match by full name or short name (אמי vs גונשרוביץ אמי)
  const child  = (config.children || []).find(c =>
    c.name === name || c.name.endsWith(' ' + name)
  );
  if (!child) return res.status(404).json({ ok: false, error: 'child not found', tried: name });
  child.photo = photo; // base64 data URL
  try {
    writeFileSync(CHILDREN_CONFIG_FILE, JSON.stringify(config, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/insights — computed smart summary from current cache + status
app.get('/api/insights', (req, res) => {
  const notifications = cache.data?.data?.notifications || [];
  const status        = loadStatus();
  const now           = new Date();
  now.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  const ALERT_TYPES_INS = new Set(['late', 'absence', 'missing_equipment', 'homework_not_done', 'grade']);
  let overduePendingCount = 0;  // homework past due and NOT marked done
  let upcoming48hCount    = 0;  // homework due within 48h and NOT marked done
  let alertsRecentCount   = 0;  // any alert-type notification in last 7 days
  let alertsThisWeek      = 0;  // alert-type notifications in current 7-day window
  let alertsLastWeek      = 0;  // alert-type notifications in prior 7-day window

  const oneWeekAgo  = new Date(now); oneWeekAgo.setDate(now.getDate() - 7);
  const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(now.getDate() - 14);

  for (const n of notifications) {
    if (!n.date) continue;
    const [dd, mm, yyyy] = n.date.split('/').map(Number);
    if (!dd || !mm || !yyyy) continue;
    const nDate    = new Date(yyyy, mm - 1, dd);
    const daysLeft = Math.round((nDate - now) / (1000 * 60 * 60 * 24));

    // Skip impossible absences (before 7am — school is closed then)
    if (n.type === 'absence' && n.alertTime) {
      const alertH = parseInt(n.alertTime.split(':')[0], 10);
      if (!isNaN(alertH) && alertH < 7) continue;
    }
    // Skip stale non-grade/homework alerts (older than 45 days — not actionable)
    if (!['grade', 'homework'].includes(n.type) && daysLeft < -45) continue;

    if (n.type === 'homework') {
      const id = `${n.subject || ''}_${n.date || ''}_${n.lesson || ''}`;
      if (!status[id]?.done) {
        if (daysLeft < 0) overduePendingCount++;
        if (daysLeft >= 0 && daysLeft <= 2) upcoming48hCount++;
      }
    } else if (ALERT_TYPES_INS.has(n.type)) {
      if (nDate >= sevenDaysAgo)  alertsRecentCount++;
      if (nDate >= oneWeekAgo)    alertsThisWeek++;
      else if (nDate >= twoWeeksAgo) alertsLastWeek++;
    }
  }

  const trend = alertsThisWeek > alertsLastWeek + 1 ? 'up'
              : alertsThisWeek < alertsLastWeek - 1 ? 'down'
              : 'stable';

  res.json({ ok: true, overduePendingCount, upcoming48hCount, alertsRecentCount,
             alertsThisWeek, alertsLastWeek, trend });
});

// POST /api/homework/done — mark homework complete + send Telegram confirmation
app.post('/api/homework/done', async (req, res) => {
  const {
    id, homeworkText, studentName,
    subject: bodySubject, date: bodyDate, lesson: bodyLesson,
    alertDay, description,
  } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });

  const status  = loadStatus();
  const now     = new Date();
  const parts   = id.split('_');
  const subject = bodySubject || parts[0] || '?';
  const date    = bodyDate    || parts[1] || '?';
  const lesson  = bodyLesson  || parts[2] || '?';

  const timeStr = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('he-IL');

  status[id] = { done: true, markedAt: now.toISOString() };
  saveStatus(status);

  // Mark both reminder tiers as sent so no future reminder fires for this item
  sentReminders.add(`${id}_1d`);
  sentReminders.add(`${id}_2d`);
  saveSentReminders();

  const descTrimmed = (description || '').trim();
  const showDesc = descTrimmed && descTrimmed !== (homeworkText || '').trim()
    ? descTrimmed.slice(0, 250)
    : null;

  const lines = [
    `✅ <b>שיעורי בית הושלמו!</b>`,
    ``,
    studentName  ? `👧 תלמידה: <b>${studentName}</b>` : '',
    `📚 מקצוע: <b>${subject}</b>`,
    `📅 תאריך: ${date}${lesson ? ` | שיעור ${lesson}` : ''}`,
    alertDay     ? `🗓 מועד: ${alertDay}` : '',
    ``,
    homeworkText ? `📝 מטלה: ${homeworkText}` : '',
    showDesc     ? `📋 פירוט: ${showDesc}` : '',
    ``,
    `⏰ סומן: ${timeStr} ${dateStr}`,
  ].filter(l => l !== null && l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  await sendTelegram(lines);
  res.json({ ok: true, id, done: true });
});

// POST /api/approval/done — mark approval as "אישרתי" (local status only)
app.post('/api/approval/done', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
  const status = loadStatus();
  status[id] = { approved: true, at: new Date().toISOString() };
  saveStatus(status);
  res.json({ ok: true, id, approved: true });
});

// POST /api/messages/read — mark message as read when user opens it
app.post('/api/messages/read', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
  const status = loadStatus();
  status[id] = { read: true, at: new Date().toISOString() };
  saveStatus(status);
  res.json({ ok: true, id, read: true });
});

// POST /api/homework/undone — unmark (re-enables future reminders)
app.post('/api/homework/undone', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
  const status = loadStatus();
  delete status[id];
  saveStatus(status);
  sentReminders.delete(`${id}_1d`);
  sentReminders.delete(`${id}_2d`);
  saveSentReminders();
  res.json({ ok: true, id, done: false });
});

// POST /api/trigger — phone requests a fresh scrape from home machine
app.post('/api/trigger', (req, res) => {
  triggerPending = true;
  triggerRequestedAt = new Date().toISOString();
  console.log(`[trigger] Scrape requested at ${triggerRequestedAt}`);
  res.json({ ok: true, message: 'Trigger queued — home machine will scrape within ~2 minutes' });
});

// GET /api/poll — home machine daemon polls this; returns flag and resets it
app.get('/api/poll', (req, res) => {
  const secret = req.query.secret || req.headers['x-push-secret'];
  if (secret !== PUSH_SECRET) return res.status(403).json({ ok: false });
  const pending = triggerPending;
  if (pending) {
    triggerPending = false;
    console.log('[poll] Trigger consumed by home machine');
  }
  res.json({ ok: true, pending, requestedAt: triggerRequestedAt });
});

// Fallback → index.html
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ─── Startup ──────────────────────────────────────────────────────────────────
loadCacheFromFile();
app.listen(PORT, () => {
  console.log(`Webtop dashboard running on http://localhost:${PORT}`);
  startDeadlineReminders();
  startLocalScraper();
});
