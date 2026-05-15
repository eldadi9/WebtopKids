import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ─── Load .env BEFORE other imports (so they see DOTENV_PATH override) ────────
// We can't use `import 'dotenv/config'` here because we need to control which file is read.
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const envPath = process.env.DOTENV_PATH
    ? (process.env.DOTENV_PATH.match(/^([A-Za-z]:)?[\\/]/) ? process.env.DOTENV_PATH : join(__dirname, process.env.DOTENV_PATH))
    : join(__dirname, '.env');
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

import { runWebtopScraperChild } from './webtop_scraper_child.mjs';
import { hashPassword, checkPassword, signJwt, requireAuth, requireAdmin, encryptToken } from './auth.mjs';
import { loadUsers, createUser, findUserById, findUserByPhone, findUserByChatId, updateUser } from './users.mjs';
const app = express();

/** Set to `true` in .env to expose /register and POST /api/auth/register */
const ENABLE_PUBLIC_REGISTRATION = /^true$/i.test(process.env.ENABLE_PUBLIC_REGISTRATION || '');
/** Set to `true` in .env to expose /admin and /admin.html */
const ENABLE_ADMIN_UI = /^true$/i.test(process.env.ENABLE_ADMIN_UI || '');
// Admin UI password — REQUIRED when ENABLE_ADMIN_UI=true. No default; refuses to start without one.
const ADMIN_UI_PASSWORD = String(process.env.ADMIN_UI_PASSWORD || '');
if (ENABLE_ADMIN_UI && (!ADMIN_UI_PASSWORD || ADMIN_UI_PASSWORD.length < 6 || ADMIN_UI_PASSWORD === '1920')) {
  console.error('🚨 FATAL: ENABLE_ADMIN_UI=true but ADMIN_UI_PASSWORD is missing, weak (<6 chars), or default ("1920"). Set a strong password in .env.');
  process.exit(1);
}

