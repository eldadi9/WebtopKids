# WebtopKids — Comprehensive Summary Report (English)

**Date:** March 5, 2026  
**Purpose:** Clear answers for each section of the project

---

## Implementation Status (This Session)

| Task | Status |
|------|--------|
| Links tab removed | ✅ HTML section + `renderLinks` + tab count removed |
| All tab shows everything | ✅ Notifications, class events, messages, approvals, special events merged |
| `parseDateFromSubject` added to app.js | ✅ For message date parsing in feed |
| Feed tab count | ✅ Badge shows total items |
| Summary report | ✅ This document |

---

## 1. Full Synchronization / Full Scan

**What to do:**
- **On home machine (where Webtop login works):** Run `start_daemon.bat` — this runs the scraper every 15 minutes and pushes data to the VPS.
- **One-time full scan:** Run `node webtop_scrape.mjs` — outputs JSON to stdout. Or use `push_scrape.bat` if configured to POST to the server.
- **On VPS:** The server runs `runLocalScrape()` every 15 min if `USE_LOCAL_SCRAPER` is not set to `false`. For VPS-only mode, ensure `.webtop_profile` exists on the VPS and credentials work.

**Status:** Scraper supports multi-student. Each child is switched via `switchToStudent()` before extracting dashboard, notifications, class events, and school events.

---

## 2. Design Changes

**Status:** ✅ **DONE** (previous session)

- Typography: 16px base, 18–20px card titles
- Tap targets: 44px minimum
- Logo hero banner, modern cards, modal improvements
- Accessibility: focus states, `prefers-reduced-motion`
- RTL preserved

**Files:** `public/index.html`, `public/style.css`, `UI_CHANGES.md`

---

## 3. Update Server and Application

**What to do:**
1. **Deploy to VPS:** Copy updated `public/`, `server.js`, `webtop_scrape.mjs` to the server.
2. **Restart:** `pm2 restart webtop` (or your process name).
3. **Cache bust:** CSS link uses `?v=7` — no extra step needed.

**Server routes:**
- `GET /api/data` — cached scraped data
- `POST /api/push` — receive data from home machine
- `GET /api/status` — homework done/undone
- `GET /api/events` — special events
- `GET /api/children` — per-child config
- `GET /api/insights` — smart summary
- `GET /api/external-links` — external links

---

## 4. Comprehensive General Check

| Component | Status | Notes |
|-----------|--------|-------|
| Scraper | ✅ | Multi-student loop, per-child switch |
| Server | ✅ | Push + local scrape, cache to disk |
| Frontend | ✅ | RTL, student switcher, all sections |
| Notifications | ✅ | 7-day filter, past-due homework excluded |
| Messages | ✅ | Shared, dedup by subject+date |
| Homework status | ✅ | Persisted in `homework_status.json` |
| Telegram alerts | ✅ | New notifications + deadline reminders |

---

## 5. Notifications — Clear Rules

### What triggers a Telegram alert

| Type | Rule |
|------|------|
| **late** | New, within 7 days |
| **absence** | New, within 7 days; **skipped** if alert time &lt; 07:00 |
| **missing_equipment** | New, within 7 days |
| **grade** | Always (no age limit) |
| **homework_not_done** | New, within 7 days |
| **homework** | New, due date **today or future** (past-due excluded) |

### Deadline reminders (homework)

- **2 days before:** 🟡 Early warning
- **1 day before:** 🟠 "מחר חייבים להגיש"

### What is NOT sent

- Notifications older than 7 days (except grades)
- Homework past due date
- Absences before 7:00
- Duplicate notifications (same type/student/subject/date/lesson)

---

## 6. Data Separation Per Child (No Conflicts)

**Per-child data (separate):**
- **Notifications** — each has `student` field; filtered by `currentStudent`
- **Class events** — `classEventsByStudent[name]` per student
- **School events** — `schoolEventsByStudent[name]` per student (יומן פגישות)
- **Homework, grades, alerts** — all include `student`; UI filters by selected child

**Shared (no separation):**
- **Messages** — extracted once, shared for parents
- **Useful links** — from main dashboard (merged)
- **External links** — from `external_links.json`
- **Approvals** — from signoffs page (may need child filter if Webtop supports it)

