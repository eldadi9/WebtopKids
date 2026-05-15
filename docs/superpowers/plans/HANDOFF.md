# Handoff Prompt — להעתקה בסשן חדש של Claude

**עודכן לאחרונה:** 2026-05-15 — סוף Phase 2H (K1+2H+M1 + try/catch hardening)
**שמירה לפני /compact**

## 🆕 Phase 2H הושלם בסשן הזה

תיקוני אבטחה ב-`server.js`:
- **K1** (501-505): הוסר fallback ל-`TELEGRAM_CHAT_ID`. user ללא chatId → warn + return.
- **2H** (506, 511): `isAdmin = user?.role === 'admin'`. non-admin → `sendTelegram(..., direct=true)` (לא household fan-out).
- **M1** (~580): `cache` הגלובלי נדרס רק אם `effectiveUserId === PUSH_DEFAULT_USER_ID`.
- **HIGH-3** (try/catch hardening): `loadUserCache` עטוף ב-try/throw, `/api/push` תופס ומחזיר 500 ללא `saveUserCache` — מונע חזרת באג prevIds.

Reviewed by 2 agents בפרללל. נוספו:
- **Code Reviewer:** all clear ✓
- **Silent-Failure Hunter:** מצא 3 issues. תיקנו HIGH-3. נדחו לסשן הבא:
  - HIGH-1: `global_legacy` cache ב-`AUTH_DISABLED` mode (לא קריטי, רק dev)
  - HIGH-2: parent מסומן בטעות כ-`role:'admin'` → leak. הצעה: flag `broadcastHousehold`.

DEV verified: שרת עלה על 3002, `/api/data` ללא auth → 401 ✓
**כל השינויים עדיין unstaged. לא נפרס ל-VPS.**

---

## 🚀 Prompt לסשן חדש — העתק הכל מתחת לקו

---

אני ממשיך פרויקט WebtopKids — אפליקציית לוח-מחוונים לפורטל בית ספר עם התראות טלגרם.
המטרה: לשתף את האפליקציה עם הורים אחרים באופן מאובטח — כל הורה רואה רק את הילדים שלו.

תקרא את הקבצים האלה לפי הסדר לפני שתעשה כלום:

1. `C:\Users\Master_PC\.claude\plans\zany-munching-swing.md` ← התוכנית המאושרת
2. `c:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP\docs\superpowers\plans\HANDOFF.md` ← הקובץ הזה
3. `c:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP\docs\superpowers\plans\multi-parent-backlog.md` ← סטטוס מפורט
4. `c:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP\docs\superpowers\plans\vps-audit-2026-05-15.md` ← מצב VPS
5. `C:\Users\Master_PC\.claude\projects\c--Users-Master-PC-Desktop-Projects-Eldad-01-Active-Projects-n8n-Webtop-APP\memory\MEMORY.md` ← זיכרון

**המשתמש:** אלדד גונשרוביץ, מפתח, מנהל הפרויקט. מדבר עברית. מעדיף תשובות תמציתיות.

**כללי זהב:**
- לעולם לא לפרוס ל-VPS ללא אישור מפורש ("deploy" / "פרוס" / "תעלה ל-prod")
- SSH ל-VPS: `ssh root@76.13.8.113` (יש key, אין סיסמה)
- **אסור:** `taskkill /F /IM node.exe` — הורג את push_loop בבית
- כל שינוי קוד עובד **קודם ב-DEV** (localhost:3002), רק אחר כך VPS
- אל תתחיל git pull/rsync ל-VPS בלי אישור

**הצעד הבא: Phase 2H+2G** — תיקון 2 באגי אבטחה ב-`processAlertsForUser`:
- K1: `chatId || TELEGRAM_CHAT_ID` ב-server.js:496 — להסיר fallback
- 2H: `sendTelegram` עם `direct=false` עושה fan-out — צריך `direct=true` ל-non-admin
- M1: global `cache` מתעדכן ב-/api/push לכל user — צריך רק ל-PUSH_DEFAULT_USER_ID

