# Cookie Recovery Flow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Webtop session expires, automatically notify via Telegram and let the user restore it in under 60 seconds by sending a cookie value — without stopping the scraper permanently.

**Architecture:** VPS `server.js` exposes a `/api/cookie` endpoint + Telegram webhook handler for `/cookie <value>` commands. It stores the pending cookie and exposes it via `/api/poll-cookie`. `push_loop.mjs` on Windows polls for a pending cookie every 30s; when one arrives it writes it to `.webtop_profile/` and resumes scraping. A bookmarklet page helps the user copy the cookie value in one click.

**Tech Stack:** Node.js ESM, Express (server.js), Playwright persistent profile, Telegram Bot API

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server.js` | Modify | Add `/api/cookie` POST endpoint + `/api/poll-cookie` GET endpoint + Telegram webhook |
| `push_loop.mjs` | Modify | Poll for pending cookie, apply it, resume scraping |
| `cookie_injector.mjs` | Create | Write cookie value into `.webtop_profile/` Chromium cookies |
| `public/bookmarklet.html` | Create | User-facing page with bookmarklet + Hebrew instructions |

---

## Chunk 1: VPS Side — Cookie Endpoints in server.js

### Task 1: Add cookie state + `/api/cookie` POST endpoint

**Files:**
- Modify: `server.js` (after line ~735, before the fallback `*` route)

- [ ] **Step 1: Add in-memory cookie state** (after `let triggerPending = false;` block, ~line 48)

```javascript
// ─── Pending cookie (Telegram /cookie command → Windows machine) ──────────────
let pendingCookie = null;
let pendingCookieAt = null;
```

- [ ] **Step 2: Add POST /api/cookie endpoint** (after the `/api/poll` endpoint, before the `*` fallback)

```javascript
// POST /api/cookie — store cookie sent via Telegram /cookie command
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
```

- [ ] **Step 3: Add Telegram webhook handler**

Add after `/api/poll-cookie` and before `*` fallback:

```javascript
// POST /telegram/webhook — receive Telegram bot messages
app.post('/telegram/webhook', async (req, res) => {
  res.json({ ok: true }); // always respond fast
  try {
    const msg = req.body?.message;
    if (!msg?.text) return;
    const text = msg.text.trim();
    const chatId = String(msg.chat?.id || '');

    if (!TELEGRAM_CHAT_ID || chatId !== TELEGRAM_CHAT_ID) {
      console.warn('[telegram] Ignored message from unknown chat:', chatId);
      return;
    }

    if (text.startsWith('/cookie ')) {
      const cookieValue = text.slice('/cookie '.length).trim();
      if (cookieValue.length < 10) {
        await sendTelegram('❌ Cookie קצר מדי — נסה שוב');
        return;
      }
      pendingCookie = cookieValue;
      pendingCookieAt = new Date().toISOString();
      console.log(`[cookie] Received via Telegram (${cookieValue.length} chars)`);
      await sendTelegram('✅ Cookie התקבל! הכלב הביתי יחדש את ה-session תוך ~30 שניות.');
    } else if (text === '/status') {
      const ageMin = cache.timestamp
        ? Math.round((Date.now() - cache.timestamp) / 60000)
        : null;
      const msg = ageMin !== null
        ? `📊 סטטוס: נתונים בני ${ageMin} דקות`
        : '📊 סטטוס: אין נתונים במטמון';
      await sendTelegram(msg);
    }
  } catch (e) {
    console.error('[telegram/webhook] Error:', e.message);
  }
});
```

- [ ] **Step 4: Verify no syntax errors by checking the file structure**

Look at lines around the edit to confirm structure is correct.

---

### Task 2: Update the session-expired Telegram alert in push_loop.mjs

**Files:**
- Modify: `push_loop.mjs` (~line 178-183)

- [ ] **Step 1: Replace the existing login-page alert message** with one that includes bookmarklet instructions

Find:
```javascript
const msg = '⚠️ Webtop session expired — open the app and run:\n  WEBTOP_CAPTURE=true node webtop_scrape.mjs';
```

Replace with:
```javascript
const msg = [
  '⚠️ Session של Webtop פג!',
  '',
  'כדי לחדש:',
  '1. פתח את Webtop בדפדפן: https://webtop.smartschool.co.il',
  '2. לחץ על ה-Bookmarklet "Copy Webtop Cookie"',
  '3. שלח ל-Telegram: /cookie <הערך שהועתק>',
  '',
  '(דף עזר: http://76.13.8.113:3001/bookmarklet.html)',
].join('\n');
```

- [ ] **Step 2: Change `scrapeRunning = false; return;` to `await waitForCookieAndResume(); return;`**

This keeps the scraper alive, waiting for the cookie instead of stopping permanently.

---

## Chunk 2: Windows Side — Cookie Polling + Injection

### Task 3: Create `cookie_injector.mjs`

**Files:**
- Create: `cookie_injector.mjs`

`★ Insight ─────────────────────────────────────`
Chromium persistent profiles store cookies in a SQLite database at `.webtop_profile/Default/Cookies`. Writing to it directly requires the `better-sqlite3` package and is complex. A simpler approach: write the cookie to a JSON file that `webtop_scrape.mjs` reads at startup to seed the browser context — OR use Playwright's `addCookies()` API on the existing context. The simplest VPS-friendly approach is to write a small JSON file that push_loop reads and sets via `page.context().addCookies()` on next scrape.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Create `cookie_injector.mjs`**

```javascript
#!/usr/bin/env node
/**
 * cookie_injector.mjs — Write received cookie to .webtop_cookie_pending.json
 * push_loop reads this file on next scrape and injects it via Playwright addCookies
 */
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PENDING_FILE = join(__dirname, '.webtop_cookie_pending.json');

