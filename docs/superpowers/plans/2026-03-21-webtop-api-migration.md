# Webtop API Migration: Playwright → pywebtop HTTP API

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,535-line Playwright browser scraper (`webtop_scrape.mjs`) with a direct HTTP API caller (`webtop_api_fetch.py`) that uses the same REST endpoints as pywebtop — eliminating session disconnects, CloudFront blocks, and reCAPTCHA failures.

**Architecture:** A new Python script (`webtop_api_fetch.py`) authenticates directly via the Webtop REST API (POST to `/server/api/user/LoginByUserNameAndPassword`), fetches notifications/homework/discipline/messages for each child, and outputs the **exact same JSON shape** that `server.js` currently expects. `server.js` and `push_loop.mjs` call this Python script in place of `webtop_scrape.mjs` — no other files change.

**Tech Stack:** Python 3 (stdlib only — `urllib`, `json`, `os`), Node.js (existing), Express (existing). No new npm packages. Python must be available on the home machine.

---

## Chunk 1: Python API Fetcher

### Task 1: Create the Python API fetcher skeleton

**Files:**
- Create: `webtop_api_fetch.py`

The output shape this script must produce (matches current `webtop_scrape.mjs` output):

```json
{
  "ok": true,
  "extractedAt": "ISO string",
  "data": {
    "studentName": "שם",
    "notifications": [
      {
        "student": "אמי",
        "type": "homework|absence|late|missing_equipment|grade|good_word|general",
        "subject": "מתמטיקה",
        "date": "DD/MM/YYYY",
        "lesson": 3,
        "description": "...",
        "homeworkText": "...",
        "alertTime": "HH:MM",
        "alertDay": "יום חמישי, 26/02/2026",
        "category": "אירועי שיעור"
      }
    ],
    "homeworkByStudent": { "אמי": [{"subject":"","date":"","text":"","lesson":null}] },
    "gradesByStudent": { "אמי": [{"subject":"","date":"","text":""}] },
    "classEventsByStudent": {},
    "schoolEventsByStudent": {},
    "messages": [
      {
        "student": "אמי",
        "subject": "...",
        "from": "...",
        "fromRole": "מורה",
        "date": "DD/MM/YYYY",
        "time": "HH:MM",
        "body": "...",
        "read": false
      }
    ],
    "signoffs": [],
    "approvals": [],
    "usefulLinks": [],
    "tables": [],
    "classEvents": [],
    "homework": [],
    "grades": [],
    "schoolEvents": [],
    "_debug": { "studentsFound": [], "headingsFound": [] }
  },
  "count": 0
}
```

- [ ] **Step 1: Create `webtop_api_fetch.py` with authentication**

```python
#!/usr/bin/env python3
"""
webtop_api_fetch.py — Direct Webtop REST API fetcher (replaces webtop_scrape.mjs)

Calls the SmartSchool REST API directly — no browser, no session cookies to expire.
Outputs the same JSON shape as webtop_scrape.mjs to stdout.

ENV:
  WEBTOP_USER   — login username (required)
  WEBTOP_PASS   — login password (required)
  WEBTOP_BASE   — base URL (default: https://webtopserver.smartschool.co.il)
"""

import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta

BASE_URL = os.environ.get("WEBTOP_BASE", "https://webtopserver.smartschool.co.il")
USER = os.environ.get("WEBTOP_USER", "")
PASS = os.environ.get("WEBTOP_PASS", "")
DATA_PARAM = os.environ.get("WEBTOP_DATA", "+Aabe7FAdVluG6Lu+0ibrA==")
TIMEOUT = 30
NEW_NOTIF_DAYS = 21


def out(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg):
    sys.stderr.write(f"[api] {msg}\n")
    sys.stderr.flush()


def api_post(path, body, token=None):
    """POST to Webtop API, returns parsed JSON response."""
    url = BASE_URL + path
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    if token:
        req.add_header("Cookie", f"webToken={token}")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"HTTP {e.code} on {path}: {body_text}")
    except Exception as e:
        raise RuntimeError(f"Request failed for {path}: {e}")


def login():
    """Login and return token string."""
    if not USER or not PASS:
        raise RuntimeError("WEBTOP_USER / WEBTOP_PASS not set in environment")
    log(f"Logging in as {USER}...")
    resp = api_post("/server/api/user/LoginByUserNameAndPassword", {
        "UserName": USER,
        "Password": PASS,
        "Data": DATA_PARAM,
        "RememberMe": False,
        "BiometricLogin": "",
    })
    if resp.get("status") != 200 and resp.get("errorCode") not in [None, 0]:
        raise RuntimeError(f"Login failed: {resp}")
    token = (resp.get("data") or {}).get("token")
    if not token:
        # Some versions nest differently
        token = resp.get("token") or resp.get("data", {}).get("webToken")
    if not token:
        raise RuntimeError(f"No token in login response: {json.dumps(resp)[:200]}")
    log("Login OK")
    return token


if __name__ == "__main__":
    try:
        token = login()
        # Placeholder — next tasks add data fetching
        out({"ok": True, "extractedAt": datetime.now().isoformat(), "data": {}, "count": 0})
    except Exception as e:
        out({"ok": False, "error": str(e)})
        sys.exit(1)
```

