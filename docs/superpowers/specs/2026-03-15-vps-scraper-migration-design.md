# מפרט: העברת הסקרייפר ל-VPS עם ניהול Session חכם

**תאריך:** 2026-03-15
**סטטוס:** מאושר לביצוע
**גרסה:** 1.0

---

## 1. רקע ובעיה

### המצב הנוכחי
- `push_loop.mjs` רץ על Windows ביתי
- Windows לא תמיד דלוק — גורם לפסקות בנתונים
- כשה-session פג → scraper מחזיר דף login → כל המערכת נעצרת
- reCAPTCHA מזהה headless Chromium ומונע auto-login אוטומטי

### הבעיה הקריטית (מתוך web_automation_reliability skill)
```
reCAPTCHA detects headless Chromium and invalidates the session token
Default MUST be headed mode (WEBTOP_HEADLESS defaults to false)
```
לכן: **לא ניתן להריץ את הסקרייפר headless על VPS ישירות.**

---

## 2. ארכיטקטורה חדשה

### תרשים זרימה

```
[VPS — Ubuntu]
  ├── server.js (PM2: webtop)         ← כבר קיים
  ├── vps_scrape_daemon.js (PM2: webtop-daemon)  ← חדש
  └── data_cache.json                 ← נכתב מקומית

[Windows — ביתי]
  └── windows_scrape_agent.mjs        ← חדש (webhook listener)
      └── webtop_scrape.mjs           ← קיים, headed mode

זרימה רגילה (כל 15 דק'):
  VPS daemon → POST /scrape ל-Windows Agent
  Windows Agent → מריץ webtop_scrape.mjs (headed)
  Windows Agent → מחזיר JSON ל-VPS
  VPS → כותב data_cache.json
  VPS → server.js מגיש נתונים

כשWindows כבוי:
  VPS daemon → timeout → Telegram: "Windows לא זמין"
  VPS → ממשיך להגיש cache קיים

כש-session פג:
  webtop_scrape מחזיר loginPage=true
  Windows Agent → שולח Telegram: "Session פג — שלח /cookie"
  אתה → פותח Webtop בדפדפן → לוחץ bookmarklet → cookie נשלח ל-VPS
  VPS → שולח cookie ל-Windows Agent
  Windows Agent → מחדש session → ממשיך
```

---

## 3. רכיבים לבנייה

### 3.1 VPS Daemon (`vps_scrape_daemon.js`) — חדש
**תפקיד:** מחליף את `push_loop.mjs` על VPS

אחריות:
- Schedule: כל 15 דקות → POST ל-Windows Agent
- קבלת נתונים → כתיבה ל-`data_cache.json`
- ולידציה של נתונים (מתוך push_loop קיים)
- Telegram alerts: session פג / Windows כבוי / שגיאה
- ניהול `/cookie` command מ-Telegram Bot
- fallback: אם Windows כבוי → ממשיך עם cache קיים

### 3.2 Windows Agent (`windows_scrape_agent.mjs`) — חדש
**תפקיד:** HTTP listener על Windows, מריץ את הסקרייפר

אחריות:
- מאזין ל-port מקומי (localhost:3002)
- endpoint: `POST /scrape` → מריץ webtop_scrape.mjs → מחזיר JSON
- endpoint: `POST /cookie` → מקבל cookie → כותב ל-.webtop_profile
- endpoint: `GET /health` → בדיקת חיות
- מאובטח עם SCRAPE_SECRET

**בעיה: Windows מאחורי NAT** — VPS לא יכול להגיע ל-Windows ישירות.

**פתרון: Polling במקום Webhook:**
```
Windows Agent → כל 30 שניות: GET /api/poll?secret=X
VPS → מחזיר: { pending: true } כשרוצה scrape
Windows Agent → מריץ scrape → POST /api/push עם הנתונים
```
זה בדיוק המנגנון הקיים ב-push_loop! אבל הפעם:
- push_loop **עדיין רץ על Windows** (כרגיל)
- VPS daemon **מנהל** את המצב, alerts, וה-cookie flow

