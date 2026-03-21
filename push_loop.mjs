#!/usr/bin/env node
/**
 * push_loop.mjs — Home Machine Daemon
 *
 * Runs on the HOME COMPUTER and pushes fresh scraped data to the VPS every 15 min.
 * Also polls the VPS for on-demand trigger requests (phone hits "Refresh" button).
 *
 * Architecture:
 *   [Home PC] → runs webtop_scrape.mjs → POST /api/push to VPS every 15 min
 *   [Phone]   → taps Refresh → POST /api/trigger on VPS → sets a flag
 *   [Home PC] → polls GET /api/poll every 30s → sees flag → runs scraper immediately
 *
 * Usage:
 *   node push_loop.mjs                    # uses .env in same directory
 *   VPS_URL=https://myserver.com node push_loop.mjs
 *
 * .env keys used:
 *   VPS_URL         — e.g. https://myserver.com (required)
 *   PUSH_SECRET     — shared secret (default: webtop2026)
 *   SCRAPE_INTERVAL — minutes between pushes (default: 15)
 *   POLL_INTERVAL   — seconds between trigger polls (default: 30)
 *   PUSH_RETRY_FOREVER — if not "false", retry failed scrapes forever with backoff (default: on)
 *   RETRY_DELAY       — base seconds between retries (default: 120), grows by 1.5x each attempt (capped)
 *   RETRY_MAX_DELAY   — max seconds between retries (default: 600)
 *   MAX_RETRIES       — only used when PUSH_RETRY_FOREVER=false
 *   WEBTOP_TELEGRAM_MODE — off | session (default) | all
 *   SESSION_TELEGRAM_COOLDOWN_MS — מרווח בין התראות "סשן פג" (ברירת מחדל 24 שעות)
 *   PROACTIVE_TOKEN_REFRESH_MINUTES — כל כמה דקות לנסות רענון טוקן בשקט (ברירת מחדל 180)
 *   PROACTIVE_TOKEN_REFRESH=false — לכבות רענון רקע
 *   SCRAPER_TIMEOUT_MS — אחרי כמה ms להרוג את תהליך המשיכה אם נתקע (ברירת מחדל 600000 = 10 דק׳; 0 = ללא)
 *   PUSH_LOOP_LOG_FILE — קובץ לוג (ברירת מחדל push_loop_run.log); PUSH_LOOP_LOG_DISABLE=true לכיבוי
 *   PUSH_LOOP_HEARTBEAT_MINUTES — כל כמה דקות לרשום [heartbeat] ללוג (0 = כבוי; ברירת מחדל 60)
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, appendFileSync } from 'fs';
import { spawn }                    from 'child_process';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';
import { savePendingCookie }        from './cookie_injector.mjs';
import { runWebtopScraperChild }    from './webtop_scraper_child.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePushLoopLogPath() {
  if (process.env.PUSH_LOOP_LOG_DISABLE === 'true') return null;
  const raw = (process.env.PUSH_LOOP_LOG_FILE || 'push_loop_run.log')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!raw || raw === 'off') return null;
  if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) return raw;
  return join(__dirname, raw);
}

// ─── Load .env manually (no dotenv dependency) ────────────────────────────────
function loadDotEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

const PUSH_LOOP_LOG_PATH = resolvePushLoopLogPath();

// ─── Config ───────────────────────────────────────────────────────────────────
let VPS_URL = (process.env.VPS_URL || 'http://76.13.8.113:3001').replace(/\/$/, '');
if (VPS_URL.includes('/api/push')) VPS_URL = VPS_URL.replace(/\/api\/push.*$/, ''); // base URL only
const PUSH_SECRET     =  process.env.PUSH_SECRET      || 'webtop2026';
const SCRAPE_INTERVAL = parseInt(process.env.SCRAPE_INTERVAL || '15',  10); // minutes
const POLL_INTERVAL   = parseInt(process.env.POLL_INTERVAL   || '30',  10); // seconds
const RETRY_DELAY     = parseInt(process.env.RETRY_DELAY     || '120', 10); // seconds (2 min)
const RETRY_MAX_DELAY = parseInt(process.env.RETRY_MAX_DELAY || '600', 10); // cap backoff (10 min)
const MAX_RETRIES     = parseInt(process.env.MAX_RETRIES     || '3',   10); // when PUSH_RETRY_FOREVER=false
const RETRY_FOREVER   = process.env.PUSH_RETRY_FOREVER !== 'false';
const FAIL_TG_COOLDOWN_MS = parseInt(process.env.PUSH_FAILURE_TELEGRAM_COOLDOWN_MS || String(60 * 60 * 1000), 10);
/** off = אין הודעות | session = רק כשהסשן נגמר (מדולל) | all = גם כשלונות זמניים */
const TG_MODE = (process.env.WEBTOP_TELEGRAM_MODE || 'session').toLowerCase();
const SESSION_TG_COOLDOWN_MS = parseInt(
  process.env.SESSION_TELEGRAM_COOLDOWN_MS || String(24 * 60 * 60 * 1000),
  10,
);
const SESSION_TG_STAMP = join(__dirname, '.telegram_session_last.txt');
const PROACTIVE_TOKEN_REFRESH_MIN = parseInt(process.env.PROACTIVE_TOKEN_REFRESH_MINUTES || '180', 10);

