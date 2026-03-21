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
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { spawn }                    from 'child_process';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';
import { savePendingCookie }        from './cookie_injector.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ─── Config ───────────────────────────────────────────────────────────────────
let VPS_URL = (process.env.VPS_URL || 'http://76.13.8.113:3001').replace(/\/$/, '');
if (VPS_URL.includes('/api/push')) VPS_URL = VPS_URL.replace(/\/api\/push.*$/, ''); // base URL only
const PUSH_SECRET     =  process.env.PUSH_SECRET      || 'webtop2026';
const SCRAPE_INTERVAL = parseInt(process.env.SCRAPE_INTERVAL || '15',  10); // minutes
const POLL_INTERVAL   = parseInt(process.env.POLL_INTERVAL   || '30',  10); // seconds
const RETRY_DELAY     = parseInt(process.env.RETRY_DELAY     || '120', 10); // seconds (2 min)
const MAX_RETRIES     = parseInt(process.env.MAX_RETRIES     || '3',   10); // max consecutive retries

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

// ─── Run the scraper ──────────────────────────────────────────────────────────
let activeScraperProc = null; // track child so we can kill it if needed

async function runScraper() {
  // Kill previous scraper if still running (shouldn't happen, but safety net)
  if (activeScraperProc) {
    try { activeScraperProc.kill(); } catch {}
    activeScraperProc = null;
  }

  // Prefer Python API fetcher if available; fall back to Playwright scraper
  const pyScript = join(__dirname, 'webtop_api_fetch.py');
  const jsScript = join(__dirname, 'webtop_scrape.mjs');
  const usePython = existsSync(pyScript) && process.env.USE_API_FETCHER !== 'false';

  if (!usePython) {
    // Write scraping lock — signals webtop_keepalive to close its context and yield the profile lock.
    writeFileSync(SCRAPING_LOCK, String(Date.now()));
    await new Promise(r => setTimeout(r, 3000));
  }

  return new Promise((resolve, reject) => {
    let proc;
    if (usePython) {
      const pythonBin = process.env.PYTHON_BIN || 'python';
      log(`Using Python API fetcher (${pythonBin})`);
      proc = spawn(pythonBin, [pyScript], { env: { ...process.env }, cwd: __dirname });
    } else {
      log('Using Playwright scraper (fallback)');
      const env = { ...process.env, WEBTOP_SESSION: join(__dirname, '.webtop_session.json') };
      proc = spawn(process.execPath, [jsScript], { env, cwd: __dirname });
    }
    activeScraperProc = proc;
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => (stdout += d));
    proc.stderr.on('data', d => (stderr += d));
    proc.on('close', code => {
      activeScraperProc = null;
      if (!usePython) {
        // Release profile lock — keepalive will reopen its context on next ping
        try { unlinkSync(SCRAPING_LOCK); } catch {}
      }
      if (stderr.trim()) log(`[scraper-stderr] ${stderr.trim().slice(0, 500)}`);
      if (code === 2) return reject(new Error('Session expired'));
      if (code !== 0) return reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 400)}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error(`JSON parse error: ${stdout.slice(0, 200)}`)); }
    });
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

// ─── Push data to VPS ────────────────────────────────────────────────────────
async function pushToVPS(data) {
  const res = await fetch(`${VPS_URL}/api/push`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ secret: PUSH_SECRET, data }),
    signal:  AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Scrape + push (one cycle, with auto-retry) ─────────────────────────────