### 3.3 Telegram Bot Cookie Flow — חדש
כשsession פג:
1. VPS שולח: `⚠️ Session פג — לחץ על ה-bookmarklet ב-Webtop ושלח /cookie <VALUE>`
2. אתה פותח Webtop בדפדפן → לוחץ bookmarklet → מקבל cookie value
3. שולח ל-Telegram: `/cookie eyJhbGc...`
4. VPS מקבל → POST ל-Windows Agent → מחדש `.webtop_session.json`

### 3.4 JavaScript Bookmarklet — חדש
Bookmark בדפדפן שמחלץ session cookie:
```javascript
javascript:(function(){
  const c = document.cookie.split(';').find(x=>x.includes('session'));
  navigator.clipboard.writeText('/cookie ' + (c||'').trim());
  alert('Cookie הועתק — הדבק ב-Telegram');
})()
```

---

## 4. מה משתנה / מה נשאר

| רכיב | שינוי |
|---|---|
| `webtop_scrape.mjs` | לא משתנה — רץ על Windows כבעבר |
| `push_loop.mjs` | נשאר על Windows — מנהל schedule |
| `server.js` | לא משתנה |
| `data_cache.json` | נשאר על VPS |
| `/api/push` endpoint | נשאר — Windows ממשיך לדחוף |
| `/api/poll` endpoint | נשאר — Windows ממשיך לפולל |
| **חדש: Telegram /cookie** | Bot מקבל cookie ושולח ל-Windows |
| **חדש: bookmarklet** | חילוץ cookie בלחיצה |
| **חדש: cookie injector** | Windows מקבל cookie ומחדש session |

---

## 5. ניתוח — מה באמת צריך לבנות

לאחר ניתוח מעמיק: **push_loop כבר עובד נכון על Windows.**
הבעיה האמיתית היחידה היא **session expiry**.

לכן הפרויקט האמיתי הוא:

### Phase 1: Cookie Recovery Flow (עיקרי)
1. הוספת `/cookie` command ל-Telegram bot handler ב-`server.js`
2. כתיבת cookie injector שמחדש `.webtop_profile/` session
3. bookmarklet לחילוץ cookie מדפדפן
4. Telegram alert משופר עם הוראות ברורות

### Phase 2: Health Monitoring (שיפור)
5. `/api/health` endpoint מורחב עם מידע על session age
6. PM2 monitor שמזהה כש-push_loop נכשל

---

## 6. מה השתנה מהמקור

**מקור:** "להעביר push_loop ל-VPS"
**מסקנה:** לא ניתן — reCAPTCHA חוסם headless Chromium

**פתרון מאושר:** Windows ממשיך להריץ הכל, VPS מקבל cookie recovery flow

---

## 7. הגדרות אבטחה

- Cookie ב-Telegram: transport מוצפן, נמחק מההיסטוריה אחרי שניות
- SCRAPE_SECRET: shared secret בין VPS ל-Windows (קיים כבר כ-PUSH_SECRET)
- Cookie injector: רק local file write, לא network exposure

---

## 8. קריטריוני הצלחה

מתוך skills `alerting_monitoring` ו-`system_health_check`:

1. Session פג → Telegram alert תוך 2 דקות ✓
2. Cookie recovery בפחות מ-60 שניות מרגע השליחה ✓
3. לאחר recovery: scrape תקין עם שני ילדים ✓
4. Windows כבוי → cache ממשיך להיות מוגש ✓
5. Health endpoint מציג: session age, last scrape, windows status ✓

---

## 9. קבצים ליצירה/שינוי

| קובץ | פעולה |
|---|---|
| `server.js` | הוספת `/telegram/webhook` + `/cookie` handler |
| `public/bookmarklet.html` | דף עם הוראות + bookmarklet |
| `cookie_injector.mjs` | מקבל cookie → כותב session |
| `push_loop.mjs` | הוספת cookie-received listener |
| `docs/COOKIE_RECOVERY.md` | הוראות שימוש |
