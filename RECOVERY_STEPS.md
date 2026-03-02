# WebtopKids — שיקום הפעולה (Recovery Steps)

## ✅ מה הושלם
- **נתונים משוחזרים ל-VPS** — 11 התראות לאמי ויולי
- **בדיקות** — כל 48 הבדיקות עברו
- **דשבורד** — http://76.13.8.113:3001

---

## הבעיה (לגריפה עתידית)
ההתחברות ל-webtop נתקעת ב-reCAPTCHA — צריך להתחבר ידנית **פעם אחת** כדי לשמור את הפרופיל.

---

## שלב 1: שמירת פרופיל (פעם אחת — לגריפה עתידית)

1. **הרץ** `capture_session.bat`
2. ייפתח דפדפן — היכנס לאתר (שם משתמש, סיסמה, פתור reCAPTCHA)
3. המתן עד שנפתח ה-dashboard
4. החלון יסגר — הפרופיל נשמר ב-`.webtop_profile/`

---

## שלב 2: הפעלת VPS במצב Push (אם עדיין לא)

אם ה-VPS מנסה לגרוף בעצמו ונכשל — הדבק ב-SSH:

```bash
ssh root@76.13.8.113
cd /srv/webtop  # או הנתיב הנכון
# ערוך .env:
nano .env
# שנה/הוסף:
USE_LOCAL_SCRAPER=false
PORT=3001
# שמור: Ctrl+O, Enter, Ctrl+X
pm2 restart webtop
```

---

## שלב 3: הפעלת הדיימון בבית

1. **כפול-קליק** על `start_daemon.bat`
2. או בטרמינל: `node push_loop.mjs`
3. השאר את החלון פתוח — הדיימון יגרוף כל 15 דקות וידחוף ל-VPS

---

## שלב 4: בדיקה

- **דשבורד**: http://76.13.8.113:3001
- **בדיקת מערכת**: `node test_system.mjs http://76.13.8.113:3001`

---

## קבצים שעודכנו

- `webtop_scrape.mjs` — טוען .env אוטומטית
- `push_loop.mjs` — ברירת מחדל ל-VPS, polling כל 30 שניות
- `start_daemon.bat` — מריץ push_loop
- `.env.example` — USE_LOCAL_SCRAPER=false, PORT=3001, VPS_URL