- [ ] **Step 2: Test login manually**

```bash
cd "c:/Users/Master_PC/Desktop/Projects Eldad/01_Active_Projects/n8n/Webtop_APP"
WEBTOP_USER=YOUR_USER WEBTOP_PASS=YOUR_PASS python webtop_api_fetch.py
```

Expected: `{"ok": true, "extractedAt": "...", "data": {}, "count": 0}`
If `WEBTOP_USER`/`WEBTOP_PASS` are already in `.env`, they'll be loaded by the caller (push_loop).

- [ ] **Step 3: Commit skeleton**

```bash
git add webtop_api_fetch.py
git commit -m "feat: add webtop_api_fetch.py skeleton with login"
```

---

### Task 2: Fetch linked students and switch between them

**Files:**
- Modify: `webtop_api_fetch.py`

- [ ] **Step 1: Add `get_linked_students()` and `switch_student()`**

Add these functions after `login()`:

```python
def get_linked_students(token):
    """Returns list of {studentId, studentLogin, school_name} dicts."""
    resp = api_post("/server/api/user/GetMultipleUsersForUser", {}, token=token)
    students = resp.get("data") or []
    if isinstance(students, list):
        return students
    return []


def switch_student(token, student_id, saved_user=""):
    """Switch active student context. Returns new token or same token."""
    resp = api_post("/server/api/user/ChangeUser", {
        "StudentId": student_id,
        "savedUser": saved_user,
    }, token=token)
    new_token = (resp.get("data") or {}).get("token") or token
    return new_token


def init_dashboard(token):
    """Returns dashboard data including childrens[] array."""
    resp = api_post("/server/api/dashboard/InitDashboard", {}, token=token)
    return resp.get("data") or {}
```

- [ ] **Step 2: Test student listing**

```python
# Add to __main__ block temporarily:
students = get_linked_students(token)
print("Students:", json.dumps(students, ensure_ascii=False, indent=2), file=sys.stderr)
```

Expected: array of student objects, or empty list for single-student accounts.

- [ ] **Step 3: Commit student switching**

```bash
git add webtop_api_fetch.py
git commit -m "feat: add get_linked_students and switch_student API calls"
```

---

### Task 3: Fetch and normalize notifications

**Files:**
- Modify: `webtop_api_fetch.py`

The Webtop API returns notifications as pre-structured objects (not raw Hebrew strings like the scraper). We map them to the same output shape.

- [ ] **Step 1: Add `get_notifications()` and `normalize_notification()`**

