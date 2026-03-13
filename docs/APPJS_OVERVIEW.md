# app.js — סקירה (ללא עריכת לוגיקה)

## תפקיד כללי

קובץ הליבה של האפליקציה — מציג נתונים מהשרת, מנהל ניווט, עדכון סטטוס, ועוד.  
**לא נוגעים**: לוגיקה, פונקציות, תהליכים, כפתורים, משיכת נתונים מהסקרייפר.

## מבנה עיקרי

### State (משתנים גלובליים)
- `currentSection`, `currentStudent` — חלוקה לטאבים ותלמיד
- `lastData`, `lastStatus`, `lastInsights` — נתונים אחרונים מהשרת
- `lastEvents`, `lastChildren`, `lastExternalLinks` — אירועים, ילדים, קישורים

### Fetch & Init
- `fetchAll()` — מושך `/api/data`, `/api/status`, `/api/events`, `/api/children`, `/api/insights`, `/api/external-links`
- `refresh()` — רענון כפוי
- `render()` — רינדור ראשי (סטטיסטיקות, insights, rerender)

### Render Functions
- `renderStats()` — כרטיסי 4 סטטיסטיקות (הודעות, ציונים, התראות, שיעורי בית)
- `renderInsights()` — באנר ירוק (למשל "יום שישי - אין שיעורי בית")
- `rerender()` — מעדכן את כל הסקשנים
- `renderHomework()`, `renderAlerts()`, `renderGrades()`, `renderCalendar()`, `renderApprovals()`, `renderMessages()`, `renderFeed()`, `renderExternalLinks()`

### Cards & UI
- `hwCard()`, `alertCard()` — תבניות כרטיסים
- `updateTabCounts()` — עדכון תגיות טאבים
- `updateStudentSwitcher()` — בחירת תלמיד
- `updateChildPhoto()` — עדכון תמונת תלמיד

### Status & API
- `handleMarkDone()` — סימון שיעורי בית כהושלמו
- `handleApprovalDone()`, `handleMessageRead()` — אישורים והודעות נקראו
- קריאות ל-`/api/homework/done`, `/api/approval/done`, `/api/message/read`

### Helpers
- `fixSpacingForDisplay()` — תיקון רווחים בטקסט מעברית
- `esc()`, `homeworkId()`, `approvalId()`, `msgId()`, `dateSortKey()`, `calcDaysLeft()`

### Theme
- `getTheme()`, `setTheme()` — מצב כהה/בהיר (localStorage)

### Modals & PTR
- Pull-to-refresh, מודלים (crop, detail), ניווט לפי סקשנים

## קישור לעיצוב

העיצוב והמבנה ב-`index.html` ו-`style.css`. ה-`app.js` רק ממלא את ה-DOM ומעדכן תצוגה — אין לשנות את הלוגיקה.