let scrapeRunning = false;
async function scrapeAndPush(reason = 'scheduled', attempt = 1) {
  if (scrapeRunning && attempt === 1) {
    log(`Scrape already in progress — skipping (${reason})`);
    return;
  }
  scrapeRunning = true;
  const start = Date.now();
  log(`Scraping… (${reason}${attempt > 1 ? `, retry ${attempt}/${MAX_RETRIES}` : ''})`);
  try {
    const data = await runScraper();
    const links = data?.data?.usefulLinks || [];
    const isLoginPage = links.some(l => (l.href || '').includes('forgotPassword'));
    if (isLoginPage) {
      const msg = [
        '⚠️ Session של Webtop פג!',
        '',
        'כדי לחדש — לחץ פעמיים על הקובץ בשולחן העבודה:',
        '📁 "חדש Webtop Session"',
        '',
        'התחבר בדפדפן שנפתח → הדפדפן ייסגר לבד → הסנכרון יחזור אוטומטית.',
      ].join('\n');
      log('ERROR — Scrape returned login page. Sending Telegram alert with recovery instructions.');
      await sendTelegram(msg);
      await waitForCookieAndResume();
      return;
    }
    const notifCount = data?.data?.notifications?.length ?? 0;
    log(`Scraper OK — ${notifCount} notifications`);

    // Validate data integrity
    const issues = validateScrapeData(data);
    if (issues.length > 0) {
      for (const issue of issues) log(`[validate] ${issue}`);
      if (issues.some(i => i.startsWith('CRITICAL'))) {
        log('Data validation FAILED — not pushing');
        scrapeRunning = false;
        return;
      }
    } else {
      log('[validate] All checks passed ✓');
    }

    log(`Pushing to ${VPS_URL}…`);
    const result = await pushToVPS(data);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`Push OK — ${result.count ?? '?'} notifications received by VPS (${elapsed}s)`);
    scrapeRunning = false;
  } catch (e) {
    log(`ERROR — ${e.message}`);
    if (e.message.includes('Session expired')) {
      const msg = [
        '⚠️ Session של Webtop פג!',
        '',
        'כדי לחדש — לחץ פעמיים על הקובץ בשולחן העבודה:',
        '📁 "חדש Webtop Session"',
        '',
        'התחבר בדפדפן שנפתח → הדפדפן ייסגר לבד → הסנכרון יחזור אוטומטית.',
      ].join('\n');
      await sendTelegram(msg);
      log('Telegram alert sent — waiting for session recovery via desktop shortcut');
      await waitForCookieAndResume();
      return;
    }
    if (attempt < MAX_RETRIES) {
      log(`Retrying in ${RETRY_DELAY}s… (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, RETRY_DELAY * 1000));
      await scrapeAndPush(reason, attempt + 1);
    } else {
      log(`All ${MAX_RETRIES} attempts failed — will try again at next scheduled interval`);
      await sendTelegram(`⚠️ WebtopKids — דחיפת נתונים נכשלה\n\n${MAX_RETRIES} ניסיונות עקביים נכשלו.\nהנתונים לא עודכנו.\n\nשגיאה: ${e.message.slice(0, 200)}`);
      scrapeRunning = false;
    }
  }
}

// ─── Poll VPS for on-demand trigger ─────────────────────────────────────────
async function pollForTrigger() {
  try {
    const res = await fetch(
      `${VPS_URL}/api/poll?secret=${encodeURIComponent(PUSH_SECRET)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return; // silent on auth error (avoids log spam)
    const json = await res.json();
    if (json?.pending) {
      log(`Trigger requested by phone at ${json.requestedAt} — running on-demand scrape`);
      await scrapeAndPush('on-demand trigger');
    }
  } catch {
    // Network blip — silent (will retry on next poll interval)
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
async function waitForCookieAndResume() {
  log('[cookie] Waiting for /cookie command via Telegram (up to 30 min)...');
  scrapeRunning = false;
  // Poll every 15s for up to 30 minutes (120 × 15s = 30min)
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 15_000));
    const cookie = await pollForCookie();
    if (cookie) {
      log('[cookie] Cookie received — resuming scrape now');
      await scrapeAndPush('cookie-recovery');
      return;
    }
  }
  log('[cookie] Timed out waiting for cookie (30 min) — resuming normal schedule');
}

// ─── Telegram alert ──────────────────────────────────────────────────────────
const TG_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
async function sendTelegram(msg) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
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
  } catch { /* silent — don't crash the loop over an alert */ }
}

// ─── Logger with timestamp ────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toLocaleTimeString('he-IL', { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

// ─── Schedule ────────────────────────────────────────────────────────────────
// 1. Immediate push on startup
scrapeAndPush('startup');

// 2. Scheduled push every SCRAPE_INTERVAL minutes
setInterval(() => scrapeAndPush('scheduled'), SCRAPE_INTERVAL * 60 * 1000);

// 3. Poll for on-demand triggers every POLL_INTERVAL seconds
setInterval(pollForTrigger, POLL_INTERVAL * 1000);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// (SIGINT/SIGTERM already registered above near lock file setup)

log(`Push loop running — Ctrl+C to stop`);