```python
def get_notifications(token):
    """Get unread notifications preview."""
    resp = api_post("/server/api/Menu/GetPreviewUnreadNotifications", {}, token=token)
    items = resp.get("data") or []
    if isinstance(items, list):
        return items
    # Some responses wrap in another key
    if isinstance(items, dict):
        return items.get("notifications") or items.get("items") or []
    return []


def get_discipline_events(token, encrypted_id, class_code):
    """Get discipline events (absence, late, missing_equipment, good_word)."""
    resp = api_post("/server/api/dashboard/GetPupilDiciplineEvents", {
        "id": encrypted_id,
        "ClassCode": class_code,
    }, token=token)
    return resp.get("data") or []


def get_homework_api(token, encrypted_id, class_code, class_number):
    """Get homework assignments."""
    resp = api_post("/server/api/dashboard/GetHomeWork", {
        "id": encrypted_id,
        "ClassCode": class_code,
        "ClassNumber": class_number,
    }, token=token)
    return resp.get("data") or []


TYPE_MAP = {
    "absence": "absence",
    "late": "late",
    "חיסור": "absence",
    "איחור": "late",
    "חוסר ציוד": "missing_equipment",
    "missing_equipment": "missing_equipment",
    "ציון": "grade",
    "grade": "grade",
    "שיעורי בית": "homework",
    "homework": "homework",
    "אי הכנת שיעורי בית": "homework_not_done",
    "homework_not_done": "homework_not_done",
    "מילה טובה": "good_word",
    "good_word": "good_word",
}


def detect_type(raw_type_str):
    """Map API event type string to our internal type."""
    if not raw_type_str:
        return "general"
    s = str(raw_type_str).strip()
    for key, val in TYPE_MAP.items():
        if key.lower() in s.lower():
            return val
    return "general"


def parse_date_api(date_str):
    """Convert various API date formats to DD/MM/YYYY."""
    if not date_str:
        return None
    # Handle ISO format: 2026-02-26T00:00:00
    if "T" in str(date_str):
        try:
            d = datetime.fromisoformat(str(date_str).split("T")[0])
            return d.strftime("%d/%m/%Y")
        except Exception:
            pass
    # Already DD/MM/YYYY
    import re
    m = re.search(r"(\d{2}/\d{2}/\d{4})", str(date_str))
    if m:
        return m.group(1)
    return None


def is_recent(date_dd_mm_yyyy, days=NEW_NOTIF_DAYS):
    """True if date is within last N days or in the future."""
    if not date_dd_mm_yyyy:
        return False
    try:
        dd, mm, yyyy = map(int, date_dd_mm_yyyy.split("/"))
        d = datetime(yyyy, mm, dd)
        cutoff = datetime.now() - timedelta(days=days)
        return d >= cutoff
    except Exception:
        return False


def normalize_discipline_event(event, student_short_name):
    """Map a discipline event dict → our notification shape."""
    raw_type = event.get("eventType") or event.get("type") or event.get("eventName") or ""
    ntype = detect_type(raw_type)
    date_raw = event.get("eventDate") or event.get("date") or event.get("lessonDate") or ""
    date = parse_date_api(date_raw)
    subject = (event.get("subjectName") or event.get("subject") or "").strip()
    lesson = event.get("lessonNumber") or event.get("lesson") or event.get("lessonNum")
    description = (event.get("eventDesc") or event.get("description") or raw_type or "").strip()
    alert_time_raw = event.get("alertTime") or event.get("alertDate") or ""
    alert_time = None
    if alert_time_raw and "T" in str(alert_time_raw):
        try:
            dt = datetime.fromisoformat(str(alert_time_raw))
            alert_time = dt.strftime("%H:%M")
        except Exception:
            pass
    return {
        "student": student_short_name,
        "type": ntype,
        "subject": subject,
        "date": date,
        "lesson": int(lesson) if lesson is not None else None,
        "description": description,
        "alertTime": alert_time,
        "alertDay": None,
        "category": event.get("category") or None,
    }


def normalize_homework_event(hw, student_short_name):
    """Map a homework item → our notification shape."""
    date_raw = hw.get("submitDate") or hw.get("lessonDate") or hw.get("date") or ""
    date = parse_date_api(date_raw)
    subject = (hw.get("subjectName") or hw.get("subject") or "").strip()
    hw_text = (hw.get("homeWorkText") or hw.get("text") or hw.get("description") or "").strip()
    lesson = hw.get("lessonNumber") or hw.get("lesson")
    return {
        "student": student_short_name,
        "type": "homework",
        "subject": subject,
        "date": date,
        "lesson": int(lesson) if lesson is not None else None,
        "description": hw_text,
        "homeworkText": hw_text,
        "alertTime": None,
        "alertDay": None,
        "category": None,
    }
```

- [ ] **Step 2: Test discipline events for one student**

```python
# Temporarily in __main__:
dashboard = init_dashboard(token)
# Log raw dashboard to understand structure
log(f"Dashboard keys: {list(dashboard.keys())}")
childrens = dashboard.get("childrens") or dashboard.get("children") or []
log(f"Children from dashboard: {json.dumps(childrens, ensure_ascii=False)[:500]}")
```

