# WebtopKids 🎒

אפליקציה לניוד נתונים מבית הספר Webtop SmartSchool — שיעורי בית, התראות, הודעות, אירועים וקישורים.

## הרצה מקומית

1. התקן dependencies: `npm install`
2. צור קובץ `.env` (העתק מ־`.env.example`)
3. **התחברות ראשונית:** `WEBTOP_CAPTURE=true node webtop_scrape.mjs` — יפתח דפדפן, התחבר ידנית
4. הרץ שרת: `npm start` (פורט 3000)
5. גלוש ל־http://localhost:3000

## Deploy ל־VPS

- `deploy_all.bat` — העלאת קוד דרך SSH
- אפשרות: `deploy_all.bat -PushDataFirst` — דחיפת נתונים לפני העלאה

## משיכת נתונים (מחשב בית)

- `start_daemon.bat` — daemon שמושך כל 15 דקות ודוחף ל־VPS
- `fresh_pull.bat` — משיכה חדשה + ניקוי cache ב־VPS

## סריקת האתר

- `scan_portal.bat` — סריקת כל הדפים והפקת `discovery.json`