---

## 📊 מצב נוכחי — מה הושלם

### ✅ Phase 0 — VPS Audit
- Backup: `backups/webtop_audit_2026-05-15.tar.gz`
- Audit doc: `docs/superpowers/plans/vps-audit-2026-05-15.md`
- מורן (chatId 6642684065) כבר ב-`TELEGRAM_EXTRA_CHAT_IDS` ✓
- JWT_SECRET ו-TOKEN_ENC_KEY כבר ב-`.env` של VPS ✓
- VPS: 2 משתמשים בשם אלדד (admin + parent), אישור — אותו אדם

### ✅ Phase 1 — DEV environment
- `localhost:3002` מבודד מ-prod
- branch: `feature/webtopkids-dev-multi-parent`
- DOTENV_PATH + USERS_FILE_OVERRIDE + DATA_PREFIX patches ב-server.js, users.mjs, push_loop.mjs
- `.env.dev`, `users.dev.json` — נפרדים
- manifest.json תקין (start_url=/) — הבעיה היא PWA shortcut ישן

### ✅ Phase 2C — set_admin_password.mjs
- `scripts/set_admin_password.mjs` — interactive CLI, bcrypt, masked TTY + piped fallback
- `--create` ליצירת admin חדש
- DEV-verified

### ✅ Phase 2A — requireAuth on data endpoints
**12 endpoints** עם `maybeAuth` middleware: `/api/data`, `/api/status`, `/api/health`, `/api/events`, `/api/children`, `/api/external-links`, `/api/schedule`, `/api/children/:name/photo`, `/api/insights`, `/api/homework/done`, `/api/approval/done`, `/api/messages/read`, `/api/homework/undone`

### ✅ Phase 2A Fix-up (אחרי Code Reviewer + Silent-Failure Hunter)
- `effectiveUserIdForRequest` — null check + role allowlist + USER_ID_RE
- `getAuthenticatedUserCache` חדש (החליף את `resolveAuthenticatedUserCache` שנמחק)
- `AUTH_DISABLED` — refuse to start in production, log banner
- `ADMIN_UI_PASSWORD` — refuse to start אם missing/weak/default '1920'
- `requireAdminPassword` — לא מקבל query string

### ✅ Phase 2A Fix-up 2 (אחרי second review)
- `allowedChildrenForRequest(req)` — סינון per-parent
- `/api/children` — parent רואה רק את הילדים שלו
- `/api/health` — סינון per-parent
- `/api/status` — סינון לפי student name prefix
- `getAuthenticatedUserCache` — log ב-AUTH_DISABLED fallback
- `set_admin_password.mjs` — Ctrl+C אמיתי (\\x03)

### ✅ Phase 2B — JWT frontend
- `public/app.js` — `authFetch()` helper בראש הקובץ
- כל 13 קריאות `/api/` הומרו ל-`authFetch`
- 401 → ניקוי token + redirect ל-/login
- boot-time guard: אם אין token → redirect ל-/login
- `index.html` cache-buster עלה ל-`?v=21`

### 🎯 E2E test ב-DEV (DEV-verified, לא VPS):
1. ✅ `/api/data` ללא Authorization → 401
2. ✅ Admin login → JWT
3. ✅ Admin `/api/children` → רואה את שני הילדים (יולי + אמי)
4. ✅ Parent login → JWT
5. ✅ Parent `/api/children` → **רואה רק יולי, לא אמי!**
6. ✅ Parent `/api/admin/users` → 403
7. ✅ `/api/auth/me` חוזר את הuser הנכון

---

## ⏳ הצעד הבא: Phase 2H + 2G

**זה השלב הקריטי לאבטחה משפחה לפני שמזמינים הורה אמיתי.**