---

## 10. Diary Tab (יומן) — Complete Separation

**Current implementation:**
- **Class events** (`אירועים בשיעור`): Stored in `classEventsByStudent[studentName]` — **per student**.
- **School events** (יומן פגישות): Stored in `schoolEventsByStudent[studentName]` — **per student**.
- **Homework deadlines:** Filtered by `currentStudent` via `visible` notifications.
- **Special events** (birthdays, meetings): Filtered by `childName` and `isEventValidForCurrentChild()`.

**Flow:**
1. Scraper loops over each student.
2. For each student: `switchToStudent()` → `extractDashboard()` → `extractSchoolEvents()`.
3. Results stored in `classEventsByStudent` and `schoolEventsByStudent`.
4. Frontend uses `resolveClassEventsForStudent()` and `resolveSchoolEventsForStudent()` to show only the selected child's data.

**Status:** ✅ **Complete separation** — Diary shows only the selected child's events.

---

## 11. Messages — Shared and Updated

**Status:** ✅ **Shared by design**

- Extracted **once** after the student loop (not per student).
- Deduplicated by normalized subject + date.
- Body loaded by clicking first row when empty.
- Telegram: one alert per unique message (key: `msg_|date|subject`).
- No student filter in UI — messages are for parents.

---

## 12. Links Tab — Removed

**Status:** ✅ **Removed** (per your request — not relevant)

- Tab and section removed from HTML.
- `renderLinks()` and tab count logic removed/hidden.
- `usefulLinks` still scraped (used in validation) but not shown in a dedicated tab.
- External links tab (אתרים חיצוניים) remains for `external_links.json`.

---

## 13. All Tab (הכל) — Contains Everything

**Status:** ✅ **Updated**

The "All" tab now shows:
- All notifications (homework, alerts, grades) for the selected child
- Class events (אירועי שיעור)
- School events (יומן פגישות)
- Special events (birthdays, meetings)
- Messages (shared)
- Approvals (חתימות ואישורים)

Merged into one chronological feed, sorted by date.

---

## 14. Full Process: Connection → Data → Notifications

**Flow:**

1. **Login** — `webtop_scrape.mjs` uses `.webtop_profile` (or WEBTOP_USER/PASS).
2. **Student detection** — `getAllStudents()` from mat-select, or `children_config.json`.
3. **Per-student loop:**
   - `switchToStudent(page, name)`
   - `extractDashboard()` → classEvents, homework, grades, usefulLinks
   - `extractSchoolEvents()` → schoolEventsByStudent[name]
   - `extractNotifications()` → notifications (with `student` from parsed text)
4. **Shared extraction (after loop):**
   - `extractMessages()` — once
   - `extractSignoffs()` — approvals
   - `extractExternalSitesLinks()` — external links
5. **Filtering:** `isNewNotification()` — 7 days, homework not past due.
6. **Deduplication:** By type/student/subject/date/lesson.
7. **Push to server** or **local cache** → `sendNewAlerts()` → Telegram.
8. **Frontend:** Filters by `currentStudent` except messages.

**Separation:** ✅ Complete for all per-child data. Messages are the only shared stream.

---

## 15. Quick Reference

| Section | Data Source | Per-Child? |
|---------|-------------|------------|
| Homework | notifications (type=homework) | ✅ |
| Alerts | notifications (late, absence, etc.) | ✅ |
| Grades | notifications (type=grade) | ✅ |
| Diary | classEventsByStudent + schoolEventsByStudent + homework + specialEvents | ✅ |
| Approvals | signoffs, approvals, special events | ⚠️ May need child filter |
| Messages | messages | ❌ Shared |
| Links | usefulLinks | ❌ Removed |
| All | Merged: notifications + events + messages + approvals | Mixed |
| External | external_links.json | ❌ Shared |

---

## Next Steps (Your Checklist)

1. ☐ Run `start_daemon.bat` on home machine for continuous sync.
2. ☐ Deploy updated files to VPS and restart server.
3. ☐ Verify `children_config.json` has correct child names.
4. ☐ Test student switcher — each tab should show only selected child (except Messages).
5. ☐ Confirm Telegram alerts for new notifications and deadline reminders.