const SESSION_EXPIRED_MSG = [
  '⚠️ WebtopKids: נדרש חידוש התחברות (פעם בכמה שבועות זה נורמלי).',
  '',
  'המחשב ממשיך לנסות לבד. אם אחרי מספר שעות אין נתונים — התחבר/י פעם אחת בדפדפן לאתר Webtop,',
  'או השתמש/י בקיצור "חדש Webtop Session" / פקודת /cookie לבוט.',
].join('\n');

let consecutiveScrapeFailures = 0;
let lastFailureTelegramAt = 0;

function needsSessionRecovery(msg) {
  const m = (msg || '').toLowerCase();
  return (
    m.includes('session expired')
    || m.includes('could not authenticate')
    || m.includes('webtoken')
    || m.includes('session file not found')
    || m.includes('api login failed')
    || m.includes('unauthorized')
    || /\b401\b/.test(msg || '')
  );
}

if (!VPS_URL || VPS_URL.includes('your-')) {
  console.error('❌  VPS_URL is not set in .env — cannot start push_loop');
  console.error('    Add:  VPS_URL=http://76.13.8.113:3001  to .env');
  process.exit(1);
}

// ─── Single-instance lock (prevents duplicate Telegram alerts) ────────────────
const LOCK_FILE     = join(__dirname, '.push_loop.lock');
const SCRAPING_LOCK = join(__dirname, '.scraping_lock'); // signals webtop_keepalive to yield profile
if (existsSync(LOCK_FILE)) {
  const lockPid = readFileSync(LOCK_FILE, 'utf8').trim();
  // Check if the PID from lock file is still alive
  let alive = false;
  try {
    process.kill(parseInt(lockPid, 10), 0); // signal 0 = existence check only
    alive = true;
  } catch {}
  if (alive && lockPid !== String(process.pid)) {
    console.error(`❌  Another push_loop is already running (PID ${lockPid}). Exiting.`);
    console.error(`    Kill it first: taskkill /PID ${lockPid} /F`);
    process.exit(1);
  }
}
writeFileSync(LOCK_FILE, String(process.pid));
process.on('exit',    () => { try { unlinkSync(LOCK_FILE); } catch {} try { unlinkSync(SCRAPING_LOCK); } catch {} });
process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

console.log('╔═══════════════════════════════════════╗');
console.log('║  Webtop Push Loop — Home Daemon       ║');
console.log('╚═══════════════════════════════════════╝');
console.log(`  VPS:       ${VPS_URL}`);
console.log(`  Push every ${SCRAPE_INTERVAL} min`);
console.log(`  Poll every ${POLL_INTERVAL}s for on-demand trigger`);
console.log(`  Started:   ${new Date().toLocaleString('he-IL')}`);
console.log('');

// ─── Run the scraper (timeout + spawn errors + lock ל-Playwright) ─────────────
async function runScraper() {
  return runWebtopScraperChild({
    log,
    useScrapingLock: true,
    scrapingLockPath: SCRAPING_LOCK,
  });
}