app.use((req, res, next) => {
  const p = req.path || '';
  if (!ENABLE_ADMIN_UI && (p === '/admin' || p === '/admin.html')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  if (!ENABLE_PUBLIC_REGISTRATION && (p === '/register' || p === '/register.html')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  next();
});

app.use(express.json());
app.use(express.static(join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    const fp = String(filePath).replace(/\\/g, '/');
    if (/(^|\/)index\.html$|(^|\/)login\.html$|(^|\/)register\.html$|(^|\/)app\.js$/.test(fp)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  },
}));

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT             = process.env.PORT || 3000;
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const ADMIN_CHAT_ID    = (process.env.ADMIN_CHAT_ID || '').trim() || TELEGRAM_CHAT_ID;
/** אותן התראות כמו ל-primary — מזהי צ׳אט מופרדים בפסיק או רווח */
const TELEGRAM_EXTRA_CHAT_IDS = (process.env.TELEGRAM_EXTRA_CHAT_IDS || '')
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((id, i, a) => a.indexOf(id) === i);

function isTrustedTelegramCommandChat(chatId) {
  const c = String(chatId || '').trim();
  if (!c) return false;
  if (TELEGRAM_CHAT_ID && c === TELEGRAM_CHAT_ID) return true;
  if (ADMIN_CHAT_ID && c === ADMIN_CHAT_ID) return true;
  return TELEGRAM_EXTRA_CHAT_IDS.includes(c);
}

/** Telegram IDs that should all receive the same household alerts (Eldad + Moran + env extras). */
function telegramHouseholdChatIds() {
  return new Set(
    [TELEGRAM_CHAT_ID, ADMIN_CHAT_ID, ...TELEGRAM_EXTRA_CHAT_IDS]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  );
}

function telegramSendTargets(primaryChatId) {
  const target = String(primaryChatId || '').trim();
  const household = telegramHouseholdChatIds();
  const out = new Set(target ? [target] : []);
  if (target) {
    for (const x of household) out.add(x);
  }
  return [...out];
}

// Optional DEV prefix to isolate cache/state files from production
const DATA_PREFIX = (process.env.DATA_PREFIX || '').trim();
function prefixed(name) { return DATA_PREFIX ? `${DATA_PREFIX}_${name}` : name; }

const STATUS_FILE         = join(__dirname, prefixed('homework_status.json'));
const DATA_CACHE_FILE     = join(__dirname, prefixed('data_cache.json'));
const SPECIAL_EVENTS_FILE = join(__dirname, 'special_events.json'); // shared (no per-env)
const REMINDERS_FILE      = join(__dirname, prefixed('sent_reminders.json'));
const CHILDREN_CONFIG_FILE = join(__dirname, 'children_config.json'); // shared
const EXTERNAL_LINKS_FILE  = join(__dirname, 'external_links.json'); // shared

// ─── Per-user data cache ───────────────────────────────────────────────────────
function userCachePath(userId) {
  return join(__dirname, prefixed(`data_cache_${userId}.json`));
}

function loadUserCache(userId) {
  const path = userCachePath(userId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveUserCache(userId, data) {
  writeFileSync(userCachePath(userId), JSON.stringify({ data, timestamp: Date.now() }, null, 2));
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
let cache = { data: null, timestamp: 0 };

const telegramPendingLink = new Map(); // chatId → { step: 'awaiting_phone', ts: Date.now() }

// ─── Trigger flag (phone → VPS → home machine) ────────────────────────────────
let triggerPending = false;
let triggerRequestedAt = null;

// ─── Pending cookie (Telegram /cookie command → Windows machine) ──────────────
let pendingCookie = null;
let pendingCookieAt = null;

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
    if (!PUSH_DEFAULT_USER_ID) {
      console.log('[cache] Skipping global legacy cache load: PUSH_DEFAULT_USER_ID is empty');
      return;
    }
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

// ─── Per-user sent-reminders (dedup keys per user — avoids cross-user suppression) ─
function loadUserReminders(userId) {
  try {
    const file = join(__dirname, prefixed(`sent_reminders_${userId}.json`));
    if (existsSync(file)) return new Set(JSON.parse(readFileSync(file, 'utf8')));
  } catch {}
  return new Set();
}
function saveUserReminders(userId, set) {
  try { writeFileSync(join(__dirname, prefixed(`sent_reminders_${userId}.json`)), JSON.stringify([...set])); }
  catch {}
}

// ─── ID helpers ───────────────────────────────────────────────────────────────
// Include student in hwId to avoid collision between Ami and Yuli same-subject homework
function hwId(n) { return `${(n.student || '').trim()}_${(n.subject || '').trim()}_${(n.date || '').trim()}_${(n.lesson || '').toString().trim()}`; }
// Normalized — trim ALL parts to avoid duplicate alerts when scrape returns slight variations
function notifId(n) {
  return `${(n.type || '').trim()}_${(n.student || '').trim()}_${(n.subject || '').trim()}_${(n.date || '').trim()}_${(n.lesson || '').toString().trim()}`;
}

// ─── Scraper runner (timeout + SIGKILL — לא נתקע לנצח) ───────────────────────
function runScraper() {
  return runWebtopScraperChild({
    log: (msg) => console.log(`[scraper] ${msg}`),
    useScrapingLock: false,
  });
}

// ─── Quiet hours — no alerts between 21:00 and 07:00 Israel time ─────────────
function isQuietHours() {
  const israelHour = parseInt(
    new Date().toLocaleString('he-IL', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jerusalem' }),
    10
  );
  return israelHour >= 21 || israelHour < 7; // 21:00–07:00
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
/** `direct`: defaults true. Pass false only after an explicit broadcastHousehold permission check. */
async function sendTelegram(text, chatId = TELEGRAM_CHAT_ID, direct = true) {
  if (!TELEGRAM_TOKEN) throw new Error('Telegram token is not configured');
  if (!chatId) throw new Error('Telegram chatId is not configured');
  const id = String(chatId).trim();
  if (!id) throw new Error('Telegram chatId is empty');
  const targets = direct ? [id] : telegramSendTargets(id);
  const failures = [];
  for (const t of targets) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body:    JSON.stringify({ chat_id: t, text, parse_mode: 'HTML' }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`Telegram HTTP ${r.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
    } catch (e) {
      failures.push(`${t}: ${e.message}`);
    }
  }
  if (failures.length) {
    throw new Error(`Telegram send failed (${failures.length}/${targets.length}): ${failures.join('; ')}`);
  }
}

async function sendAdminTelegram(text) {
  return sendTelegram(text, ADMIN_CHAT_ID);
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
  good_word:         '🌟',
  attendance:        '✅',
};
const ALERT_NAME = {
  late:              'איחור',
  absence:           'חיסור',
  missing_equipment: 'ציוד חסר',
  grade:             'ציון חדש',
  homework_not_done: 'שיעורי בית לא הוכנו',
  homework:          'שיעורי בית חדשים',
  good_word:         'מילה טובה',
  attendance:        'נוכחות',
};
const ALERT_TYPES_SET = new Set([
  'late', 'absence', 'missing_equipment', 'grade', 'homework_not_done', 'homework', 'good_word', 'attendance',
]);

function hasAlertableContent(data) {
  const notifications = data?.data?.notifications || [];
  const messages = data?.data?.messages || [];
  return notifications.some(n => ALERT_TYPES_SET.has(n.type)) || messages.some(m => !m.read);
}

async function sendNewAlerts(newNotifications, prevIds, sendFn = sendTelegram, reminders = sentReminders, saveReminders = saveSentReminders) {
  if (isQuietHours()) {
    console.log('[alert] Quiet hours (21:00–07:00) — skipping instant alerts');
    return;
  }

  for (const n of newNotifications) {
    if (!ALERT_TYPES_SET.has(n.type)) continue;

    const nId = notifId(n);

    // PERMANENT dedup: already sent this alert before (persists across restarts)
    if (reminders.has(`alert_${nId}`)) continue;

    // Session dedup: already in previous cache batch
    if (prevIds.has(nId)) continue;

    // Skip impossible absences (before 7am — school doesn't open that early)
    if (n.type === 'absence' && n.alertTime) {
      const alertH = parseInt(n.alertTime.split(':')[0], 10);
      if (!isNaN(alertH) && alertH < 7) {
        console.log(`[alert] Skipped impossible absence at ${n.alertTime} — ${n.student}/${n.date}`);
        reminders.add(`alert_${nId}`); saveReminders(); // mark so it never retries
        continue;
      }
    }
    // Skip stale non-grade alerts (>7 days old)
    if (n.type !== 'grade' && n.date) {
      const [dd, mm, yyyy] = n.date.split('/').map(Number);
      if (dd && mm && yyyy) {
        const nDate   = new Date(yyyy, mm - 1, dd);
        const daysOld = Math.round((Date.now() - nDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld > 7) {
          console.log(`[alert] Skipped stale alert (${daysOld}d old) — ${n.type} / ${n.subject}`);
          reminders.add(`alert_${nId}`); saveReminders();
          continue;
        }
        // Skip homework past due
        if (n.type === 'homework' && daysOld > 0) {
          console.log(`[alert] Skipped past-due homework — ${n.subject} / ${n.date}`);
          reminders.add(`alert_${nId}`); saveReminders();
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

    if (n.type === 'grade') {
      const scoreMatch = (n.description || '').match(/(\d+)/);
      if (scoreMatch) lines.push(`📊 ציון: <b>${scoreMatch[1]}</b>`);
      else if (n.description) lines.push(`📋 ${n.description.slice(0, 200)}`);
    }
    if (n.type === 'homework_not_done' && n.description) {
      lines.push(`📋 ${n.description.slice(0, 200)}`);
    }
    if (n.type === 'homework') {
      if (n.homeworkText) lines.push(`📝 מטלה: ${n.homeworkText.slice(0, 200)}`);
      else if (n.description) lines.push(`📋 ${n.description.slice(0, 200)}`);
    }

    await sendFn(lines.filter(Boolean).join('\n'));
    // Mark as permanently sent — will NEVER send this alert again
    reminders.add(`alert_${nId}`);
    saveReminders();
    console.log(`[alert] Sent Telegram for new ${n.type}: ${n.subject} / ${n.student}`);
  }
}

// ─── Deadline reminder checker ─────────────────────────────────────────────────
// homework reminders (3 tiers):
//   Alert 1: immediate when new (via sendNewAlerts)
//   Tier 2d (key: id_2d) → 2 days before due  → 🟡 early warning
//   Tier 1d (key: id_1d) → 1 day before due   → 🟠 "מחר חייבים להגיש"
// Called both at push time AND every hour.
async function checkDeadlines(dataOverride = null, sendFn = sendTelegram, reminders = sentReminders, saveReminders = saveSentReminders) {
  const dataSource = dataOverride ?? cache.data;
  if (!dataSource?.data?.notifications) return;
  if (isQuietHours()) {
    console.log('[deadline] Quiet hours (21:00–07:00) — skipping deadline check');
    return;
  }
  const status = loadStatus();
  const now    = new Date();

  for (const n of dataSource.data.notifications) {
    if (n.type !== 'homework' || !n.date) continue;
    const id = hwId(n);
    if (status[id]?.done) continue; // marked done by parent

    const [dd, mm, yyyy] = n.date.split('/').map(Number);
    if (!dd || !mm || !yyyy) continue;
    const hwDate  = new Date(yyyy, mm - 1, dd);
    const daysLeft = (hwDate - now) / (1000 * 60 * 60 * 24);
    if (daysLeft < 0) continue; // past due, skip

    // ── Tier 0d: on the due date itself ───────────────────────────────────────
    if (daysLeft >= 0 && daysLeft < 1 && !reminders.has(`${id}_0d`)) {
      await sendFn([
        `🔴 <b>היום יום ההגשה!</b>`,
        ``,
        `⏳ <b>הגשה היום!</b>`,
        ``,
        `📚 מקצוע: <b>${n.subject || '?'}</b>`,
        `👧 תלמיד/ה: <b>${n.student || '?'}</b>`,
        `📅 מועד הגשה: ${n.date}`,
        n.homeworkText ? `📝 מטלה: ${n.homeworkText}` : '',
      ].filter(Boolean).join('\n'));
      reminders.add(`${id}_0d`);
      saveReminders();
      console.log(`[deadline] Sent 0d reminder (היום יום ההגשה): ${n.subject} / ${n.student}`);
    }

    // ── Tier 2d: 2 days before due date ───────────────────────────────────────
    else if (daysLeft >= 2 && daysLeft < 3 && !reminders.has(`${id}_2d`)) {
      await sendFn([
        `🟡 <b>תזכורת — שיעורי בית</b>`,
        ``,
        `📚 מקצוע: <b>${n.subject || '?'}</b>`,
        `👧 תלמיד/ה: <b>${n.student || '?'}</b>`,
        `📅 מועד הגשה: ${n.date} — עוד <b>יומיים</b>`,
        n.homeworkText ? `📝 מטלה: ${n.homeworkText}` : '',
      ].filter(Boolean).join('\n'));
      reminders.add(`${id}_2d`);
      saveReminders();
      console.log(`[deadline] Sent 2d reminder: ${n.subject} / ${n.student}`);
    }

    // ── Tier 1d: 1 day before — "מחר חייבים להגיש" ───────────────────────────
    else if (daysLeft >= 1 && daysLeft < 2 && !reminders.has(`${id}_1d`)) {
      await sendFn([
        `🟠 <b>תזכורת דחופה — שיעורי בית!</b>`,
        ``,
        `⚠️ <b>מחר חייבים להגיש!</b>`,
        ``,
        `📚 מקצוע: <b>${n.subject || '?'}</b>`,
        `👧 תלמיד/ה: <b>${n.student || '?'}</b>`,
        `📅 מועד הגשה: ${n.date}`,
        n.homeworkText ? `📝 מטלה: ${n.homeworkText}` : '',
      ].filter(Boolean).join('\n'));
      reminders.add(`${id}_1d`);
      saveReminders();
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
    const nextData = { ...raw, extractedAt: nowISO };
    const newNotifications = raw?.data?.notifications || [];
    await sendNewAlerts(newNotifications, prevIds);
    await checkDeadlines(nextData);
    cache = { data: nextData, timestamp: Date.now() };
    saveCacheToFile();
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
/** UUID (ב־users.json) שאליו נדחף מהבית כש־userId חסר ב־POST; גם ברירת מחדל ל־/api/data */
const PUSH_DEFAULT_USER_ID = (process.env.PUSH_DEFAULT_USER_ID || process.env.PUSH_USER_ID || '').trim();
/** מעל כמה דקות בלי עדכון מטמון נחשב "ישן" (ברירת מחדל: 45 — מעט מעל 2×15 דק׳ בין דחיפות) */
const DATA_STALE_AFTER_MINUTES = parseInt(process.env.DATA_STALE_AFTER_MINUTES || '45', 10);
const DATA_STALE_SECONDS = DATA_STALE_AFTER_MINUTES * 60;
/** true כשהשרת לא מריץ סקרייפר מקומי ומצפה ל־POST /api/push מהמחשב הביתי */
const EXPECTS_HOME_PUSH = process.env.USE_LOCAL_SCRAPER === 'false';

// ─── Per-user alert processing ────────────────────────────────────────────────
async function processAlertsForUser(user, data) {
  try {
    const chatId = user?.chatId;
    if (!chatId) {
      console.warn(`[alerts] Skipping user ${user?.id} (${user?.name}) — no chatId paired`);
      if (hasAlertableContent(data)) {
        throw new Error(`User ${user?.id || '(unknown)'} has alertable content but no Telegram chatId`);
      }
      return;
    }
    const broadcastHousehold = user?.broadcastHousehold === true;

    async function sendTelegramToUser(text) {
      const targetChatId = String(chatId).trim();
      return sendTelegram(text, targetChatId, !broadcastHousehold);
    }

    let prevCache;
    try {
      prevCache = loadUserCache(user.id);
    } catch (e) {
      console.error(`[processAlertsForUser] loadUserCache failed for ${user.id} — aborting to preserve prevIds:`, e.stack || e.message);
      throw e;
    }
    const prevIds = new Set((prevCache?.data?.data?.notifications || []).map(notifId));

    const userReminders = loadUserReminders(user.id);
    const saveUserRem = () => saveUserReminders(user.id, userReminders);

    const newNotifications = data?.data?.notifications || [];
    await sendNewAlerts(newNotifications, prevIds, sendTelegramToUser, userReminders, saveUserRem);
    await checkDeadlines(data, sendTelegramToUser, userReminders, saveUserRem);

    const newMessages = data?.data?.messages || [];
    const seenMsgKeys = new Set();
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const normSubject = (s) => norm(s).replace(/^\s*תק\s+/, '').slice(0, 60);
    const quietNow = isQuietHours();
    for (const m of newMessages) {
      if (m.read) continue;
      const subjNorm = normSubject(m.subject);
      const msgKey = `msg_|${norm(m.date)}|${subjNorm}`;
      if (userReminders.has(msgKey) || seenMsgKeys.has(msgKey)) continue;
      if (quietNow) { console.log(`[messages] Quiet hours — skipped Telegram for "${m.subject}"`); continue; }
      const lines = [
        `📨 <b>הודעה חדשה מהמורה!</b>`,
        ``,
        m.student  ? `👤 ל: <b>${m.student}</b>` : '',
        m.from     ? `✉️ מאת: <b>${m.from}</b>${m.fromRole ? ` (${m.fromRole})` : ''}` : '',
        `📌 נושא: <b>${m.subject || '(ללא נושא)'}</b>`,
        m.date     ? `📅 ${m.date}${m.time ? ` | ${m.time}` : ''}` : '',
        m.body     ? `\n📝 ${m.body.slice(0, 300)}` : '',
      ].filter(Boolean).join('\n');
      await sendTelegramToUser(lines);
      userReminders.add(msgKey);
      seenMsgKeys.add(msgKey);
      saveUserRem();
      console.log(`[messages] Sent Telegram for new message: "${m.subject}" from ${m.from}`);
    }
  } catch (e) {
    console.error('[processAlertsForUser] Error:', e.message);
    throw e;
  }
}

// POST /api/push — receive scraped data from local machine
app.post('/api/push', async (req, res) => {
  const headerSecret = String(req.headers['x-push-secret'] || '').trim();
  const bodySecret = (req.body?.secret != null ? String(req.body.secret) : '').trim();
  if (headerSecret !== PUSH_SECRET && bodySecret !== PUSH_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { userId: rawUserId, data } = req.body;
  if (!data) return res.status(400).json({ error: 'Missing data' });

  const effectiveUserId = (rawUserId && String(rawUserId).trim()) || PUSH_DEFAULT_USER_ID || null;
  if (effectiveUserId) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(effectiveUserId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const user = findUserById(effectiveUserId);
    if (user) {
      try {
        await processAlertsForUser(user, data);
      } catch (e) {
        console.error(`[push] processAlertsForUser threw for ${effectiveUserId} — NOT saving cache to preserve prevIds:`, e.message);
        return res.status(500).json({ error: 'alerts_failed_cache_not_updated' });
      }
    }
    saveUserCache(effectiveUserId, data);
  }

  // Only overwrite the global legacy cache for the default push user (admin/owner).
  // Other parents must not leak their data into the global cache.
  if (effectiveUserId && PUSH_DEFAULT_USER_ID && effectiveUserId === PUSH_DEFAULT_USER_ID) {
    cache = { data, timestamp: Date.now() };
    saveCacheToFile();
  }

  const count = data?.data?.notifications?.length ?? 0;
  console.log(`[push] userId=${effectiveUserId || '(none)'} notifications=${count} at ${new Date().toISOString()}`);
  res.json({ ok: true, count });
});

function requireAdminPassword(req, res, next) {
  // Accept header OR body only — never query string (would land in access logs / referer).
  const provided = String(req.headers['x-admin-password'] || req.body?.adminPassword || '');
  if (!ADMIN_UI_PASSWORD || provided !== ADMIN_UI_PASSWORD) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Allowed roles for data-endpoint access. Unknown roles are rejected.
const DATA_ACCESS_ROLES = new Set(['admin', 'parent']);

// User-id format guard. Matches our randomUUID() output and any conservative id.
// Prevents path-traversal via data_cache_<id>.json.
const USER_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function isValidUserId(id) {
  return typeof id === 'string' && USER_ID_RE.test(id);
}

// Resolve which userId's cache the request should see.
// - pre-auth (AUTH_DISABLED): PUSH_DEFAULT_USER_ID (legacy frontend)
// - admin: their own id; NO silent fallback to PUSH_DEFAULT_USER_ID (caller decides explicitly)
// - parent: only their own id; never PUSH_DEFAULT_USER_ID
// Returns null on malformed JWT — callers must respond 401.
function effectiveUserIdForRequest(req) {
  if (!req.user) {
    // No JWT (AUTH_DISABLED path). Legacy behavior: serve PUSH_DEFAULT_USER_ID's cache.
    return PUSH_DEFAULT_USER_ID;
  }
  if (!isValidUserId(req.user.id)) {
    console.error('[auth] JWT missing/invalid id claim', { role: req.user.role, path: req.path });
    return null;
  }
  if (!DATA_ACCESS_ROLES.has(req.user.role)) {
    console.warn('[auth] Unknown role accessing data', { role: req.user.role, id: req.user.id });
    return null;
  }
  return req.user.id;
}

// Read per-user data for authenticated requests.
// - admin: serves their own cache; if empty, falls back to PUSH_DEFAULT_USER_ID (oversight role)
// - parent: serves ONLY their own cache (no fallback, never leaks another household's data)
// Returns null if there's no data to show (caller should 503).
function getAuthenticatedUserCache(req) {
  const userId = effectiveUserIdForRequest(req);
  if (userId === null) return { error: 'unauthorized' };

  // Admin path: own cache → push-default fallback (explicit, logged when fallback fires)
  if (req.user && req.user.role === 'admin') {
    const own = loadUserCache(userId);
    if (own?.data) return { cache: own, source: 'own' };
    if (PUSH_DEFAULT_USER_ID && PUSH_DEFAULT_USER_ID !== userId) {
      const def = loadUserCache(PUSH_DEFAULT_USER_ID);
      if (def?.data) {
        console.log(`[auth] admin ${userId} → fallback to PUSH_DEFAULT_USER_ID`);
        return { cache: def, source: 'push_default' };
      }
    }
    return null;
  }

  // Pre-auth (AUTH_DISABLED): legacy behavior — serve only an explicit PUSH_DEFAULT_USER_ID.
  if (!req.user) {
    if (!PUSH_DEFAULT_USER_ID) return null;
    const def = loadUserCache(userId);
    if (def?.data) return { cache: def, source: 'push_default_legacy' };
    if (PUSH_DEFAULT_USER_ID && cache?.data) {
      console.warn('[AUTH_DISABLED] serving global_legacy cache for', req.path);
      return { cache: { data: cache.data, timestamp: cache.timestamp }, source: 'global_legacy' };
    }
    return null;
  }

  // Parent path: own cache only. No fallback. If missing, return null → 503.
  const own = loadUserCache(userId);
  if (!own?.data) return null;
  return { cache: own, source: 'own' };
}

function getAuthenticatedData(req) {
  const result = getAuthenticatedUserCache(req);
  if (!result || result.error) return {};
  return result.cache?.data?.data || {};
}

// Returns the set of child names this request is allowed to see.
// admin: all children in children_config.json (oversight)
// parent: only names listed on their user record (children: [])
// pre-auth (AUTH_DISABLED): all (legacy)
function allowedChildrenForRequest(req) {
  const allConfig = loadChildrenConfig();
  const all = (allConfig.children || []);
  if (!req.user || req.user.role === 'admin') {
    return { children: all, names: new Set(all.map(c => c.name)) };
  }
  // Find this parent's user record for the children allowlist
  const u = findUserById(req.user.id);
  const own = new Set((u?.children || []).map(s => String(s).trim()).filter(Boolean));
  // Match either full name or trailing name segment (e.g. "אמי" matches "גונשרוביץ אמי")
  const filtered = all.filter(c => {
    if (own.has(c.name)) return true;
    const short = c.name.split(' ').pop();
    return own.has(short);
  });
  return { children: filtered, names: new Set(filtered.map(c => c.name)) };
}

// AUTH_DISABLED=true: emergency rollback only. Production must NEVER ship with this.
// Refuses to start if AUTH_DISABLED=true and NODE_ENV=production without explicit ack.
const AUTH_DISABLED = /^true$/i.test(process.env.AUTH_DISABLED || '');
if (AUTH_DISABLED) {
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const ack = process.env.AUTH_DISABLED_ACK === 'YES_I_KNOW';
  if (isProd && !ack) {
    console.error('🚨 FATAL: AUTH_DISABLED=true in production without AUTH_DISABLED_ACK=YES_I_KNOW. Refusing to start.');
    process.exit(1);
  }
  console.error('🚨🚨🚨 AUTH_DISABLED=true — ALL /api/* data endpoints are PUBLIC (no JWT required). 🚨🚨🚨');
}
const maybeAuth = AUTH_DISABLED
  ? (req, res, next) => { if (req.path?.startsWith('/api/data')) console.warn('[AUTH_DISABLED] public access to', req.path); next(); }
  : requireAuth;

// GET /api/data — serve from per-user cache; ?refresh=1 sets trigger for home machine
app.get('/api/data', maybeAuth, (req, res) => {
  if (req.query.refresh === '1') {
    triggerPending = true;
    triggerRequestedAt = new Date().toISOString();
  }
  const result = getAuthenticatedUserCache(req);
  if (result?.error === 'unauthorized') return res.status(401).json({ error: 'Unauthorized' });
  if (!result?.cache?.data) return res.status(503).json({ error: 'No data yet' });
  const userCache = result.cache;
  const cacheAge = userCache.timestamp ? Math.round((Date.now() - userCache.timestamp) / 1000) : null;
  res.json({
    ...userCache.data,
    cacheAge,
    stale: cacheAge != null && cacheAge > DATA_STALE_SECONDS,
    staleThresholdMin: DATA_STALE_AFTER_MINUTES,
    expectsHomePush: EXPECTS_HOME_PUSH,
  });
});

// GET /api/status — homework done/undone map. Filtered per parent (keys start with "<student>_").
// Admin/AUTH_DISABLED: returns full map.
app.get('/api/status', maybeAuth, (req, res) => {
  const status = loadStatus();
  if (!req.user || req.user.role === 'admin') return res.json(status);
  const { names } = allowedChildrenForRequest(req);
  // Build a Set of student prefixes (full name + short name) for matching
  const prefixes = new Set();
  for (const n of names) {
    prefixes.add(n + '_');
    const short = n.split(' ').pop();
    if (short) prefixes.add(short + '_');
  }
  const filtered = {};
  for (const [k, v] of Object.entries(status)) {
    for (const p of prefixes) {
      if (k.startsWith(p)) { filtered[k] = v; break; }
    }
  }
  res.json(filtered);
});

// GET /api/status/system — system health (what works, what needs fix)
// Public on purpose — lightweight health check, no per-user data
app.get('/api/status/system', (req, res) => {
  const cacheAge = cache.data ? Math.round((Date.now() - cache.timestamp) / 1000) : null;
  const notifCount = cache.data?.data?.notifications?.length ?? 0;
  const links = cache.data?.data?.usefulLinks || [];
  const linkCount = links.length;
  const loginPageInLinks = links.some(l => (l.href || '').includes('forgotPassword'));
  // Python API fetcher often sends usefulLinks: [] — still valid if not a login page
  const dataValid = !loginPageInLinks;
  res.json({
    ok: true,
    cacheAge,
    cacheAgeMin: cacheAge != null ? Math.round(cacheAge / 60) : null,
    stale: cacheAge != null && cacheAge > DATA_STALE_SECONDS,
    staleThresholdMin: DATA_STALE_AFTER_MINUTES,
    expectsHomePush: EXPECTS_HOME_PUSH,
    notifCount,
    linkCount,
    dataValid,
    triggerPending,
    message: !cache.data
      ? 'אין נתונים — הרץ fresh_pull או start_daemon במחשב הבית'
      : loginPageInLinks
        ? 'הנתונים נראים לא תקינים (דף התחברות?) — הרץ WEBTOP_CAPTURE=true'
        : 'המערכת פעילה',
  });
});

// GET /api/health — comprehensive data integrity check (auth required — exposes per-student counts)
app.get('/api/health', maybeAuth, (req, res) => {
  const result = getAuthenticatedUserCache(req);
  if (result?.error === 'unauthorized') return res.status(401).json({ error: 'Unauthorized' });
  const userCache = result?.cache;
  const checks = [];
  const d = userCache?.data?.data;
  const cacheAge = userCache?.timestamp ? Math.round((Date.now() - userCache.timestamp) / 1000) : null;

  // 1. Cache freshness
  if (!userCache?.data) {
    checks.push({ name: 'cache', status: 'FAIL', detail: 'No cached data' });
  } else if (cacheAge > DATA_STALE_SECONDS) {
    checks.push({ name: 'cache', status: 'WARN', detail: `Stale: ${Math.round(cacheAge/60)}min old` });
  } else {
    checks.push({ name: 'cache', status: 'OK', detail: `${Math.round(cacheAge/60)}min old` });
  }

  if (d) {
    // 2. Login page check
    const isLogin = (d.usefulLinks || []).some(l => (l.href || '').includes('forgotPassword'));
    checks.push({ name: 'auth', status: isLogin ? 'FAIL' : 'OK', detail: isLogin ? 'Login page detected' : 'Authenticated' });

    // 3. Per-student data — filtered per requesting parent (admin sees all)
    const expected = allowedChildrenForRequest(req).children.map(c => c.name);
    for (const name of expected) {
      const shortName = name.split(' ').pop();
      for (const mapName of ['classEventsByStudent', 'homeworkByStudent', 'gradesByStudent']) {
        const map = d[mapName] || {};
        const keys = Object.keys(map);
        const has = keys.some(k => k === name || k === shortName);
        const count = has ? (map[name] || map[shortName] || []).length : 0;
        checks.push({
          name: `${mapName.replace('ByStudent','')}_${shortName}`,
          status: has ? 'OK' : 'WARN',
          detail: has ? `${count} items` : 'Missing'
        });
      }
    }

    // 4. Notifications per student
    const notifs = d.notifications || [];
    checks.push({ name: 'notifications_total', status: notifs.length > 0 ? 'OK' : 'WARN', detail: `${notifs.length} total` });
    for (const name of expected) {
      const shortName = name.split(' ').pop();
      const count = notifs.filter(n => n.student === shortName || n.student === name).length;
      checks.push({ name: `notifications_${shortName}`, status: count > 0 ? 'OK' : 'WARN', detail: `${count} notifications` });
    }

    // 5. Messages
    checks.push({ name: 'messages', status: (d.messages?.length || 0) > 0 ? 'OK' : 'INFO', detail: `${d.messages?.length || 0} messages` });
  }

  const hasFail = checks.some(c => c.status === 'FAIL');
  const hasWarn = checks.some(c => c.status === 'WARN');
  res.json({
    healthy: !hasFail,
    status: hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'OK',
    checks,
    timestamp: new Date().toISOString()
  });
});

// GET /api/events — special events (birthdays, parent meetings)
app.get('/api/events', maybeAuth, (req, res) => { res.json(loadSpecialEvents()); });

// GET /api/children — per-child config (valid subjects, grade, birthdate) — filtered per parent
app.get('/api/children', maybeAuth, (req, res) => {
  const { children } = allowedChildrenForRequest(req);
  res.json({ children });
});

// GET /api/external-links — external sites (forms, webtop pages)
app.get('/api/external-links', maybeAuth, (req, res) => {
  try {
    if (existsSync(EXTERNAL_LINKS_FILE))
      return res.json(JSON.parse(readFileSync(EXTERNAL_LINKS_FILE, 'utf8')));
  } catch {}
  res.json({ links: [] });
});

// GET /api/schedule — weekly schedule per student
app.get('/api/schedule', maybeAuth, (req, res) => {
  const result = getAuthenticatedUserCache(req);
  if (result?.error === 'unauthorized') return res.status(401).json({ error: 'Unauthorized' });
  if (!result?.cache?.data) return res.status(503).json({ ok: false, error: 'No data yet', code: 'NO_CACHE_YET' });
  const schedule = result.cache?.data?.data?.scheduleByStudent || {};
  res.json({ ok: true, schedule });
});

// POST /api/children/:name/photo — save base64 photo for a child
app.post('/api/children/:name/photo', maybeAuth, express.json({ limit: '10mb' }), (req, res) => {
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
// ?student=אמי — optional filter by student name (fuzzy match)
app.get('/api/insights', maybeAuth, (req, res) => {
  const result = getAuthenticatedUserCache(req);
  if (result?.error === 'unauthorized') return res.status(401).json({ error: 'Unauthorized' });
  if (!result?.cache?.data) return res.status(503).json({ ok: false, error: 'No data yet', code: 'NO_CACHE_YET' });
  const studentFilter = req.query.student || '';
  let notifications = result.cache?.data?.data?.notifications || [];
  if (studentFilter) {
    notifications = notifications.filter(n => {
      const s = (n.student || '').trim();
      const f = studentFilter.trim();
      return s === f || f.endsWith(' ' + s) || s.endsWith(' ' + f) || f.includes(s) || s.includes(f);
    });
  }
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
app.post('/api/homework/done', maybeAuth, async (req, res) => {
  const {
    id, homeworkText, studentName,
    subject: bodySubject, date: bodyDate, lesson: bodyLesson,
    alertDay, description,
  } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });

  const status  = loadStatus();
  const now     = new Date();
  const parts   = id.split('_');
  // hwId format: student_subject_date_lesson
  const subject = bodySubject || parts[1] || '?';
  const date    = bodyDate    || parts[2] || '?';
  const lesson  = bodyLesson  || parts[3] || '?';

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
app.post('/api/approval/done', maybeAuth, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
  const status = loadStatus();
  status[id] = { approved: true, at: new Date().toISOString() };
  saveStatus(status);
  res.json({ ok: true, id, approved: true });
});

// POST /api/messages/read — mark message as read/unread
app.post('/api/messages/read', maybeAuth, (req, res) => {
  const { id, read = true } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
  const status = loadStatus();
  if (read) {
    status[id] = { read: true, at: new Date().toISOString() };
  } else {
    delete status[id];
  }
  saveStatus(status);
  res.json({ ok: true, id, read: !!read });
});

// POST /api/homework/undone — unmark (re-enables future reminders)
app.post('/api/homework/undone', maybeAuth, (req, res) => {
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

// POST /api/cookie — store cookie value sent via Telegram /cookie command
app.post('/api/cookie', (req, res) => {
  const { secret, cookie } = req.body || {};
  if (secret !== PUSH_SECRET) return res.status(403).json({ ok: false });
  if (!cookie || typeof cookie !== 'string' || cookie.length < 10) {
    return res.status(400).json({ ok: false, error: 'invalid cookie' });
  }
  pendingCookie = cookie.trim();
  pendingCookieAt = new Date().toISOString();
  console.log(`[cookie] Stored pending cookie (${cookie.length} chars) at ${pendingCookieAt}`);
  res.json({ ok: true, received: true });
});

// GET /api/poll-cookie — Windows machine polls; returns cookie and clears it
app.get('/api/poll-cookie', (req, res) => {
  const secret = req.query.secret || req.headers['x-push-secret'];
  if (secret !== PUSH_SECRET) return res.status(403).json({ ok: false });
  if (!pendingCookie) return res.json({ ok: true, pending: false });
  const cookie = pendingCookie;
  pendingCookie = null;
  console.log('[cookie] Cookie consumed by Windows machine');
  res.json({ ok: true, pending: true, cookie });
});

// POST /telegram/webhook — receive Telegram bot messages (/cookie command)
app.post('/telegram/webhook', async (req, res) => {
  res.json({ ok: true }); // always respond fast
  try {
    const msg = req.body?.message;
    if (!msg?.text) return;
    const text = msg.text.trim();
    const chatId = String(msg.chat?.id || '');

    if (text === '/start') {
      const existingUser = findUserByChatId(chatId);
      if (existingUser) {
        await sendTelegram(`שלום ${existingUser.name}! 👋 התראות כבר מחוברות לחשבונך.`, chatId, true);
      } else {
        telegramPendingLink.set(chatId, { step: 'awaiting_phone', ts: Date.now() });
        await sendTelegram('ברוך הבא ל-WebtopKids! 🎒\nשלח את מספר הטלפון שנרשמת איתו באפליקציה (לדוגמה: 054-1234567)', chatId, true);
      }
      return;
    }

    // Handle phone-link flow (any user)
    const pendingLink = telegramPendingLink.get(chatId);
    if (pendingLink?.step === 'awaiting_phone') {
      telegramPendingLink.delete(chatId);
      const normalized = text.replace(/[\s\-]/g, '');
      const allUsers = loadUsers();
      const matched = allUsers.find(u => u.phone.replace(/[\s\-]/g, '') === normalized);
      if (!matched) {
        await sendTelegram('❌ לא נמצא חשבון עם מספר זה. בדוק שהמספר נכון ונסה שוב עם /start', chatId, true);
      } else if (matched.status !== 'active') {
        await sendTelegram('⏳ החשבון שלך ממתין לאישור מנהל. כשיאושר — שלח /start שוב.', chatId, true);
      } else {
        updateUser(matched.id, { chatId });
        await sendTelegram(`✅ מעולה ${matched.name}! הטלגרם שלך מחובר. תקבל התראות על ${matched.children.join(', ') || 'הילדים שלך'}.`, chatId, true);
      }
      return;
    }

    if (!isTrustedTelegramCommandChat(chatId)) {
      console.warn('[telegram] Ignored message from unknown chat:', chatId);
      return;
    }

    if (text.startsWith('/cookie ')) {
      const cookieValue = text.slice('/cookie '.length).trim();
      if (cookieValue.length < 10) {
        await sendTelegram('❌ Cookie קצר מדי — נסה שוב', chatId, true);
        return;
      }
      pendingCookie = cookieValue;
      pendingCookieAt = new Date().toISOString();
      console.log(`[cookie] Received via Telegram (${cookieValue.length} chars)`);
      await sendTelegram('✅ Cookie התקבל! המחשב הביתי יחדש את ה-session תוך ~30 שניות.', chatId, true);

    } else if (text === '/status') {
      const ageMin = cache.timestamp
        ? Math.round((Date.now() - cache.timestamp) / 60000)
        : null;
      const d = cache.data?.data;
      const notifCount = d?.notifications?.length ?? 0;
      const isStale = ageMin !== null && ageMin > DATA_STALE_AFTER_MINUTES;
      const isLoginPage = (d?.usefulLinks || []).some(l => (l.href || '').includes('forgotPassword'));
      const lines = [
        isStale ? '⚠️ נתונים ישנים!' : '✅ המערכת פעילה',
        ageMin !== null ? `🕐 עדכון אחרון: לפני ${ageMin} דקות` : '📭 אין נתונים במטמון',
        `🔔 התראות: ${notifCount}`,
        isLoginPage ? '🔴 Session פג — שלח /cookie' : '',
        triggerPending ? '⏳ Refresh ממתין...' : '',
      ].filter(Boolean).join('\n');
      await sendTelegram(lines, chatId, true);

    } else if (text === '/refresh') {
      if (triggerPending) {
        await sendTelegram('⏳ Refresh כבר ממתין — המחשב הביתי יטפל בזה בקרוב.', chatId, true);
        return;
      }
      triggerPending = true;
      triggerRequestedAt = new Date().toISOString();
      console.log('[telegram] /refresh triggered via Telegram');
      await sendTelegram('🔄 בקשת Refresh נשלחה! המחשב הביתי יסרוק תוך ~30 שניות.', chatId, true);

    } else if (text === '/logs') {
      const { execSync } = await import('child_process');
      let logLines = '';
      try {
        logLines = execSync('pm2 logs webtop --lines 15 --nostream 2>&1 | tail -20', { encoding: 'utf8' });
      } catch { logLines = 'לא ניתן לקרוא לוגים'; }
      await sendTelegram('📋 לוגים אחרונים:\n' + logLines.slice(0, 3500), chatId, true);

    } else if (text === '/help') {
      await sendTelegram([
        '🤖 <b>Webtop Bot — פקודות זמינות:</b>',
        '',
        '/status — סטטוס המערכת',
        '/refresh — סרוק עכשיו',
        '/logs — לוגים אחרונים',
        '/cookie &lt;value&gt; — חדש session',
        '/help — הצג עזרה זו',
      ].join('\n'), chatId, true);

    } else {
      await sendTelegram(`❓ פקודה לא מוכרת: <code>${text}</code>\nשלח /help לרשימת הפקודות.`, chatId, true);
    }
  } catch (e) {
    console.error('[telegram/webhook] Error:', e.message);
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: 'Missing phone or password' });
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const user = findUserByPhone(phone);
  if (!user) return res.status(401).json({ error: 'פרטים שגויים' });
  if (user.status === 'pending') {
    return res.status(403).json({
      error: 'החשבון ממתין לאישור מנהל. אחרי האישור תוכל להיכנס כאן — לא צריך להירשם שוב.',
      code: 'pending',
    });
  }
  if (user.status !== 'active') {
    return res.status(403).json({
      error: 'החשבון לא פעיל (למשל מנהל מושבת). פנה למנהל המערכת או היכנס כחשבון הורה פעיל.',
      code: 'inactive',
    });
  }
  const ok = await checkPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'פרטים שגויים' });
  updateUser(user.id, {
    lastLogin: new Date().toISOString(),
    lastLoginIp: ip,
    loginCount: (user.loginCount || 0) + 1
  });
  const token = signJwt({ id: user.id, role: user.role, name: user.name });
  res.json({ token, name: user.name, role: user.role });
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  if (!ENABLE_PUBLIC_REGISTRATION) {
    return res.status(403).json({ error: 'ההרשמה הציבורית כבויה כרגע' });
  }
  const { name, phone, password, children } = req.body || {};
  if (!name || !phone || !password) return res.status(400).json({ error: 'שם, טלפון וסיסמה הם שדות חובה' });
  if (findUserByPhone(phone)) return res.status(409).json({ error: 'מספר טלפון זה כבר רשום' });
  const passwordHash = await hashPassword(password);
  const childList = Array.isArray(children)
    ? children.map(c => String(c).trim()).filter(Boolean)
    : [];
  createUser({ name, phone, passwordHash, chatId: null, role: 'parent', status: 'pending', children: childList });
  res.json({ ok: true });
});

// GET /register
app.get('/register', (req, res) => {
  if (!ENABLE_PUBLIC_REGISTRATION) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.sendFile(join(__dirname, 'public', 'register.html'));
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, role: user.role, children: user.children });
});

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'login.html'));
});

// POST /api/token-submit — bookmarklet sends webToken
app.post('/api/token-submit', async (req, res) => {
  const { token, phone } = req.body || {};
  if (!token || token.length < 20) return res.json({ message: 'Token קצר מדי — ודא שאתה מחובר ל-Webtop' });
  if (!phone) return res.json({ message: 'נא להזין מספר טלפון' });
  const user = findUserByPhone(phone);
  if (!user) {
    await sendTelegram(`📥 Token חדש מ-${phone} (לא רשום במערכת)\nיש להוסיף הורה זה ולאשר.`);
    return res.json({ message: 'Token התקבל. המנהל יאשר את חיבורך בקרוב.' });
  }
  updateUser(user.id, {
    tokenPendingApproval: encryptToken(token),
    tokenSubmittedAt: new Date().toISOString(),
  });
  await sendTelegram(`📥 Token חדש מ-${user.name} (${phone})\nממתין לאישורך.`);
  res.json({ message: 'Token התקבל! ממתין לאישור המנהל.' });
});

// GET /admin — serve admin dashboard (auth enforced client-side via JS token check)
app.get('/admin', (req, res) => {
  if (!ENABLE_ADMIN_UI) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

// GET /api/admin/users
app.get('/api/admin/users', requireAdminPassword, (req, res) => {
  const users = loadUsers().map(u => ({
    id: u.id, name: u.name, phone: u.phone,
    children: u.children || [],
    status: u.status, lastLogin: u.lastLogin,
    lastLoginIp: u.lastLoginIp, loginCount: u.loginCount,
    chatId: u.chatId, tokenUpdatedAt: u.webTokenUpdatedAt,
    hasPendingToken: !!u.tokenPendingApproval
  }));
  res.json(users);
});

// POST /api/admin/users/:id/approve-token
app.post('/api/admin/users/:id/approve-token', requireAdminPassword, async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user?.tokenPendingApproval) return res.status(400).json({ error: 'No pending token' });
  updateUser(user.id, {
    webTokenEncrypted: user.tokenPendingApproval,
    webTokenUpdatedAt: new Date().toISOString(),
    tokenPendingApproval: null,
    status: 'active'
  });
  if (user.chatId) await sendTelegram('✅ חשבונך חובר! אפשר להיכנס לאפליקציה.', user.chatId, true);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/disable
app.post('/api/admin/users/:id/disable', requireAdminPassword, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  updateUser(req.params.id, { status: 'disabled' });
  res.json({ ok: true });
});

// POST /api/admin/users/:id/activate
app.post('/api/admin/users/:id/activate', requireAdminPassword, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  updateUser(user.id, { status: 'active' });
  res.json({ ok: true });
});

// Fallback → index.html
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ─── Telegram polling (replaces webhook — works without HTTPS) ────────────────
async function handleTelegramMessage(msg) {
  if (!msg?.text) return;
  const text = msg.text.trim();
  const chatId = String(msg.chat?.id || '');

  if (text === '/start') {
    try {
      const existingUser = findUserByChatId(chatId);
      if (existingUser) {
        await sendTelegram(`שלום ${existingUser.name}! 👋 התראות כבר מחוברות לחשבונך.`, chatId, true);
      } else {
        telegramPendingLink.set(chatId, { step: 'awaiting_phone', ts: Date.now() });
        await sendTelegram('ברוך הבא ל-WebtopKids! 🎒\nשלח את מספר הטלפון שנרשמת איתו באפליקציה (לדוגמה: 054-1234567)', chatId, true);
      }
    } catch (e) {
      console.error('[telegram/poll] /start error:', e.message);
    }
    return;
  }

  // Handle phone-link flow (any user)
  const pendingLinkPoll = telegramPendingLink.get(chatId);
  if (pendingLinkPoll?.step === 'awaiting_phone') {
    telegramPendingLink.delete(chatId);
    const normalized = text.replace(/[\s\-]/g, '');
    const allUsers = loadUsers();
    const matched = allUsers.find(u => u.phone.replace(/[\s\-]/g, '') === normalized);
    try {
      if (!matched) {
        await sendTelegram('❌ לא נמצא חשבון עם מספר זה. בדוק שהמספר נכון ונסה שוב עם /start', chatId, true);
      } else if (matched.status !== 'active') {
        await sendTelegram('⏳ החשבון שלך ממתין לאישור מנהל. כשיאושר — שלח /start שוב.', chatId, true);
      } else {
        updateUser(matched.id, { chatId });
        await sendTelegram(`✅ מעולה ${matched.name}! הטלגרם שלך מחובר. תקבל התראות על ${matched.children.join(', ') || 'הילדים שלך'}.`, chatId, true);
      }
    } catch (e) {
      console.error('[telegram/poll] phone-link error:', e.message);
    }
    return;
  }

  if (!isTrustedTelegramCommandChat(chatId)) {
    console.warn('[telegram] Ignored message from unknown chat:', chatId);
    return;
  }
  // Inline command dispatch (mirrors webhook handler)
  try {
    if (text.startsWith('/cookie ')) {
      const cookieValue = text.slice('/cookie '.length).trim();
      if (cookieValue.length < 10) { await sendTelegram('❌ Cookie קצר מדי — נסה שוב', chatId, true); return; }
      pendingCookie = cookieValue;
      pendingCookieAt = new Date().toISOString();
      console.log(`[cookie] Received via Telegram polling (${cookieValue.length} chars)`);
      await sendTelegram('✅ Cookie התקבל! המחשב הביתי יחדש את ה-session תוך ~30 שניות.', chatId, true);
    } else if (text === '/status') {
      const ageMin = cache.timestamp ? Math.round((Date.now() - cache.timestamp) / 60000) : null;
      const d = cache.data?.data;
      const notifCount = d?.notifications?.length ?? 0;
      const isLoginPage = (d?.usefulLinks || []).some(l => (l.href || '').includes('forgotPassword'));
      const lines = [
        (ageMin !== null && ageMin > DATA_STALE_AFTER_MINUTES) ? '⚠️ נתונים ישנים!' : '✅ המערכת פעילה',
        ageMin !== null ? `🕐 עדכון אחרון: לפני ${ageMin} דקות` : '📭 אין נתונים במטמון',
        `🔔 התראות: ${notifCount}`,
        isLoginPage ? '🔴 Session פג — שלח /cookie' : '',
        triggerPending ? '⏳ Refresh ממתין...' : '',
      ].filter(Boolean).join('\n');
      await sendTelegram(lines, chatId, true);
    } else if (text === '/refresh') {
      if (triggerPending) { await sendTelegram('⏳ Refresh כבר ממתין — המחשב הביתי יטפל בזה בקרוב.', chatId, true); return; }
      triggerPending = true;
      triggerRequestedAt = new Date().toISOString();
      console.log('[telegram] /refresh triggered via Telegram polling');
      await sendTelegram('🔄 בקשת Refresh נשלחה! המחשב הביתי יסרוק תוך ~30 שניות.', chatId, true);
    } else if (text === '/logs') {
      const { execSync } = await import('child_process');
      let logLines = '';
      try { logLines = execSync('pm2 logs webtop --lines 15 --nostream 2>&1 | tail -20', { encoding: 'utf8' }); }
      catch { logLines = 'לא ניתן לקרוא לוגים'; }
      await sendTelegram('📋 לוגים אחרונים:\n' + logLines.slice(0, 3500), chatId, true);
    } else if (text === '/help') {
      await sendTelegram([
        '🤖 <b>Webtop Bot — פקודות זמינות:</b>',
        '',
        '/status — סטטוס המערכת',
        '/refresh — סרוק עכשיו',
        '/logs — לוגים אחרונים',
        '/cookie &lt;value&gt; — חדש session',
        '/help — הצג עזרה זו',
      ].join('\n'), chatId, true);
    } else {
      await sendTelegram(`❓ פקודה לא מוכרת: <code>${text}</code>\nשלח /help לרשימת הפקודות.`, chatId, true);
    }
  } catch (e) {
    console.error('[telegram/poll] Error handling command:', e.message);
  }
}

let tgOffset = 0;
let tgPolling = false;
async function pollTelegram() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  if (tgPolling) return; // prevent concurrent polls
  tgPolling = true;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${tgOffset}&timeout=25&limit=10`
    );
    if (!res.ok) {
      console.error('[telegram] getUpdates failed:', res.status);
      if (res.status === 409) {
        // Another instance is polling — wait 30s for it to time out
        console.warn('[telegram] 409 Conflict — waiting 30s for old connection to expire');
        await new Promise(r => setTimeout(r, 30000));
      } else {
        await new Promise(r => setTimeout(r, 5000));
      }
    } else {
      const json = await res.json();
      if (json.ok && json.result?.length) {
        for (const update of json.result) {
          tgOffset = update.update_id + 1;
          await handleTelegramMessage(update.message);
        }
      }
    }
  } catch (e) {
    console.error('[telegram] poll error:', e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
  tgPolling = false;
  // Schedule next poll (100ms gap to avoid tight loop)
  setTimeout(pollTelegram, 100);
}

// ─── Startup ──────────────────────────────────────────────────────────────────
loadCacheFromFile();
app.listen(PORT, () => {
  console.log(`Webtop dashboard running on http://localhost:${PORT}`);
  console.log(`[config] Public registration: ${ENABLE_PUBLIC_REGISTRATION}`);
  console.log(`[config] Admin UI: ${ENABLE_ADMIN_UI}`);
  const hh = [...telegramHouseholdChatIds()].join(', ');
  if (hh) console.log(`[config] Telegram household (shared alerts): ${hh}`);
  startDeadlineReminders();
  startLocalScraper();
  if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    pollTelegram();
    console.log('[telegram] Polling started — bot ready');
  }
});