### באג K1 — `processAlertsForUser` fallback ל-TELEGRAM_CHAT_ID
[server.js:488-537](../../server.js#L488-L537):
```js
const chatId = user?.chatId || TELEGRAM_CHAT_ID;  // ← BUG
```
תיקון:
```js
const chatId = user?.chatId;
if (!chatId) {
  console.warn(`[alerts] Skipping user ${user.id} (${user.name}) — no chatId paired`);
  return;
}
```

### באג 2H — household fan-out
שורה ~531 — `await sendTelegramToUser(text)` קורא ל-`sendTelegram` עם `direct=false` (default) → fan-out לכל household. צריך `direct=true` אם user אינו admin.

### באג M1 — global cache overwrite
[server.js:559-560](../../server.js#L559-L560) — `/api/push` כותב ל-`cache` הגלובלי לכל user. צריך רק ל-`PUSH_DEFAULT_USER_ID`.

---

## 📂 קבצי מפתח (עם שינויים בסשן זה)

| קובץ | מצב |
|---|---|
| `server.js` | ✏️ עדכון מסיבי — auth + per-user filtering |
| `users.mjs` | ✏️ USERS_FILE_OVERRIDE support |
| `push_loop.mjs` | ✏️ DOTENV_PATH support |
| `public/app.js` | ✏️ authFetch + JWT + redirect |
| `public/index.html` | ✏️ cache-buster v=21 |
| `scripts/set_admin_password.mjs` | 🆕 חדש |
| `scripts/start-dev.cmd`, `start-dev.sh` | 🆕 חדש |
| `.env.dev` | 🆕 חדש |
| `users.dev.json` | 🆕 חדש (gitignored) |
| `.gitignore` | ✏️ + DEV files |
| `docs/superpowers/plans/*` | 🆕 audit, backlog, HANDOFF |

---

## 🔧 פקודות שימושיות

```bash
# DEV server
DOTENV_PATH=.env.dev USERS_FILE_OVERRIDE=users.dev.json node server.js
# או: scripts/start-dev.cmd

# יצירת admin/parent ב-DEV
USERS_FILE_OVERRIDE=users.dev.json node scripts/set_admin_password.mjs <phone> --create

# VPS SSH
ssh root@76.13.8.113
ssh root@76.13.8.113 "node /root/webtop/activate_pending_user.cjs --list"

# Backup VPS לפני deploy
ssh root@76.13.8.113 "cd /root/webtop && tar czf /root/backups/webtop_\$(date +%Y%m%d_%H%M).tar.gz .env users.json data_cache_*.json homework_status.json sent_reminders*.json"

# הריגת DEV server לפני בדיקה חדשה (לא kill all node!)
netstat -ano | grep ':3002' | grep LISTENING | awk '{print $NF}' | head -1 | xargs -r -I{} taskkill //PID {} //F
```

---

## ⚠️ באגי אבטחה ידועים שעוד לא תוקנו

| # | בעיה | Phase |
|---|---|---|
| K1 | `processAlertsForUser` fallback ל-TELEGRAM_CHAT_ID | **2H הבא** |
| 2H | sendTelegram fan-out לכל household | **2H הבא** |
| M1 | global cache overwrite ב-/api/push | **2G הבא** |
| users.mjs cache | cache בזיכרון לא מתרענן — שינוי חיצוני ל-users.json לא נראה | אחר כך |

---

## 📦 git status

Branch: `feature/webtopkids-dev-multi-parent` (לא committed עדיין — הרבה שינויים)

**אין commit שעשיתי בסשן הזה.** כל השינויים unstaged.

**אם המשתמש יבקש commit:** עשה commit אחד עם הודעה ברורה:
```
feat(auth): Phase 2A+2B — JWT enforcement + per-parent data isolation

- requireAuth on 12 data endpoints + admin fallback to PUSH_DEFAULT_USER_ID
- effectiveUserIdForRequest + getAuthenticatedUserCache (with null/regex/role guards)
- allowedChildrenForRequest — parent sees only their own kids
- AUTH_DISABLED kill-switch with production refuse-to-start
- ADMIN_UI_PASSWORD validation (no default '1920')
- public/app.js: authFetch helper + 401 redirect to /login
- DEV environment via DOTENV_PATH + USERS_FILE_OVERRIDE + DATA_PREFIX
- scripts/set_admin_password.mjs — interactive CLI for admin password
- Backup + audit doc for VPS state

Reviewed by Code Reviewer + Silent-Failure Hunter agents (2 rounds, 15+ issues fixed)
DEV-verified: parent sees only their own children, admin sees all.
NOT deployed to VPS yet.
```
## 2026-05-15 — HIGH-1 completed (DEV ONLY, NOT DEPLOYED)

- Fixed `server.js` so global legacy `DATA_CACHE_FILE` is not loaded at startup when `PUSH_DEFAULT_USER_ID` is empty.
- Fixed pre-auth / `AUTH_DISABLED` cache path so it returns `null` before `loadUserCache('')`, preventing stale `data_cache_dev_.json` / blank-user cache leaks.
- DEV tests on `localhost:3002`:
  - `AUTH_DISABLED=true`, empty `PUSH_DEFAULT_USER_ID`, fake `data_cache_dev.json` + `data_cache_dev_.json` present → `/api/data` returns `503`.
  - Normal DEV auth mode, no JWT → `/api/data` returns `401`.
- Agent review:
  - First pass found HIGH blank-user cache issue; fixed.
  - Second pass: code-reviewer + silent-failure-hunter reported no HIGH findings.
- No VPS operations. No deploy. No commit yet.

## 2026-05-15 — HIGH-2 completed (DEV ONLY, NOT DEPLOYED)

- Fixed `server.js` Telegram fan-out to use explicit persisted `user.broadcastHousehold === true` instead of `user.role === 'admin'`.
- Changed `sendTelegram()` default to direct-only and made it throw on missing token/chatId or Telegram HTTP failure.
- Fixed marker/cache ordering:
  - New alert reminders save only after successful Telegram send.
  - Deadline reminders save only after successful Telegram send.
  - Message reminders save only after successful Telegram send.
  - `/api/push` returns `500 alerts_failed_cache_not_updated` and does not call `saveUserCache()` when alert processing fails.
- Fixed no-chatId silent loss: if a user has alertable content but no Telegram `chatId`, alert processing throws so cache is not advanced.
- Fixed corrupt per-user cache handling: `loadUserCache()` no longer swallows parse/read failures, preserving the previous-cache safety guard.
- Fixed local scraper silent loss: `runLocalScrape()` now saves global cache only after `sendNewAlerts()` and `checkDeadlines(nextData)` succeed.
- Fixed broadcast permission safety:
  - `users.mjs` does not allow `broadcastHousehold` through generic `createUser()` allow-list.
  - Existing DEV user records can still carry `broadcastHousehold` as persisted admin-controlled data.
- DEV tests on `localhost:3002`:
  - Invalid Telegram token + new unread message -> `/api/push` returns `500`, no user cache file, no reminders file.
  - User with alertable content and missing `chatId` -> `/api/push` returns `500`, no user cache file.
  - Corrupt per-user cache file -> `/api/push` returns `500`, corrupt file is not overwritten.
  - `node --check server.js` and `node --check users.mjs` passed.
- Agent review:
  - Multiple review rounds found and fixed HIGH issues: default Telegram fan-out, swallowed Telegram errors, markers saved before send, no-chatId cache advance, local scraper cache advance, corrupt cache swallowing.
  - Final agent review attempt hit usage limit after local fixes; local validation passed.
- Temporary DEV test files were created and removed: `users.high2.test.json`, `high2test_*`, `.codex-dev-high2-final.*.log`.
- No VPS operations. No deploy. No commit yet.
