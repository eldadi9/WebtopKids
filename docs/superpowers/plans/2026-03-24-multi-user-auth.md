# Multi-User Auth & Per-Parent Data Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** הפוך את WebtopKids מאפליקציה חד-משתמשית לפלטפורמה מרובת הורים — כל הורה מחובר עם webToken שלו, רואה רק את הילדים שלו, ומקבל התראות Telegram אישיות.

**Architecture:** מוסיפים שכבת auth (JWT) מעל server.js הקיים. כל הורה רשום ב-`users.json` עם webToken מוצפן, chat_id של Telegram, ורשימת ילדים. push_loop רץ לכל הורה בנפרד ושומר cache נפרד. הפרונטאנד מוסיף מסך login בלבד — שאר ה-UI לא משתנה.

**Tech Stack:** Node.js ESM, bcryptjs, jsonwebtoken, crypto (AES-256 לhide token), Express middleware, vanilla JS frontend

---

## סקירת ארכיטקטורה

```
הורה חדש:
  1. מקבל bookmarklet מהמנהל
  2. נכנס ל-Webtop שלו → מריץ bookmarklet → token נשלח לשרת
  3. מנהל מאשר → הורה מקבל Telegram הודעה + קוד כניסה לאפליקציה

שוטף:
  push_loop → fetchForUser(userId) → cache_{userId}.json → /api/data (JWT)
  server.js → בודק JWT → מחזיר רק cache_{userId}.json
  Telegram → sendTelegram(user.chatId, msg) במקום TELEGRAM_CHAT_ID גלובלי
```

---

## מפת קבצים

| קובץ | סטטוס | תפקיד |
|---|---|---|
| `auth.mjs` | **חדש** | JWT sign/verify, bcrypt, הצפנת token |
| `users.mjs` | **חדש** | CRUD על users.json — טעינה, שמירה, חיפוש |
| `users.json` | **חדש** | מסד נתוני ההורים (בשרת, לא בגיט) |
| `server.js` | **שינוי** | הוספת middleware auth + routes login/register |
| `push_loop.mjs` | **שינוי** | לולאה לכל users במקום משתמש אחד |
| `webtop_api_fetch.py` | **שינוי** | קבלת userId + webToken כפרמטר במקום מ-.env |
| `public/login.html` | **חדש** | מסך כניסה נפרד |
| `public/admin.html` | **חדש** | לוח ניהול למנהל בלבד |
| `public/app.js` | **שינוי** | הוספת JWT header לכל fetch, redirect ל-login |
| `public/bookmarklet.html` | **חדש** | עמוד עם הbookmarklet + הוראות |
| `bookmarklet-receiver.mjs` | **חדש** | route מיוחד לקבלת token מbookmarklet |

---

## Task 1: מבנה נתוני משתמשים + users.mjs

**Files:**
- Create: `users.mjs`
- Create: `users.json` (template ריק)

### מבנה users.json

```json
{
  "users": [
    {
      "id": "uuid-v4",
      "name": "ישראל ישראלי",
      "phone": "050-0000000",
      "passwordHash": "$2b$10$...",
      "webTokenEncrypted": "aes256:iv:ciphertext",
      "webTokenUpdatedAt": "2026-03-24T10:00:00Z",
      "chatId": "123456789",
      "children": ["יולי", "אמי"],
      "role": "parent",
      "status": "active",
      "createdAt": "2026-03-24T10:00:00Z",
      "lastLogin": null,
      "lastLoginIp": null,
      "loginCount": 0,
      "tokenPendingApproval": null
    }
  ]
}
```

- [ ] **Step 1: צור users.json ריק**
```json
{ "users": [] }
```

- [ ] **Step 2: כתוב users.mjs**
```js
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_FILE = join(__dirname, 'users.json');

export function loadUsers() {
  if (!existsSync(USERS_FILE)) return [];
  return JSON.parse(readFileSync(USERS_FILE, 'utf8')).users || [];
}

export function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

export function findUserById(id) {
  return loadUsers().find(u => u.id === id) || null;
}

export function findUserByPhone(phone) {
  return loadUsers().find(u => u.phone === phone) || null;
}

export function updateUser(id, patch) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('User not found: ' + id);
  users[idx] = { ...users[idx], ...patch };
  saveUsers(users);
  return users[idx];
}

export function createUser(data) {
  const users = loadUsers();
  const user = { id: randomUUID(), loginCount: 0, createdAt: new Date().toISOString(), lastLogin: null, lastLoginIp: null, tokenPendingApproval: null, ...data };
  users.push(user);
  saveUsers(users);
  return user;
}
```