// ─── Data validation after scrape ────────────────────────────────────────────
function validateScrapeData(data) {
  const issues = [];
  const d = data?.data;
  if (!d) { issues.push('CRITICAL: No data object'); return issues; }

  // Check for login page
  const links = d.usefulLinks || [];
  if (links.some(l => (l.href || '').includes('forgotPassword'))) {
    issues.push('CRITICAL: Data is login page, not dashboard');
    return issues;
  }

  // Load expected children
  let children = [];
  try {
    children = JSON.parse(readFileSync(join(__dirname, 'children_config.json'), 'utf8')).children || [];
  } catch {}
  const expectedNames = children.map(c => c.name);

  // Per-student data checks
  const byStudentMaps = ['classEventsByStudent', 'homeworkByStudent', 'gradesByStudent'];
  for (const mapName of byStudentMaps) {
    const map = d[mapName] || {};
    const mapKeys = Object.keys(map);
    if (mapKeys.length === 0) {
      issues.push(`WARN: ${mapName} is empty`);
    }
    for (const name of expectedNames) {
      const shortName = name.split(' ').pop();
      const hasKey = mapKeys.some(k => k === name || k === shortName);
      if (!hasKey) issues.push(`WARN: ${mapName} missing data for "${name}"`);
    }
  }

  // Notifications
  const notifs = d.notifications || [];
  if (notifs.length === 0) {
    issues.push('WARN: Zero notifications');
  } else {
    const students = [...new Set(notifs.map(n => n.student))];
    for (const name of expectedNames) {
      const shortName = name.split(' ').pop();
      if (!students.some(s => s === name || s === shortName || name.includes(s))) {
        issues.push(`WARN: No notifications for "${name}"`);
      }
    }
  }

  // Messages (shared)
  if (!d.messages || d.messages.length === 0) {
    issues.push('INFO: No messages (may be normal)');
  }

  return issues;
}

// ─── Push data to VPS (retries — network / VPS blips) ───────────────────────
const PUSH_HTTP_RETRIES   = parseInt(process.env.PUSH_HTTP_RETRIES || '6', 10);
const PUSH_HTTP_TIMEOUT_MS = parseInt(process.env.PUSH_HTTP_TIMEOUT_MS || '30000', 10);

async function pushToVPS(data) {
  let lastErr;
  for (let i = 0; i < PUSH_HTTP_RETRIES; i++) {
    try {
      const res = await fetch(`${VPS_URL}/api/push`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ secret: PUSH_SECRET, data }),
        signal:  AbortSignal.timeout(PUSH_HTTP_TIMEOUT_MS),
      });
      if (res.ok) return res.json();
      const txt = await res.text().catch(() => '');
      lastErr = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
    const waitSec = Math.min(15 * Math.pow(2, i), 120);
    if (i < PUSH_HTTP_RETRIES - 1) {
      log(`[push] ניסיון ${i + 1}/${PUSH_HTTP_RETRIES} נכשל — ממתין ${waitSec}s…`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }
  throw lastErr;
}

// ─── Scrape + push (persistent retry — לא מוותרים עד הצלחה או שחזור סשן) ────
// scrapeRunning נשאר true גם בזמן המתנה לעוגייה — מונע סריקות מקבילות שחוסמות זו את זו
let scrapeRunning = false;

/** ליבה ללא נעילה — נקרא מ־scrapeAndPush או מתוך waitForCookieAndResume */
async function scrapeAndPushBody(reason = 'scheduled') {
  let attempt = 0;
  while (true) {
    attempt++;
    const start = Date.now();
    try {
      log(`Scraping… (${reason}${attempt > 1 ? `, ניסיון ${attempt}` : ''})`);
      const data = await runScraper();
      const links = data?.data?.usefulLinks || [];
      const isLoginPage = links.some(l => (l.href || '').includes('forgotPassword'));
      if (isLoginPage) {
        log('ERROR — Scrape returned login page.');
        await sendTelegram(SESSION_EXPIRED_MSG);
        await waitForCookieAndResume();
        return;
      }
      const notifCount = data?.data?.notifications?.length ?? 0;
      log(`Scraper OK — ${notifCount} notifications`);

      const issues = validateScrapeData(data);
      if (issues.length > 0) {
        for (const issue of issues) log(`[validate] ${issue}`);
        if (issues.some(i => i.startsWith('CRITICAL'))) {
          throw new Error(issues.filter(i => i.startsWith('CRITICAL')).join('; '));
        }
      } else {
        log('[validate] All checks passed ✓');
      }

      log(`Pushing to ${VPS_URL}…`);
      const result = await pushToVPS(data);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      log(`Push OK — ${result.count ?? '?'} notifications received by VPS (${elapsed}s)`);
      consecutiveScrapeFailures = 0;
      try {
        unlinkSync(SESSION_TG_STAMP);
      } catch { /* no stamp yet */ }
      return;
    } catch (e) {
      log(`ERROR — ${e.message}`);
      if (needsSessionRecovery(e.message)) {
        await sendTelegram(SESSION_EXPIRED_MSG);
        log('Auth/session issue — waiting for cookie recovery (VPS / Telegram / desktop)');
        await waitForCookieAndResume();
        return;
      }

      consecutiveScrapeFailures++;
      const delay = Math.min(
        Math.floor(RETRY_DELAY * Math.pow(1.5, Math.min(attempt - 1, 12))),
        RETRY_MAX_DELAY,
      );
      log(`Retrying in ${delay}s… (רצף כשלונות ${consecutiveScrapeFailures})`);

      const now = Date.now();
      const shouldTg =
        TG_MODE === 'all'
        && (consecutiveScrapeFailures === 1 || now - lastFailureTelegramAt >= FAIL_TG_COOLDOWN_MS);
      if (shouldTg) {
        lastFailureTelegramAt = now;
        await sendTelegram(
          `⚠️ WebtopKids — משיכה נכשלה (ניסיון ${consecutiveScrapeFailures})\n${e.message.slice(0, 180)}\n\nמנסים שוב אוטומטית.`,
          'failure',
        );
      }

      await new Promise(r => setTimeout(r, delay * 1000));

      if (!RETRY_FOREVER && attempt >= MAX_RETRIES) {
        log(`PUSH_RETRY_FOREVER=false — נעצר אחרי ${MAX_RETRIES} ניסיונות; יתחדש בסיבוב הבא מהטיימר`);
        return;
      }
    }
  }
}