export function savePendingCookie(cookieValue) {
  const payload = {
    value: cookieValue,
    savedAt: new Date().toISOString(),
    domain: 'webtop.smartschool.co.il',
    name: 'session',  // adjust if the actual cookie name differs
    path: '/',
    httpOnly: true,
    secure: true,
  };
  writeFileSync(PENDING_FILE, JSON.stringify(payload, null, 2));
  console.log('[cookie_injector] Saved pending cookie to', PENDING_FILE);
}

export function loadAndClearPendingCookie() {
  if (!existsSync(PENDING_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(PENDING_FILE, 'utf8'));
    // Remove file after reading
    try { require('fs').unlinkSync(PENDING_FILE); } catch {}
    return data;
  } catch {
    return null;
  }
}
```

> **Note:** The actual cookie name may not be `session`. Step 2 documents how to find it.

- [ ] **Step 2: Find the real cookie name** *(manual step)*

Open Webtop in Chrome → DevTools → Application → Cookies → `webtop.smartschool.co.il`
Note the session cookie name and update the `name` field in `cookie_injector.mjs`.

Common candidates: `session`, `PHPSESSID`, `smartschool_session`, `.ASPXAUTH`

---

### Task 4: Add cookie polling to `push_loop.mjs`

**Files:**
- Modify: `push_loop.mjs`

- [ ] **Step 1: Import `savePendingCookie` at top of push_loop.mjs**

Add after existing imports:
```javascript
import { savePendingCookie } from './cookie_injector.mjs';
```

- [ ] **Step 2: Add `pollForCookie()` function** (after `pollForTrigger()` function)

```javascript
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
```

- [ ] **Step 3: Add `waitForCookieAndResume()` function**

```javascript
// ─── Wait for cookie recovery then resume ────────────────────────────────────
async function waitForCookieAndResume() {
  log('[cookie] Session expired — waiting for /cookie command via Telegram...');
  scrapeRunning = false;
  // Poll every 15s for up to 30 minutes
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 15_000));
    const cookie = await pollForCookie();
    if (cookie) {
      log('[cookie] Cookie received — will inject on next scrape');
      // Resume immediately
      await scrapeAndPush('cookie-recovery');
      return;
    }
  }
  log('[cookie] Timed out waiting for cookie (30 min) — resuming normal schedule');
}
```

- [ ] **Step 4: Replace `scrapeRunning = false; return;` in the login-page block** with:

```javascript
await waitForCookieAndResume();
return;
```

---

## Chunk 3: Playwright Cookie Injection in webtop_scrape.mjs

### Task 5: Inject pending cookie in webtop_scrape.mjs

**Files:**
- Modify: `webtop_scrape.mjs`

`★ Insight ─────────────────────────────────────`
`webtop_scrape.mjs` uses `chromium.launchPersistentContext()` which keeps all cookies automatically. To inject a new session cookie before the scrape runs, we can call `context.addCookies([...])` right after creating the context and before navigating. This is the cleanest Playwright-native approach — no SQLite required.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Read webtop_scrape.mjs to find where context is created**

Look for `launchPersistentContext` and the first `page.goto` call.

- [ ] **Step 2: Add cookie injection after context creation**

After `const context = await chromium.launchPersistentContext(...)`, add:

```javascript
// ─── Inject pending cookie (from /cookie Telegram command) ───────────────────
const PENDING_COOKIE_FILE = join(__dirname, '.webtop_cookie_pending.json');
if (existsSync(PENDING_COOKIE_FILE)) {
  try {
    const pending = JSON.parse(readFileSync(PENDING_COOKIE_FILE, 'utf8'));
    await context.addCookies([{
      name:     pending.name  || 'session',
      value:    pending.value,
      domain:   pending.domain || 'webtop.smartschool.co.il',
      path:     pending.path  || '/',
      httpOnly: pending.httpOnly ?? true,
      secure:   pending.secure   ?? true,
    }]);
    unlinkSync(PENDING_COOKIE_FILE);
    console.error('[scrape] Injected pending cookie from recovery flow');
  } catch (e) {
    console.error('[scrape] Cookie inject failed:', e.message);
  }
}
```

> Uses `console.error` for debug logs (stdout is parsed as JSON, stderr is for logs).

---

## Chunk 4: Public Bookmarklet Page

### Task 6: Create `public/bookmarklet.html`

**Files:**
- Create: `public/bookmarklet.html`

- [ ] **Step 1: Create the bookmarklet page**

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>עזרה: חידוש Session של Webtop</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .step { background: white; border-radius: 8px; padding: 16px; margin: 12px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .step-num { background: #4CAF50; color: white; border-radius: 50%; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; margin-left: 8px; }
    .bookmarklet-btn { display: inline-block; background: #2196F3; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-size: 16px; cursor: grab; }
    .bookmarklet-btn:hover { background: #1976D2; }
    .note { color: #666; font-size: 14px; margin-top: 8px; }
    code { background: #eee; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  </style>
</head>
<body>
  <h1>🔑 חידוש Session — Webtop</h1>
  <p>ה-Session של Webtop פג. בצע את הצעדים הבאים:</p>

  <div class="step">
    <span class="step-num">1</span>
    <strong>גרור את הכפתור הבא לסרגל הסימניות:</strong><br><br>
    <a class="bookmarklet-btn" href="javascript:(function(){var c=document.cookie.split(';').find(function(x){return x.trim().startsWith('session')||x.trim().startsWith('PHPSESSID')||x.trim().startsWith('smartschool');});if(!c){alert('Cookie לא נמצא — ודא שהתחברת');return;}var val='/cookie '+c.trim().split('=').slice(1).join('=');navigator.clipboard.writeText(val).then(function(){alert('הועתק! כעת הדבק ב-Telegram:\n'+val.slice(0,60)+'...');}).catch(function(){prompt('העתק ידנית:',val);});})();">
      📋 Copy Webtop Cookie
    </a>
    <p class="note">לחץ וגרור לסרגל הסימניות של הדפדפן</p>
  </div>

  <div class="step">
    <span class="step-num">2</span>
    <strong>כנס לאתר Webtop ולחץ על הסימנייה:</strong><br>
    <a href="https://webtop.smartschool.co.il" target="_blank">https://webtop.smartschool.co.il</a><br>
    <p class="note">ודא שאתה מחובר — אם לא, התחבר ואז לחץ על הסימנייה</p>
  </div>

  <div class="step">
    <span class="step-num">3</span>
    <strong>שלח את הערך שהועתק ל-Telegram:</strong><br>
    <p class="note">הדבק את התוכן שהועתק — אמור להיראות כך: <code>/cookie eyJhb...</code></p>
  </div>

  <div class="step">
    <span class="step-num">4</span>
    <strong>המתן ~30 שניות</strong> — המערכת תחדש את ה-session אוטומטית ✅
  </div>
</body>
</html>
```