- [ ] **Step 3: commit**
```bash
git add users.mjs users.json
git commit -m "feat: user store — users.mjs + users.json schema"
```

---

## Task 2: auth.mjs — JWT + bcrypt + הצפנת webToken

**Files:**
- Create: `auth.mjs`

**Dependencies להתקין:**
```bash
npm install bcryptjs jsonwebtoken
```

- [ ] **Step 1: התקן dependencies**
```bash
npm install bcryptjs jsonwebtoken
```

- [ ] **Step 2: כתוב auth.mjs**
```js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production-32chars+';
const TOKEN_ENC_KEY = process.env.TOKEN_ENC_KEY || 'change-this-32-char-encryption-key!'; // 32 chars

// ─── Password ─────────────────────────────────────────────────────────────────
export const hashPassword  = (plain) => bcrypt.hash(plain, 10);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

// ─── JWT ──────────────────────────────────────────────────────────────────────
export function signJwt(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyJwt(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// ─── AES-256-CBC: הצפנת webToken לשמירה ב-users.json ─────────────────────────
export function encryptToken(plainToken) {
  const iv  = randomBytes(16);
  const key = Buffer.from(TOKEN_ENC_KEY.slice(0, 32));
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  return `aes256:${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(stored) {
  const [, ivHex, encHex] = stored.split(':');
  const key = Buffer.from(TOKEN_ENC_KEY.slice(0, 32));
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

// ─── Express middleware ───────────────────────────────────────────────────────
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  });
}
```

- [ ] **Step 3: הוסף ל-.env (לא לגיט!)**
```
JWT_SECRET=your-random-32+-char-secret-here
TOKEN_ENC_KEY=your-random-32-char-key-here!!
```

- [ ] **Step 4: ודא .gitignore כולל users.json ו-.env**
```bash
grep -E "users\.json|\.env" .gitignore || echo "users.json\n.env" >> .gitignore
```

- [ ] **Step 5: commit**
```bash
git add auth.mjs package.json package-lock.json
git commit -m "feat: auth — JWT, bcrypt, AES-256 webToken encryption"
```

---

## Task 3: Bookmarklet — קבלת webToken מהורה

**Files:**
- Create: `public/bookmarklet.html` — עמוד הוראות + קוד bookmarklet
- Modify: `server.js` — הוספת route `/api/token-submit`

### איך זה עובד
1. מנהל שולח להורה קישור לעמוד `bookmarklet.html`
2. ההורה נכנס ל-Webtop בדפדפן
3. גורר את ה-bookmarklet לסרגל הסימניות
4. לוחץ עליו בזמן שהוא ב-Webtop → הscript מוציא webToken ושולח לשרת
5. שרת שומר `tokenPendingApproval` במשתמש + שולח לטלגרם של המנהל

- [ ] **Step 1: צור bookmarklet.html**
```html
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><title>WebtopKids — חיבור חשבון</title></head>
<body>
<h2>חיבור חשבון Webtop</h2>
<p>1. היכנס ל-Webtop שלך בלשונית חדשה</p>
<p>2. גרור את הכפתור הזה לסרגל הסימניות:</p>
<a href="javascript:(function(){var t=document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('webToken='));if(!t){alert('לא נמצא webToken — ודא שאתה ב-Webtop ומחובר');return;}fetch('/api/token-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t.split('=').slice(1).join('='),phone:prompt('מספר הטלפון שלך (לצורך זיהוי):')})}).then(r=>r.json()).then(d=>alert(d.message||'נשלח!'));})()">
  📎 שלח Token ל-WebtopKids