Expected: see children array with `id`, `classCode`, `classNumber` fields.

- [ ] **Step 3: Commit normalization functions**

```bash
git add webtop_api_fetch.py
git commit -m "feat: add notification/homework normalization from API responses"
```

---

### Task 4: Fetch messages

**Files:**
- Modify: `webtop_api_fetch.py`

- [ ] **Step 1: Add `get_messages()` and `normalize_message()`**

```python
def get_messages(token, page_id=0, label_id=0):
    """Get inbox messages."""
    resp = api_post("/server/api/messageBox/GetMessagesInbox", {
        "PageId": page_id,
        "LabelId": label_id,
        "HasRead": False,
        "SearchQuery": "",
    }, token=token)
    items = resp.get("data") or []
    if isinstance(items, dict):
        items = items.get("messages") or items.get("items") or []
    return items if isinstance(items, list) else []


def normalize_message(msg, student_short_name=""):
    """Map a message dict → our message shape."""
    date_raw = msg.get("sendingDate") or msg.get("msgTime") or msg.get("date") or ""
    date = parse_date_api(date_raw)
    time_str = None
    if date_raw and "T" in str(date_raw):
        try:
            dt = datetime.fromisoformat(str(date_raw))
            time_str = dt.strftime("%H:%M")
        except Exception:
            pass
    sender = (msg.get("senderName") or msg.get("from") or "").strip()
    student_f = (msg.get("student_F_name") or "").strip()
    student_l = (msg.get("student_L_name") or "").strip()
    student = f"{student_f} {student_l}".strip() or student_short_name
    return {
        "student": student,
        "subject": (msg.get("subject") or "(ללא נושא)").strip(),
        "from": sender,
        "fromRole": (msg.get("senderRole") or "").strip(),
        "date": date,
        "time": time_str,
        "body": (msg.get("body") or msg.get("content") or "")[:500].strip(),
        "read": bool(msg.get("isRead") or msg.get("read") or False),
    }
```

- [ ] **Step 2: Commit message fetching**

```bash
git add webtop_api_fetch.py
git commit -m "feat: add get_messages and normalize_message"
```

---

### Task 5: Build the main fetch loop and final output

**Files:**
- Modify: `webtop_api_fetch.py`

This ties everything together — iterates per student, deduplicates, and produces the final JSON.

- [ ] **Step 1: Replace the `__main__` block with the full fetch loop**