---

## Chunk 5: Deploy + Verify

### Task 7: Deploy to VPS

- [ ] **Step 1: Run deploy.ps1** to push `server.js` and `public/bookmarklet.html` to VPS

```powershell
.\deploy.ps1
```

- [ ] **Step 2: Restart PM2 on VPS**

```bash
ssh root@76.13.8.113 "pm2 restart webtop"
```

- [ ] **Step 3: Verify endpoints exist**

```bash
curl -X POST http://76.13.8.113:3001/api/cookie \
  -H "Content-Type: application/json" \
  -d '{"secret":"webtop2026","cookie":"test_cookie_value_here"}'
# Expected: {"ok":true,"received":true}

curl "http://76.13.8.113:3001/api/poll-cookie?secret=webtop2026"
# Expected: {"ok":true,"pending":true,"cookie":"test_cookie_value_here"}
```

- [ ] **Step 4: Check bookmarklet page loads**

```
http://76.13.8.113:3001/bookmarklet.html
```

- [ ] **Step 5: (Optional) Register Telegram webhook**

If you want Telegram to push `/cookie` commands directly to VPS instead of polling:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=http://76.13.8.113:3001/telegram/webhook"
```

> Skip this step if you prefer to keep existing polling — both approaches work.

---

## Success Criteria

From the spec:
1. ✅ Session expires → Telegram alert sent within 2 min with bookmarklet instructions
2. ✅ User sends `/cookie <value>` → VPS stores it within seconds
3. ✅ Windows push_loop picks it up within 30s and injects the cookie
4. ✅ Next scrape succeeds with renewed session
5. ✅ Bookmarklet page accessible at `/bookmarklet.html`
