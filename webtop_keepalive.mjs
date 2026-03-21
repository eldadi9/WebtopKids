#!/usr/bin/env node
/**
 * webtop_keepalive.mjs — Session Keep-Alive Daemon
 *
 * Keeps the Webtop browser session alive by pinging the dashboard every 8 minutes.
 * This prevents the server-side session from expiring due to inactivity.
 *
 * Architecture:
 *   - Maintains ONE persistent Playwright browser context (same .webtop_profile/ as scraper)
 *   - Uses playwright-extra + stealth plugin to avoid bot-detection
 *   - Pings dashboard every KEEPALIVE_INTERVAL minutes (default: 8)
 *   - If session expires: auto-login (CapSolver or manual CAPTCHA in headed browser)
 *   - push_loop.mjs continues to run independently for data scraping
 *
 * Usage:
 *   node webtop_keepalive.mjs
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL      = 'https://webtop.smartschool.co.il';
const DASHBOARD_URL = `${BASE_URL}/dashboard`;
const LOGIN_URL     = `${BASE_URL}/account/login`;
const PROFILE_DIR   = resolve(process.env.WEBTOP_PROFILE || join(__dirname, '.webtop_profile'));
const SCRAPING_LOCK = join(__dirname, '.scraping_lock'); // push_loop writes this when scraper is running
const USER          = process.env.WEBTOP_USER;
const PASS          = process.env.WEBTOP_PASS;
const KEEPALIVE_INTERVAL = parseInt(process.env.KEEPALIVE_INTERVAL || '8', 10); // minutes
const TIMEOUT       = 30_000;

const TG_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID      = process.env.TELEGRAM_CHAT_ID;
const CAPSOLVER_KEY   = process.env.CAPSOLVER_KEY;   // optional — enables auto-CAPTCHA solve
const RECAPTCHA_SITEKEY = '6Lf-Bz4qAAAAAClftyz9ZpD7TJ93bQ15wpoiuLLJ'; // webtop.smartschool.co.il

function log(msg) {
  const ts = new Date().toLocaleTimeString('he-IL', { hour12: false });
  console.log(`[keepalive ${ts}] ${msg}`);
}

async function sendTelegram(msg) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {}
}

// ─── Shared launch options ────────────────────────────────────────────────────
const LAUNCH_OPTS = {
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=TranslateUI',
    '--disable-infobars',
    '--no-first-run',
  ],
  ignoreDefaultArgs: ['--enable-automation'],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'he-IL',
  timezoneId: 'Asia/Jerusalem',
};

// ─── Launch patchright headless context (for keepalive pings) ─────────────────
// patchright patches Chromium at binary level — stronger anti-detection than playwright-extra
async function launchStealthContext() {
  const { chromium } = await import('patchright');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // headed is less detectable; keepalive uses no visible window in background
    channel: 'chrome', // use installed Chrome if available, else fall back to bundled Chromium
    ...LAUNCH_OPTS,
  }).catch(() =>
    // Fallback: bundled Chromium (no channel)
    chromium.launchPersistentContext(PROFILE_DIR, { headless: false, ...LAUNCH_OPTS })
  );
  return context;
}

// ─── Solve reCAPTCHA via CapSolver (if CAPSOLVER_KEY is set) ──────────────────
async function solveRecaptchaWithCapsolver(page) {
  const { default: Capsolver } = await import('capsolver-npm');
  const solver = new Capsolver({ apiKey: CAPSOLVER_KEY });
  log('Sending reCAPTCHA to CapSolver...');
  const result = await solver.solve({
    type: 'ReCaptchaV2TaskProxyLess',
    websiteURL: LOGIN_URL,
    websiteKey: RECAPTCHA_SITEKEY,
  });
  const token = result?.solution?.gRecaptchaResponse;
  if (!token) throw new Error('CapSolver returned no token');
  log(`CapSolver token received (${token.slice(0, 20)}...)`);

  // Inject token into hidden textarea and trigger the callback
  await page.evaluate((t) => {
    const ta = document.querySelector('#g-recaptcha-response, [name="g-recaptcha-response"]');
    if (ta) { ta.value = t; ta.style.display = 'block'; }
    // Also call the grecaptcha callback if present
    if (window.___grecaptcha_cfg?.clients) {
      for (const clientKey of Object.keys(window.___grecaptcha_cfg.clients)) {
        const client = window.___grecaptcha_cfg.clients[clientKey];
        const cb = client?.U?.callback || client?.aa?.callback;
        if (typeof cb === 'function') { cb(t); break; }
      }
    }
  }, token);
}

// ─── Auto-login with patchright using persistent profile ──────────────────────
// If CAPSOLVER_KEY is set: fully automated — no human interaction needed.
// If not set: opens a visible browser window and waits up to 5 min for manual CAPTCHA solve.
// Uses persistent profile so cookies write directly to disk.
async function autoLogin() {
  const automated = !!CAPSOLVER_KEY;
  log(`Session expired — auto-login (${automated ? 'CapSolver auto-CAPTCHA' : 'manual CAPTCHA, opening browser'})...`);
  const { chromium } = await import('patchright');

  const loginContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: automated, // headless when CapSolver handles CAPTCHA; headed for manual solve
    channel: 'chrome',
    ...LAUNCH_OPTS,
  }).catch(() =>
    chromium.launchPersistentContext(PROFILE_DIR, { headless: automated, ...LAUNCH_OPTS })
  );

  const page = await loginContext.newPage();
  page.setDefaultTimeout(automated ? 60_000 : 300_000);

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Fill credentials
    const userField = page.locator('input[name="username"], input[type="text"]').first();
    const passField = page.locator('input[name="password"], input[type="password"]').first();
    await userField.waitFor({ state: 'visible', timeout: 10_000 });
    await userField.fill(USER || '');
    await passField.fill(PASS || '');

    if (automated) {
      // Auto-solve CAPTCHA via CapSolver, then click submit
      await solveRecaptchaWithCapsolver(page);
      await new Promise(r => setTimeout(r, 1000));
      const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
      await submitBtn.click();
      log('Credentials + CAPTCHA submitted — waiting for redirect...');
    } else {
      log('Credentials filled. Please solve the CAPTCHA and click Login (up to 5 min)...');
      await sendTelegram('🔐 WebtopKids: פתחתי דפדפן לחידוש Session. פתח/י את הדפדפן ופתור/י את הCAPTCHA.');
    }

    // Wait for navigation away from login page
    await page.waitForFunction(
      () => !window.location.href.includes('/account/login') && !window.location.href.includes('/login'),
      { timeout: automated ? 30_000 : 300_000, polling: 1000 }
    );

    await new Promise(r => setTimeout(r, 4000)); // Let cookies write to disk
    log('Login succeeded! Profile saved with fresh session.');

    await loginContext.close();
  } catch (err) {
    await loginContext.close().catch(() => {});
    throw err;
  }
}

// ─── Yield profile lock to scraper ────────────────────────────────────────────
// push_loop writes .scraping_lock before spawning the scraper subprocess.
// keepalive detects this (via background watcher + ping-start check), closes its context
// (releasing the Chromium profile lock), waits for lock to disappear, then reopens.
let yieldingToScraper = false;

async function waitForScraperFinish() {
  if (!existsSync(SCRAPING_LOCK)) return;
  if (yieldingToScraper) {
    // Already yielding — just wait
    while (existsSync(SCRAPING_LOCK)) await new Promise(r => setTimeout(r, 500));
    return;
  }
  yieldingToScraper = true;
  log('Scraper lock detected — closing context to yield profile lock...');
  await context?.close().catch(() => {});
  context = null;
  page = null;
  // Poll until lock file is gone (scraper finished)
  while (existsSync(SCRAPING_LOCK)) {
    await new Promise(r => setTimeout(r, 1000));
  }
  yieldingToScraper = false;
  log('Scraper finished — profile lock released, keepalive will reopen context on next ping');
}

// Background watcher: checks for scraping lock every 2s so we yield promptly
// even if keepalive is between scheduled pings.
setInterval(async () => {
  if (!yieldingToScraper && existsSync(SCRAPING_LOCK)) {
    await waitForScraperFinish();
  }
}, 2000);

// ─── Main keepalive loop ──────────────────────────────────────────────────────
let context = null;
let page = null;
let consecutiveFailures = 0;

async function ping() {
  // Yield to scraper if it's running
  await waitForScraperFinish();

  try {
    if (!context || !page) {
      log('Initializing stealth browser context...');
      context = await launchStealthContext();
      page = await context.newPage();
      page.setDefaultTimeout(TIMEOUT);
      await page.setViewportSize({ width: 1400, height: 900 });
    }

    log(`Pinging dashboard to keep session alive...`);
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await new Promise(r => setTimeout(r, 2000));

    const currentUrl = page.url();
    const sessionExpired = currentUrl.includes('/account/login') || currentUrl.includes('/login');

    if (sessionExpired) {
      log('Session expired — need to re-login');
      consecutiveFailures++;

      // Close the current context
      await context.close().catch(() => {});
      context = null;
      page = null;

      if (!USER || !PASS) {
        log('No credentials in .env — cannot auto-login');
        await sendTelegram('⚠️ WebtopKids Keep-Alive: Session פג, אין credentials לחדש');
        return;
      }

      // Try auto-login (uses same profile dir — writes cookies directly to disk)
      try {
        await autoLogin();
        log('Re-opening headless context with refreshed session...');

        // Re-open headless persistent context — profile now has fresh session cookies
        context = await launchStealthContext();
        page = await context.newPage();
        page.setDefaultTimeout(TIMEOUT);
        await page.setViewportSize({ width: 1400, height: 900 });

        // Verify login worked
        await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
        await new Promise(r => setTimeout(r, 2000));
        const urlAfterLogin = page.url();
        if (urlAfterLogin.includes('/login')) {
          throw new Error('Still on login page after login attempt');
        }

        log('Re-login successful — session restored ✓');
        consecutiveFailures = 0;
        await sendTelegram('✅ WebtopKids Keep-Alive: Session חודש בהצלחה');
      } catch (loginErr) {
        log(`Auto-login failed: ${loginErr.message}`);
        await sendTelegram(`⚠️ WebtopKids Keep-Alive: כישלון התחברות מחדש\n${loginErr.message.slice(0, 200)}`);
        // Close context and retry on next ping
        await context?.close().catch(() => {});
        context = null;
        page = null;
      }
      return;
    }

    // Session alive
    consecutiveFailures = 0;
    log(`Session alive ✓ (${currentUrl.split('/').pop() || 'dashboard'})`);

  } catch (err) {
    log(`Ping error: ${err.message}`);
    consecutiveFailures++;

    // Reset context on repeated errors
    if (consecutiveFailures >= 3) {
      log('3 consecutive failures — resetting browser context');
      await context?.close().catch(() => {});
      context = null;
      page = null;
      consecutiveFailures = 0;
    }
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
// push_loop + webtop_api_fetch.py renew auth each scrape (REST login). Browser keep-alive
// only maintains .webtop_profile/ for Playwright — if Python fetcher is on, it fights for
// the profile and triggers reCAPTCHA Telegram noise. Skip unless explicitly forced.
const pyFetcherPath = join(__dirname, 'webtop_api_fetch.py');
const pythonFetcherEnabled = existsSync(pyFetcherPath) && process.env.USE_API_FETCHER !== 'false';
if (pythonFetcherEnabled && process.env.WEBTOP_FORCE_KEEPALIVE !== 'true') {
  console.log('[keepalive] Not starting: USE_API_FETCHER uses webtop_api_fetch.py (no browser session needed).');
  console.log('[keepalive] For Playwright-only setups or extra profile pings: WEBTOP_FORCE_KEEPALIVE=true');
  process.exit(0);
}

console.log('╔═══════════════════════════════════════╗');
console.log('║  Webtop Keep-Alive Daemon             ║');
console.log('╚═══════════════════════════════════════╝');
console.log(`  Profile:  ${PROFILE_DIR}`);
console.log(`  Ping every ${KEEPALIVE_INTERVAL} min`);
console.log(`  Started:  ${new Date().toLocaleString('he-IL')}`);
console.log('');

// Initial ping immediately
await ping();

// Then ping on interval
setInterval(ping, KEEPALIVE_INTERVAL * 60 * 1000);

log(`Keep-alive running — Ctrl+C to stop`);

// Graceful shutdown
process.on('SIGINT',  async () => { await context?.close().catch(() => {}); process.exit(0); });
process.on('SIGTERM', async () => { await context?.close().catch(() => {}); process.exit(0); });