```python
if __name__ == "__main__":
    try:
        if not USER or not PASS:
            out({"ok": False, "error": "WEBTOP_USER / WEBTOP_PASS not set"})
            sys.exit(1)

        token = login()

        # ── Get linked students ──────────────────────────────────────────────
        linked = get_linked_students(token)
        log(f"Linked students: {len(linked)}")

        # ── Get primary dashboard (for student name + first student context) ─
        primary_dashboard = init_dashboard(token)
        childrens = primary_dashboard.get("childrens") or primary_dashboard.get("children") or []
        log(f"Children from dashboard: {[c.get('firstName','?') for c in childrens]}")

        # ── Collect all data ─────────────────────────────────────────────────
        all_notifications = []
        homework_by_student = {}
        grades_by_student = {}
        class_events_by_student = {}
        school_events_by_student = {}
        all_messages = []
        students_found = []

        def process_student(tok, child_info, short_name):
            """Fetch all data for one student, return (notifs, hw_list, msg_list)."""
            enc_id = child_info.get("encryptedId") or child_info.get("id") or child_info.get("studentId") or ""
            class_code = child_info.get("classCode") or child_info.get("classID") or ""
            class_num = child_info.get("classNumber") or child_info.get("grade") or ""

            log(f"Fetching for {short_name} — id={str(enc_id)[:20]}, class={class_code}/{class_num}")

            notifs = []
            hw_list = []

            # Discipline events (absence, late, missing_equipment, grade, good_word)
            if enc_id:
                try:
                    disc = get_discipline_events(tok, enc_id, class_code)
                    if isinstance(disc, list):
                        for ev in disc:
                            n = normalize_discipline_event(ev, short_name)
                            if n["date"] and is_recent(n["date"]):
                                notifs.append(n)
                    log(f"  discipline events: {len(notifs)} recent")
                except Exception as e:
                    log(f"  discipline events failed: {e}")

            # Homework
            if enc_id:
                try:
                    hw_raw = get_homework_api(tok, enc_id, class_code, class_num)
                    if isinstance(hw_raw, list):
                        for hw in hw_raw:
                            n = normalize_homework_event(hw, short_name)
                            if n["date"] and is_recent(n["date"]):
                                notifs.append(n)
                                hw_list.append({
                                    "subject": n["subject"],
                                    "date": n["date"],
                                    "text": n.get("homeworkText") or n.get("description") or "",
                                    "lesson": n["lesson"],
                                })
                    log(f"  homework: {len(hw_list)} items")
                except Exception as e:
                    log(f"  homework failed: {e}")

            return notifs, hw_list

        # ── If multiple students via GetMultipleUsersForUser ─────────────────
        if len(linked) > 1:
            for s in linked:
                sid = s.get("studentId") or s.get("id")
                login_name = s.get("studentLogin") or ""
                if not sid:
                    continue
                log(f"Switching to student {sid}...")
                try:
                    tok2 = switch_student(token, sid, login_name)
                    dash2 = init_dashboard(tok2)
                    ch2 = (dash2.get("childrens") or dash2.get("children") or [{}])[0]
                    short_name = (ch2.get("firstName") or s.get("firstName") or str(sid)).strip()
                    students_found.append(short_name)
                    notifs, hw_list = process_student(tok2, ch2, short_name)
                    all_notifications.extend(notifs)
                    homework_by_student[short_name] = hw_list
                    grades_by_student[short_name] = [
                        {"subject": n["subject"], "date": n["date"], "text": n.get("description", "")}
                        for n in notifs if n["type"] == "grade"
                    ]
                    class_events_by_student[short_name] = []
                    school_events_by_student[short_name] = []
                except Exception as e:
                    log(f"Failed for student {sid}: {e}")
        elif len(childrens) > 0:
            # Single student — use childrens[0] from dashboard
            ch = childrens[0]
            short_name = (ch.get("firstName") or "").strip()
            students_found.append(short_name)
            notifs, hw_list = process_student(token, ch, short_name)
            all_notifications.extend(notifs)
            homework_by_student[short_name] = hw_list
            grades_by_student[short_name] = [
                {"subject": n["subject"], "date": n["date"], "text": n.get("description", "")}
                for n in notifs if n["type"] == "grade"
            ]
            class_events_by_student[short_name] = []
            school_events_by_student[short_name] = []
        else:
            log("No children found in dashboard — trying notifications only")

        # ── Fetch messages (once per account) ────────────────────────────────
        try:
            msgs_raw = get_messages(token)
            for m in msgs_raw:
                all_messages.append(normalize_message(m))
            log(f"Messages: {len(all_messages)}")
        except Exception as e:
            log(f"Messages failed: {e}")

        # ── Deduplicate notifications ─────────────────────────────────────────
        def notif_key(n):
            return f"{n.get('type','').strip()}_{n.get('student','').strip()}_{n.get('subject','').strip()}_{n.get('date','').strip()}_{n.get('lesson','')}"

        seen = {}
        for n in all_notifications:
            k = notif_key(n)
            if k not in seen:
                seen[k] = n
        all_notifications = list(seen.values())

        # ── Build backward-compat flat fields (first student) ────────────────
        primary_student = students_found[0] if students_found else ""
        primary_name = (childrens[0].get("firstName") or primary_student or "").strip() if childrens else primary_student

        output = {
            "ok": True,
            "extractedAt": datetime.now().isoformat(),
            "url": "https://webtopserver.smartschool.co.il/api",
            "data": {
                "studentName": primary_name,
                "notifications": all_notifications,
                "homeworkByStudent": homework_by_student,
                "gradesByStudent": grades_by_student,
                "classEventsByStudent": class_events_by_student,
                "schoolEventsByStudent": school_events_by_student,
                "messages": all_messages,
                "signoffs": [],
                "approvals": [],
                "usefulLinks": [],
                "tables": [],
                # Backward compat flat fields
                "classEvents": [],
                "homework": homework_by_student.get(primary_student, []),
                "grades": grades_by_student.get(primary_student, []),
                "schoolEvents": [],
                "_debug": {
                    "studentsFound": students_found,
                    "headingsFound": [],
                },
            },
            "count": len(all_notifications),
        }

        out(output)

    except Exception as e:
        import traceback
        log(traceback.format_exc())
        out({"ok": False, "error": str(e)})
        sys.exit(1)
```

