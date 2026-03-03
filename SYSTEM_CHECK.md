# בדיקת מערכת WebtopKids — מדריך מקיף

## 1. מה תוקן עכשיו (בעיית יולי/אמי)

**באג:** ביומן — כשראית את יולי, הופיעו הערות של אמי.

**סיבה:** במצב "תלמיד יחיד" (כשהפורטל לא מזהה רשימת תלמידים), הקוד העתיק את אותה רשימת אירועי שיעור (`classEvents`) לכל התלמידים. כך יולי קיבלה את האירועים של אמי.

**תיקון:** ב-`webtop_scrape.mjs` — אירועי שיעור משויכים רק לתלמיד שנסרק בפועל. לתלמידים אחרים נשמר מערך ריק.

---

## 2. זרימת נתונים — מקצה לקצה

```
[אתר SmartSchool] 
       ↓
[webtop_scrape.mjs] — סורק, מחלץ notifications, messages, classEvents per student
       ↓
[data_cache.json] או [POST /api/push ל-VPS]
       ↓
[server.js] — משרת /api/data, /api/status
       ↓
[אפליקציה בדפדפן] — מציגה לפי currentStudent
```

---

## 3. חיבור לאתר — אימות

1. **הרצת סריקה ידנית:**
   ```powershell
   cd c:\Users\Master_PC\Desktop\n8n\Webtop_APP
   node webtop_scrape.mjs
   ```

2. **אם יש שגיאה:** הרצה עם דפדפן גלוי:
   ```powershell
   $env:WEBTOP_CAPTURE = "true"
   node webtop_scrape.mjs
   ```
   התחברי ידנית, פתרי CAPTCHA — הפרופיל ישמר.

3. **בדיקה:** בסוף הרצה צריכה להיות פלט JSON עם `ok: true`.

---

## 4. שליפת נתונים נכונה לתלמידים

- `children_config.json` — הגדרת הילדים (שם, כיתה, מקצועות).
- הסורק עובר על כל תלמיד דרך `switchToStudent()` ומשייך:
  - `notifications` — לפי `n.student` מהטקסט.
  - `classEventsByStudent[name]` — אירועי שיעור לפי התלמיד הנבחר.

אם מתחלפים נתונים בין תלמידים, ייתכן:
- בחירת התלמיד באתר לא עבדה (למשל `mat-select` של שפה במקום תלמיד).
- יש להריץ עם `WEBTOP_DEBUG=1` ולוודא בלוג איזה תלמיד נסרק.

---

## 5. מערכת התראות לטלגרם

- **server.js:** פונקציות `sendNewAlerts`, `checkDeadlines`, התראות על הודעות חדשות.
- **הגדרות:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` ב-`.env`.
- **מניעת כפילויות:** `sent_reminders.json` — מזהה התראות שנשלחו כבר.

---

## 6. אישורים לשיעורי בית לטלגרם

- סימון "הושלם" → `POST /api/homework/done` → שליחת הודעת טלגרם.
- מפתח ייחודי לכל שיעור: `subject_date_lesson`.

---

## 7. בדיקות מהירות

| בדיקה | פקודה |
|-------|-------|
| בדיקת API מקומית | `node test_check.mjs` (לאחר `node server.js`) |
| סריקה ידנית | `node webtop_scrape.mjs` |
| דימון דחיפה | `node push_loop.mjs` או `start_daemon.bat` |

---

## 8. גיבוי — Git

אין גיבוי אוטומטי מזיכרון. אפשר לחפש ב־Git:

```powershell
git reflog
git log --all --oneline
```

לחזרה לקומיט קודם:
```powershell
git checkout <commit-hash> -- .
```