async function scrapeAndPush(reason = 'scheduled') {
  if (scrapeRunning) {
    log(`Scrape already in progress — skipping (${reason})`);
    return;
  }
  scrapeRunning = true;
  try {
    await scrapeAndPushBody(reason);
  } finally {
    scrapeRunning = false;
  }
}

// ─── Poll VPS for on-demand trigger ─────────────────────────────────────────
let pollTriggerFailures = 0;

async function pollForTrigger() {
  try {
    const res = await fetch(
      `${VPS_URL}/api/poll?secret=${encodeURIComponent(PUSH_SECRET)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) {
      pollTriggerFailures++;
      if (pollTriggerFailures === 1 || pollTriggerFailures % 20 === 0) {
        log(`[poll/trigger] HTTP ${res.status} — ${pollTriggerFailures} כשלונות רצופים (כל ${POLL_INTERVAL}s)`);
      }
      return;
    }
    pollTriggerFailures = 0;
    const json = await res.json();
    if (json?.pending) {
      log(`Trigger requested by phone at ${json.requestedAt} — running on-demand scrape`);
      await scrapeAndPush('on-demand trigger');
    }
  } catch {
    pollTriggerFailures++;
    if (pollTriggerFailures === 1 || pollTriggerFailures % 20 === 0) {
      log(`[poll/trigger] אין חיבור ל-VPS — ${pollTriggerFailures} כשלונות רצופים (כל ${POLL_INTERVAL}s)`);
    }
  }
}

// ─── Poll VPS for pending cookie (after session expiry) ──────────────────────
async function pollForCookie() {
  try {
    const res = await fetch(
      `${VPS_URL}/api/poll-cookie?secret=${encodeURIComponent(PUSH_SECRET)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.pending && json?.cookie) {
      log(`[cookie] Received cookie from VPS (${json.cookie.length} chars)`);
      savePendingCookie(json.cookie);
      return json.cookie;
    }
  } catch {
    // Network blip — silent
  }
  return null;
}

// ─── Wait for cookie recovery then resume ────────────────────────────────────
const COOKIE_POLL_MS = parseInt(process.env.COOKIE_POLL_MS || '15000', 10);
const COOKIE_WAIT_ITERATIONS = parseInt(process.env.COOKIE_WAIT_ITERATIONS || '2880', 10); // 2880×15s ≈ 12h

async function waitForCookieAndResume() {
  log(`[cookie] ממתין לעוגייה מ-VPS/Telegram (עד ~${Math.round((COOKIE_WAIT_ITERATIONS * COOKIE_POLL_MS) / 3600000)} שעות)…`);
  for (let i = 0; i < COOKIE_WAIT_ITERATIONS; i++) {
    await new Promise(r => setTimeout(r, COOKIE_POLL_MS));
    const cookie = await pollForCookie();
    if (cookie) {
      log('[cookie] Cookie received — resuming scrape now');
      await scrapeAndPushBody('cookie-recovery');
      return;
    }
    if (i > 0 && i % 40 === 0) {
      log(`[cookie] עדיין ממתין לחידוש סשן… (~${Math.round((i * COOKIE_POLL_MS) / 60000)} דקות)`);
    }
  }
  log('[cookie] Timeout ארוך — חוזרים ללולאה הרגילה (המשיכות ימשיכו לנסות לבד)');
}

// ─── Telegram (מצב שקט כברירת מחדל) ───────────────────────────────────────────
const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
/**
 * kind: session = סשן פג | failure = כשל זמני | general
 * WEBTOP_TELEGRAM_MODE=session → רק session (ומדולל ב-SESSION_TELEGRAM_COOLDOWN_MS)
 */
async function sendTelegram(msg, kind = 'general') {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  if (TG_MODE === 'off') return;
  if (TG_MODE === 'session' && kind !== 'session') return;

  if (TG_MODE === 'session' && kind === 'session') {
    try {
      if (existsSync(SESSION_TG_STAMP)) {
        const last = parseInt(readFileSync(SESSION_TG_STAMP, 'utf8').trim(), 10);
        if (!Number.isNaN(last) && Date.now() - last < SESSION_TG_COOLDOWN_MS) return;
      }
    } catch { /* send */ }
  }

  try {
    await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: TG_CHAT_ID, text: msg }),
        signal:  AbortSignal.timeout(8_000),
      }
    );
    if (TG_MODE === 'session' && kind === 'session') {
      try {
        writeFileSync(SESSION_TG_STAMP, String(Date.now()));
      } catch { /* ignore */ }
    }
  } catch { /* silent */ }
}