</a>
<p>3. כשאתה ב-Webtop — לחץ על הסימנייה</p>
<p>4. המנהל יאשר את חיבורך ותקבל הודעה בטלגרם</p>
</body>
</html>
```

- [ ] **Step 2: הוסף route לserver.js**
```js
// POST /api/token-submit — bookmarklet שולח webToken
app.post('/api/token-submit', async (req, res) => {
  const { token, phone } = req.body;
  if (!token || token.length < 20) return res.json({ message: 'Token קצר מדי' });
  const { loadUsers, updateUser, findUserByPhone } = await import('./users.mjs');
  const { encryptToken } = await import('./auth.mjs');
  const user = findUserByPhone(phone);
  if (!user) {
    // הורה לא רשום — שמור pending לאישור מנהל
    await sendAdminTelegram(`📥 Token חדש מ-${phone} (לא רשום)\nאשר עם /approve ${phone}`);
    return res.json({ message: 'Token התקבל. המנהל יאשר את חיבורך בקרוב.' });
  }
  updateUser(user.id, {
    tokenPendingApproval: encryptToken(token),
    tokenSubmittedAt: new Date().toISOString()
  });
  await sendAdminTelegram(`📥 Token חדש מ-${user.name} (${phone})\nאשר עם /approve ${phone}`);
  res.json({ message: 'Token התקבל! ממתין לאישור מנהל.' });
});
```

- [ ] **Step 3: commit**
```bash
git add public/bookmarklet.html server.js
git commit -m "feat: bookmarklet receiver — token submit flow"
```

---

## Task 4: Login API + מסך כניסה

**Files:**
- Create: `public/login.html`
- Modify: `server.js` — routes: POST `/api/auth/login`, GET `/api/auth/me`

- [ ] **Step 1: הוסף routes auth לserver.js**
```js
import { hashPassword, checkPassword, signJwt, requireAuth } from './auth.mjs';
import { loadUsers, updateUser, findUserByPhone } from './users.mjs';

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const user = findUserByPhone(phone);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'פרטים שגויים' });
  const ok = await checkPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'פרטים שגויים' });
  updateUser(user.id, {
    lastLogin: new Date().toISOString(),
    lastLoginIp: ip,
    loginCount: (user.loginCount || 0) + 1
  });
  // התראה למנהל על IP חדש
  if (ip !== user.lastLoginIp) {
    await sendAdminTelegram(`🔔 כניסה חדשה: ${user.name}\nIP: ${ip}\nבפעם הראשונה מכתובת זו`);
  }
  const token = signJwt({ id: user.id, role: user.role, name: user.name });
  res.json({ token, name: user.name, role: user.role });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, role: user.role, children: user.children });
});
```

- [ ] **Step 2: צור login.html**
```html
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebtopKids — כניסה</title>
  <link rel="stylesheet" href="/style.css">
  <style>
    body { display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .login-card { background:var(--surface-1); border-radius:16px; padding:2rem; width:320px; }
    .login-card input { width:100%; margin:0.5rem 0; padding:0.75rem; border-radius:8px; border:1px solid var(--border); }
    .login-card button { width:100%; margin-top:1rem; padding:0.75rem; background:var(--accent); color:#fff; border:none; border-radius:8px; cursor:pointer; }
    .error { color:red; font-size:0.9rem; margin-top:0.5rem; }
  </style>
</head>
<body>
  <div class="login-card">
    <h2>WebtopKids 🎒</h2>
    <input id="phone" type="tel" placeholder="מספר טלפון" />
    <input id="pass" type="password" placeholder="סיסמה" />
    <button onclick="doLogin()">כניסה</button>
    <div class="error" id="err"></div>
  </div>
  <script>
    // אם כבר מחובר — עבור לאפליקציה
    if (localStorage.getItem('wt_token')) location.href = '/';

    async function doLogin() {
      const phone = document.getElementById('phone').value.trim();
      const password = document.getElementById('pass').value;
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
      });
      const d = await r.json();
      if (!r.ok) { document.getElementById('err').textContent = d.error; return; }
      localStorage.setItem('wt_token', d.token);
      localStorage.setItem('wt_name', d.name);
      location.href = '/';
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: הגן על / ב-server.js — redirect ל-login.html אם אין JWT**

בserver.js — שנה את ה-static serving:
```js
// הגן על index.html — רק למחוברים
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});
// login.html פתוח לכולם
app.get('/login', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'login.html'));
});
```

ובapp.js — הוסף בראש הקובץ:
```js
const token = localStorage.getItem('wt_token');
if (!token) { location.href = '/login'; }

// הוסף ל-fetch של /api/data:
headers: { 'Authorization': 'Bearer ' + token }
```

- [ ] **Step 4: הגן על /api/data ב-server.js**
```js
app.get('/api/data', requireAuth, (req, res) => {
  // במקום cache גלובלי — cache של המשתמש
  const userCache = loadUserCache(req.user.id);
  if (!userCache) return res.status(503).json({ error: 'No data yet' });
  res.json(userCache);
});
```

- [ ] **Step 5: commit**
```bash
git add public/login.html server.js public/app.js
git commit -m "feat: login UI + JWT auth middleware on /api/data"
```

---

## Task 5: Cache נפרד לכל הורה

**Files:**
- Modify: `server.js` — `loadUserCache` / `saveUserCache`
- Modify: `push_loop.mjs` — לולאה לכל user
- Modify: `webtop_api_fetch.py` — קבלת token כפרמטר

- [ ] **Step 1: הוסף ל-server.js פונקציות cache per-user**
```js
function userCachePath(userId) {
  return join(__dirname, `data_cache_${userId}.json`);
}

function loadUserCache(userId) {
  const path = userCachePath(userId);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function saveUserCache(userId, data) {
  writeFileSync(userCachePath(userId), JSON.stringify({ data, timestamp: Date.now() }, null, 2));
}
```

- [ ] **Step 2: שנה את /api/push לקבל userId**
```js
app.post('/api/push', (req, res) => {
  const secret = req.headers['x-push-secret'];
  if (secret !== PUSH_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const { userId, data } = req.body;
  if (!userId || !data) return res.status(400).json({ error: 'Missing userId or data' });
  saveUserCache(userId, data);
  // התראות Telegram — שלח לchat_id של המשתמש הספציפי
  const user = findUserById(userId);
  if (user?.chatId) processAlertsForUser(user, data);
  res.json({ ok: true });
});
```

- [ ] **Step 3: שנה push_loop.mjs — לולאה על כל users**
```js
// במקום scrape אחד — לולאה על כל users
import { loadUsers } from './users.mjs';
import { decryptToken } from './auth.mjs';

async function scrapeAllUsers() {
  const users = loadUsers().filter(u => u.status === 'active' && u.webTokenEncrypted);
  for (const user of users) {
    const token = decryptToken(user.webTokenEncrypted);
    await scrapeAndPush(user.id, token);
  }
}

async function scrapeAndPush(userId, webToken) {
  // הפעל webtop_api_fetch.py עם userId + token
  const result = await spawnPython(['webtop_api_fetch.py', '--user-id', userId, '--token', webToken]);
  if (result.ok) await pushToVps(userId, result.data);
}
```

- [ ] **Step 4: הוסף args לwebtop_api_fetch.py**
```python
import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--user-id', default=None)
parser.add_argument('--token', default=None)
args, _ = parser.parse_known_args()

# אם הועבר token כ-arg — השתמש בו במקום מ-.env
if args.token:
    web_token = args.token
else:
    web_token = load_saved_session()  # fallback לקובץ הישן
```

- [ ] **Step 5: commit**
```bash
git add server.js push_loop.mjs webtop_api_fetch.py
git commit -m "feat: per-user data cache + push loop for all users"
```

---

## Task 6: Telegram per-user + לוח ניהול

**Files:**
- Modify: `server.js` — `sendTelegram` מקבל chatId, `sendAdminTelegram` נפרד
- Create: `public/admin.html` — לוח ניהול למנהל

- [ ] **Step 1: שנה sendTelegram בserver.js**
```js
// שלח לchatId ספציפי
async function sendTelegram(text, chatId = TELEGRAM_CHAT_ID) {
  if (!TELEGRAM_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

// שלח למנהל בלבד
async function sendAdminTelegram(text) {
  return sendTelegram(text, TELEGRAM_CHAT_ID);
}
```

- [ ] **Step 2: כשהורה מחבר Telegram — שמור chatId**

בpollTelegram — כשמגיע /start:
```js
if (text === '/start') {
  const user = findUserByChatId(chatId); // חפש לפי chatId
  if (!user) {
    // שמור chatId בrequests פתוחים, בקש מהמנהל לשייך
    await sendAdminTelegram(`📱 ${chatId} שלח /start — יש לשייך למשתמש`);
    await sendTelegram('ברוך הבא! המנהל ישייך אותך בקרוב.', chatId);
  } else {
    await sendTelegram(`שלום ${user.name}! 👋 התראות מחוברות.`, chatId);
  }
}
```

- [ ] **Step 3: צור admin.html — לוח ניהול**
```html
<!-- רשימת משתמשים + סטטוס + כפתורי פעולה -->
<!-- Protected: requireAdmin middleware -->
```
מינימלי — טבלה עם:
- שם, טלפון, סטטוס (active/pending/disabled)
- תאריך כניסה אחרון + IP
- כפתור "בטל גישה"
- כפתור "אשר token"

- [ ] **Step 4: Routes ניהול בserver.js**
```js
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers().map(u => ({
    id: u.id, name: u.name, phone: u.phone,
    status: u.status, lastLogin: u.lastLogin,
    lastLoginIp: u.lastLoginIp, loginCount: u.loginCount,
    chatId: u.chatId, tokenUpdatedAt: u.webTokenUpdatedAt,
    hasPendingToken: !!u.tokenPendingApproval
  }));
  res.json(users);
});

app.post('/api/admin/users/:id/approve-token', requireAdmin, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user?.tokenPendingApproval) return res.status(400).json({ error: 'No pending token' });
  updateUser(user.id, {
    webTokenEncrypted: user.tokenPendingApproval,
    webTokenUpdatedAt: new Date().toISOString(),
    tokenPendingApproval: null,
    status: 'active'
  });
  if (user.chatId) sendTelegram('✅ חשבונך חובר! אפשר להיכנס לאפליקציה.', user.chatId);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/disable', requireAdmin, (req, res) => {
  updateUser(req.params.id, { status: 'disabled' });
  res.json({ ok: true });
});
```

- [ ] **Step 5: commit**
```bash
git add server.js public/admin.html
git commit -m "feat: per-user Telegram alerts + admin dashboard"
```

---

## Task 7: יצירת משתמש מנהל ראשון (Setup Script)

**Files:**
- Create: `setup_admin.mjs` — script חד-פעמי ליצירת המנהל

- [ ] **Step 1: צור setup_admin.mjs**
```js
#!/usr/bin/env node
// הרץ פעם אחת: node setup_admin.mjs
import { hashPassword } from './auth.mjs';
import { createUser, loadUsers } from './users.mjs';
import { randomUUID } from 'crypto';

const phone = process.argv[2];
const password = process.argv[3];
if (!phone || !password) {
  console.error('Usage: node setup_admin.mjs <phone> <password>');
  process.exit(1);
}

const existing = loadUsers().find(u => u.role === 'admin');
if (existing) { console.error('Admin already exists:', existing.phone); process.exit(1); }

const hash = await hashPassword(password);
const admin = createUser({
  name: 'מנהל',
  phone,
  passwordHash: hash,
  role: 'admin',
  status: 'active',
  children: [],
  webTokenEncrypted: null,
  chatId: process.env.TELEGRAM_CHAT_ID || null
});
console.log('✅ Admin created:', admin.id);
```

- [ ] **Step 2: הרץ את ה-script**
```bash
node setup_admin.mjs "050-XXXXXXX" "your-admin-password"
```

- [ ] **Step 3: commit**
```bash
git add setup_admin.mjs
git commit -m "feat: setup_admin script — one-time admin creation"
```

---

## Task 8: Backward Compatibility — המשתמש הקיים (אתה)

המערכת הנוכחית עם data_cache.json ו-.env צריכה להמשיך לעבוד במקביל בזמן המעבר.

- [ ] **Step 1: migrate_self.mjs — העבר את החשבון שלך**
```js
// קורא webToken מ-.webtop_session.json
// יוצר user עם role: 'admin' אם לא קיים
// שומר webToken מוצפן
// מעתיק data_cache.json → data_cache_{userId}.json
```

- [ ] **Step 2: הרץ migration**
```bash
node migrate_self.mjs
```

- [ ] **Step 3: בדוק שהאפליקציה עובדת אחרי migration**
- [ ] **Step 4: commit**
```bash
git add migrate_self.mjs
git commit -m "feat: self migration — move existing user to multi-user system"
```

---

## סדר ביצוע מומלץ

```
Task 1 → Task 2 → Task 7 (setup admin) → Task 4 (login) →
Task 3 (bookmarklet) → Task 5 (per-user cache) → Task 6 (Telegram + admin panel) →
Task 8 (migration)
```

## בדיקות לאחר כל task

```bash
# בדוק שserver.js עולה ללא שגיאות
node server.js

# בדוק שlogin עובד
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"050-xxx","password":"xxx"}'

# בדוק שapi/data מוגן
curl http://localhost:3000/api/data  # חייב לקבל 401
curl http://localhost:3000/api/data -H 'Authorization: Bearer <token>'  # חייב לעבוד
```

## אבטחה — לפני deploy

- [ ] `users.json` ב-.gitignore
- [ ] `.env` ב-.gitignore
- [ ] `JWT_SECRET` ו-`TOKEN_ENC_KEY` — ערכים אקראיים חזקים
- [ ] `data_cache_*.json` ב-.gitignore
- [ ] לוג כניסות שמור בקובץ `access.log` (לא בזיכרון בלבד)
