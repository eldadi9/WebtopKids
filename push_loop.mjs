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

import { readFileSync, existsSync } from 'fs';
import { spawn }                    from 'child_process';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';

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

if (!VPS_URL || VPS_URL.includes('your-')) {
  console.error('❌  VPS_URL is not set in .env — cannot start push_loop');
  console.error('    Add:  VPS_URL=http://76.13.8.113:3001  to .env');
  process.exit(1);
}

console.log('╔═══════════════════════════════════════╗');
console.log('║  Webtop Push Loop — Home Daemon       ║');
console.log('╚═══════════════════════════════════════╝');
console.log(`  VPS:       ${VPS_URL}`);
console.log(`  Push every ${SCRAPE_INTERVAL} min`);
console.log(`  Poll every ${POLL_INTERVAL}s for on-demand trigger`);
console.log(`  Started:   ${new Date().toLocaleString('he-IL')}`);
console.log('');

// ─── Run the scraper ──────────────────────────────────────────────────────────
function runScraper() {
  return new Promise((resolve, reject) => {
    const scraperPath = join(__dirname, 'webtop_scrape.mjs');
    const env = {
      ...process.env,
      WEBTOP_SESSION: join(__dirname, '.webtop_session.json'),
    };
    const proc = spawn(process.execPath, [scraperPath], { env, cwd: __dirname });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => (stdout += d));
    proc.stderr.on('data', d => (stderr += d));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 400)}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error(`JSON parse error: ${stdout.slice(0, 200)}`)); }
    });
  });
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

// ─── Scrape + push (one cycle) ───────────────────────────────────────────────
let scrapeRunning = false;
async function scrapeAndPush(reason = 'scheduled') {
  if (scrapeRunning) {
    log(`Scrape already in progress — skipping (${reason})`);
    return;
  }
  scrapeRunning = true;
  const start = Date.now();
  log(`Scraping… (${reason})`);
  try {
    const data = await runScraper();
    const links = data?.data?.usefulLinks || [];
    const isLoginPage = links.some(l => (l.href || '').includes('forgotPassword'));
    if (isLoginPage) {
      log(`ERROR — Scrape returned login page. Run WEBTOP_CAPTURE=true node webtop_scrape.mjs to re-login.`);
      return;
    }
    const notifCount = data?.data?.notifications?.length ?? 0;
    log(`Scraper OK — ${notifCount} notifications`);

    log(`Pushing to ${VPS_URL}…`);
    const result = await pushToVPS(data);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`Push OK — ${result.count ?? '?'} notifications received by VPS (${elapsed}s)`);
  } catch (e) {
    log(`ERROR — ${e.message}`);
  } finally {
    scrapeRunning = false;
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
process.on('SIGINT',  () => { log('Stopped by user (SIGINT)');  process.exit(0); });
process.on('SIGTERM', () => { log('Stopped by system (SIGTERM)'); process.exit(0); });

log(`Push loop running — Ctrl+C to stop`);