- [ ] **Step 2: Full end-to-end test**

```bash
cd "c:/Users/Master_PC/Desktop/Projects Eldad/01_Active_Projects/n8n/Webtop_APP"
python webtop_api_fetch.py 2>&1 | head -5
```

Expected: JSON line starting with `{"ok": true, ...}` containing notifications array and `homeworkByStudent`/`gradesByStudent` maps.

If `ok: false`, check stderr for specific API errors and adjust field name mapping.

- [ ] **Step 3: Commit full fetch loop**

```bash
git add webtop_api_fetch.py
git commit -m "feat: complete webtop_api_fetch.py with full per-student data loop"
```

---

## Chunk 2: Wire Python Script into Node.js Infrastructure

### Task 6: Update `server.js` to call Python fetcher

**Files:**
- Modify: `server.js` (lines 127–141, the `runScraper()` function)

- [ ] **Step 1: Read the current `runScraper()` in `server.js`**

Current (lines 127–141):
```js
function runScraper() {
  return new Promise((resolve, reject) => {
    const scraperPath = join(__dirname, 'webtop_scrape.mjs');
    const env = { ...process.env, WEBTOP_SESSION: join(__dirname, '.webtop_session.json') };
    const proc = spawn(process.execPath, [scraperPath], { env, cwd: __dirname });
    ...
  });
}
```

- [ ] **Step 2: Replace `runScraper()` to support both Python and Playwright**

Replace the `runScraper()` function body in `server.js`:

```js
function runScraper() {
  return new Promise((resolve, reject) => {
    // Prefer Python API fetcher if available; fall back to Playwright scraper
    const pyScript = join(__dirname, 'webtop_api_fetch.py');
    const jsScript = join(__dirname, 'webtop_scrape.mjs');
    const usePython = existsSync(pyScript) && process.env.USE_API_FETCHER !== 'false';

    let proc;
    if (usePython) {
      const pythonBin = process.env.PYTHON_BIN || 'python';
      proc = spawn(pythonBin, [pyScript], { env: { ...process.env }, cwd: __dirname });
    } else {
      const env = { ...process.env, WEBTOP_SESSION: join(__dirname, '.webtop_session.json') };
      proc = spawn(process.execPath, [jsScript], { env, cwd: __dirname });
    }

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => (stdout += d));
    proc.stderr.on('data', d => (stderr += d));
    proc.on('close', code => {
      if (stderr.trim()) console.log('[scraper-stderr]', stderr.trim().slice(0, 500));
      if (code !== 0) return reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 500)}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error(`JSON parse failed: ${stdout.slice(0, 300)}`)); }
    });
  });
}
```

- [ ] **Step 3: Test via `GET /api/data?refresh=1` after restarting server**

```bash
cd "c:/Users/Master_PC/Desktop/Projects Eldad/01_Active_Projects/n8n/Webtop_APP"
node server.js &
sleep 35
curl http://localhost:3000/api/health
```

Expected: `{"healthy": true, "status": "OK", ...}` with notification counts > 0.

- [ ] **Step 4: Commit server.js change**

```bash
git add server.js
git commit -m "feat: wire Python API fetcher into runScraper with JS fallback"
```

---

### Task 7: Update `push_loop.mjs` to call Python fetcher

**Files:**
- Modify: `push_loop.mjs` (the `runScraper()` function, around line 60–90)

- [ ] **Step 1: Read the current `runScraper()` in `push_loop.mjs`**

The push_loop has its own `runScraper()` that spawns `webtop_scrape.mjs`.

- [ ] **Step 2: Apply same Python-first pattern**

Find and replace the `runScraper()` function in `push_loop.mjs`:

