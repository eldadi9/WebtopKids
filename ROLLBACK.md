# הוראות Rollback — החזרה לעיצוב הקודם

## גיבויים זמינים

| תיקייה | תיאור |
|-------|--------|
| `public/backup_ui_PRE_FIGMA_20260313_2359/` | גיבוי מלא לפני החלפת ה-UI בעיצוב Figma |
| `public/backup_ui_20260313_1919/` | גיבוי קודם (לפני ה-Figma) |

## איך לחזור לעיצוב הקודם

### שיטה 1: PowerShell (מומלץ)

```powershell
cd "C:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP\public"

# העתקת הקבצים מהגיבוי
Copy-Item backup_ui_PRE_FIGMA_20260313_2359\index.html -Destination index.html -Force
Copy-Item backup_ui_PRE_FIGMA_20260313_2359\style.css  -Destination style.css  -Force

# app.js לא הוחלף — אין צורך לשחזר
```

### שיטה 2: דרך Git

```powershell
cd "C:\Users\Master_PC\Desktop\Projects Eldad\01_Active_Projects\n8n\Webtop_APP"
git checkout HEAD -- public/index.html public/style.css
```

או לשינוי ספציפי לפני ה-Figma:

```powershell
git log --oneline  # מצא את ה-commit 1ba798b (לפני Figma)
git checkout 1ba798b -- public/index.html public/style.css
```

### שיטה 3: העתקה ידנית

1. לפתוח את `public/backup_ui_PRE_FIGMA_20260313_2359/`
2. להעתיק `index.html` ו-`style.css` לתיקייה `public/`
3. להחליף את הקבצים הקיימים

---

## אחרי ה-Rollback

- לרענן את הדף בדפדפן (Ctrl+F5 לרענון מלא)
- אם יש cache — לנקות או לפתוח בחלון פרטי

## שים לב

- `app.js` לא הוחלף במהלך החלפת ה-UI — הלוגיקה נשארה זהה
- רק `index.html` ו-`style.css` שונו (מראה בלבד)