// ─── Logger with timestamp (+ קובץ מידי — לא תלוי ב-buffer של stdout) ─────────
function log(msg) {
  const ts = new Date().toLocaleTimeString('he-IL', { hour12: false });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (PUSH_LOOP_LOG_PATH) {
    try {
      appendFileSync(PUSH_LOOP_LOG_PATH, `${line}\n`, 'utf8');
    } catch { /* ignore */ }
  }
}

// ─── רענון טוקן שקט (ללא דפדפן) — לפני שהסשן נשבר, ככל שהשרת מאפשר לוגין API ──
function spawnProactiveTokenRefresh() {
  const pyScript = join(__dirname, 'webtop_api_fetch.py');
  if (!existsSync(pyScript) || process.env.USE_API_FETCHER === 'false') return;
  if (process.env.PROACTIVE_TOKEN_REFRESH === 'false') return;
  if (scrapeRunning) return;
  const pythonBin = process.env.PYTHON_BIN || 'python';
  const proc = spawn(pythonBin, [pyScript], {
    env: { ...process.env, WEBTOP_REFRESH_TOKEN_ONLY: '1' },
    cwd: __dirname,
    stdio: 'ignore',
  });
  proc.on('error', (err) => {
    log(`[refresh] spawn נכשל: ${err.message}`);
  });
  proc.on('close', code => {
    if (code !== 0 || process.env.PUSH_DEBUG === 'true') {
      log(`[refresh] רענון טוקן רקע — קוד ${code}`);
    }
  });
}

// ─── Global safety — אל תקרוס על Promise שלא נתפס ───────────────────────────
process.on('unhandledRejection', (reason) => {
  log(`[push_loop] unhandledRejection: ${reason}`);
});

// ─── Schedule ────────────────────────────────────────────────────────────────
if (PUSH_LOOP_LOG_PATH) {
  try {
    appendFileSync(
      PUSH_LOOP_LOG_PATH,
      `\n======== ${new Date().toISOString()} | pid=${process.pid} | session start ========\n`,
      'utf8',
    );
  } catch { /* ignore */ }
}
log(`Push loop running — Ctrl+C to stop`);

// 1. Immediate push on startup
scrapeAndPush('startup');

// 2. Scheduled push every SCRAPE_INTERVAL minutes
setInterval(() => scrapeAndPush('scheduled'), SCRAPE_INTERVAL * 60 * 1000);

// 3. Poll for on-demand triggers every POLL_INTERVAL seconds
setInterval(pollForTrigger, POLL_INTERVAL * 1000);

const HEARTBEAT_MIN = parseInt(process.env.PUSH_LOOP_HEARTBEAT_MINUTES || '60', 10);
if (HEARTBEAT_MIN > 0) {
  setInterval(() => {
    log(`[heartbeat] פעיל — scrapeRunning=${scrapeRunning} | משיכה כל ${SCRAPE_INTERVAL}m | poll כל ${POLL_INTERVAL}s`);
  }, HEARTBEAT_MIN * 60 * 1000);
}

// 4. Proactive token refresh (no Chrome) — default every PROACTIVE_TOKEN_REFRESH_MIN minutes
if (process.env.PROACTIVE_TOKEN_REFRESH !== 'false') {
  setTimeout(() => spawnProactiveTokenRefresh(), 3 * 60 * 1000);
  setInterval(() => spawnProactiveTokenRefresh(), PROACTIVE_TOKEN_REFRESH_MIN * 60 * 1000);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// (SIGINT/SIGTERM already registered above near lock file setup)