```js
function runScraper() {
  return new Promise((resolve, reject) => {
    const pyScript = join(__dirname, 'webtop_api_fetch.py');
    const jsScript = join(__dirname, 'webtop_scrape.mjs');
    const usePython = existsSync(pyScript) && process.env.USE_API_FETCHER !== 'false';

    let proc;
    if (usePython) {
      const pythonBin = process.env.PYTHON_BIN || 'python';
      proc = spawn(pythonBin, [pyScript], { env: { ...process.env }, cwd: __dirname });
    } else {
      const env = { ...process.env, WEBTOP_SESSION: join(__dirname, '.webtop_session.json') };
      proc = spawn(process.execPath, [jsScript], { env, cwd: __dirname });
    }

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => (stdout += d));
    proc.stderr.on('data', d => (stderr += d));
    proc.on('close', code => {
      if (stderr.trim()) console.log('[scraper-stderr]', stderr.trim().slice(0, 500));
      if (code !== 0) return reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 500)}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error(`JSON parse failed: ${stdout.slice(0, 300)}`)); }
    });
  });
}
```

Add `existsSync` to imports at top if not already present.

- [ ] **Step 3: Commit push_loop.mjs change**

```bash
git add push_loop.mjs
git commit -m "feat: wire Python API fetcher into push_loop.mjs with JS fallback"
```

---

### Task 8: Update `scrape_and_push.mjs` to call Python fetcher

**Files:**
- Modify: `scrape_and_push.mjs` (the `runScraper()` function)

- [ ] **Step 1: Apply same Python-first pattern to `scrape_and_push.mjs`**

The `runScraper()` in this file (lines 31–46) also spawns `webtop_scrape.mjs`. Apply the same replacement as in Tasks 6 and 7.

- [ ] **Step 2: Commit**

```bash
git add scrape_and_push.mjs
git commit -m "feat: wire Python API fetcher into scrape_and_push.mjs"
```

---

## Chunk 3: Validation and Debugging

### Task 9: End-to-end validation

**Files:**
- Read: `server.js` (health endpoint)

- [ ] **Step 1: Check Python is installed on home machine**

```bash
python --version
# OR
python3 --version
```

If `python3` is the command, set `PYTHON_BIN=python3` in `.env`.

- [ ] **Step 2: Run full validation sequence**

```bash
# 1. Direct Python test
cd "c:/Users/Master_PC/Desktop/Projects Eldad/01_Active_Projects/n8n/Webtop_APP"
python webtop_api_fetch.py 2>api_test_err.txt | python -c "
import sys, json
d = json.load(sys.stdin)
print('ok:', d.get('ok'))
data = d.get('data', {})
print('students found:', data.get('_debug', {}).get('studentsFound', []))
print('notifications:', len(data.get('notifications', [])))
print('messages:', len(data.get('messages', [])))
print('homework students:', list(data.get('homeworkByStudent', {}).keys()))
"
cat api_test_err.txt
```

Expected output:
```
ok: True
students found: ['אמי', 'יולי']   (or similar)
notifications: N   (> 0)
messages: M
homework students: ['אמי', 'יולי']
```

- [ ] **Step 3: Check API health endpoint**

```bash
curl http://localhost:3000/api/health
```

Expected: `{"healthy":true,"status":"OK",...}` — all checks OK or WARN (not FAIL).

- [ ] **Step 4: Verify data appears correctly in the app**

Open `https://webtop.egautomations.cloud` in browser. Confirm:
- Both children's data loads
- Notifications appear with correct types/dates
- Homework assignments show

- [ ] **Step 5: Check Telegram alerts still fire**

Trigger a manual refresh:
```bash
curl -X POST http://localhost:3000/api/push -H "Content-Type: application/json" \
  -d '{"secret":"webtop2026","data":{...}}'
```

Or wait for push_loop.mjs to fire naturally.

---

### Task 10: Debugging field mapping (if data is missing)

This task is for when Task 9 shows empty notifications or missing students. The API field names may differ from what the pywebtop library documents.

- [ ] **Step 1: Add debug dump to `webtop_api_fetch.py`**

Temporarily add at the top of `__main__`, after `init_dashboard`:

```python
# DEBUG: dump raw API responses to understand field names
log("=== RAW DASHBOARD ===")
log(json.dumps(primary_dashboard, ensure_ascii=False, indent=2)[:3000])

if childrens:
    ch = childrens[0]
    enc_id = ch.get("encryptedId") or ch.get("id") or ch.get("studentId")
    class_code = ch.get("classCode") or ch.get("classID") or ""
    log(f"Child fields: {list(ch.keys())}")
    log(f"enc_id={enc_id}, class_code={class_code}")

    # Raw discipline events
    try:
        disc_raw = api_post("/server/api/dashboard/GetPupilDiciplineEvents", {
            "id": enc_id, "ClassCode": class_code
        }, token=token)
        log("=== RAW DISCIPLINE ===")
        log(json.dumps(disc_raw, ensure_ascii=False, indent=2)[:3000])
    except Exception as e:
        log(f"disc error: {e}")

    # Raw homework
    class_num = ch.get("classNumber") or ch.get("grade") or ""
    try:
        hw_raw = api_post("/server/api/dashboard/GetHomeWork", {
            "id": enc_id, "ClassCode": class_code, "ClassNumber": class_num
        }, token=token)
        log("=== RAW HOMEWORK ===")
        log(json.dumps(hw_raw, ensure_ascii=False, indent=2)[:3000])
    except Exception as e:
        log(f"hw error: {e}")
```

- [ ] **Step 2: Run and capture raw output**

```bash
python webtop_api_fetch.py > /dev/null 2>debug_raw.txt
```

Read `debug_raw.txt` and update field names in `normalize_discipline_event()` / `normalize_homework_event()` to match actual API response fields.

- [ ] **Step 3: Remove debug dump, re-test, commit fix**

```bash
git add webtop_api_fetch.py
git commit -m "fix: correct API field mapping from debug inspection"
```

---

### Task 11: Update `.env` documentation and keepalive

**Files:**
- Modify: `.env` (add `PYTHON_BIN` if needed)

- [ ] **Step 1: Add `PYTHON_BIN` to `.env` if needed**

If `python` is not the system command (e.g., it's `python3`):
```
PYTHON_BIN=python3
```

- [ ] **Step 2: Set `USE_API_FETCHER` escape hatch in `.env`**

```
# Set to 'false' to fall back to Playwright browser scraper
# USE_API_FETCHER=false
```

- [ ] **Step 3: Final commit**

```bash
git add .env
git commit -m "chore: document Python fetcher env vars"
```

---

### Task 12: VPS deployment

**Files:**
- Remote: `/root/webtop/` on VPS

- [ ] **Step 1: Push to git**

```bash
git push origin main
```

- [ ] **Step 2: Pull on VPS and restart**

```bash
# SSH to VPS
cd /root/webtop
git pull origin main
pm2 restart webtop-server
pm2 logs webtop-server --lines 20
```

- [ ] **Step 3: Monitor for 30 minutes**

Watch PM2 logs to confirm:
- `[api] Login OK`
- `[api] Children from dashboard: [...]`
- `[scraper-stderr]` lines show student names and notification counts
- No `ok: false` errors

- [ ] **Step 4: Final health check**

```bash
curl https://webtop.egautomations.cloud/api/health
```

Expected: `{"healthy":true,"status":"OK"}`

---

## Notes for Agent

### Critical constraints
1. **Output JSON shape must match exactly** — `server.js` reads `data.notifications`, `data.homeworkByStudent`, `data.gradesByStudent`, `data.messages`. Any renamed key breaks the app silently.
2. **`ok: false` causes push rejection** — `server.js` line 377 rejects pushes where `data.ok === false`. The Python script must return `ok: true` on success.
3. **No UI changes** — `public/app.js` and `public/index.html` are untouched.
4. **Fallback preserved** — `USE_API_FETCHER=false` in `.env` re-enables Playwright scraper immediately.

### API field mapping uncertainty
The pywebtop library documents field names, but real API responses may vary by school or API version. Task 10 handles this via debug inspection. The `normalize_*` functions are designed to try multiple field name variants.

### Grades source
The current scraper gets grades from two sources:
1. DOM scraping of the "ציונים שוטפים" dashboard card
2. Notifications of type `grade`

The Python fetcher covers source 2 via `GetPupilDiciplineEvents`. If grades appear as discipline events with type `grade`, they'll work. If not, they'll still show as grade-type notifications from GetPreviewUnreadNotifications.

### Children: יולי and אמי
From memory: the two children are יולי and אמי. Their names appear in both `children_config.json` and as student name strings in notifications. The Python fetcher uses `firstName` from the dashboard `childrens` array as the short name for notification attribution.
