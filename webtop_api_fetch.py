#!/usr/bin/env python3
"""
webtop_api_fetch.py — Direct Webtop REST API fetcher (replaces webtop_scrape.mjs)

Calls the SmartSchool REST API directly — no browser, no session cookies to expire.
Authenticates fresh on every run via username + password.
Outputs the same JSON shape as webtop_scrape.mjs to stdout.

ENV:
  WEBTOP_USER   — login username (required)
  WEBTOP_PASS   — login password (required)
  WEBTOP_BASE   — base URL (default: https://webtopserver.smartschool.co.il)
  WEBTOP_DATA   — encrypted data param from login request (default provided)
"""

import json
import os
import re
import sys
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
from datetime import datetime, timedelta

BASE_URL = os.environ.get("WEBTOP_BASE", "https://webtopserver.smartschool.co.il")
USER = os.environ.get("WEBTOP_USER", "")
PASS = os.environ.get("WEBTOP_PASS", "")
DATA_PARAM = os.environ.get("WEBTOP_DATA", "+Aabe7FAdVluG6Lu+0ibrA==")
SESSION_FILE = os.environ.get("WEBTOP_SESSION", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".webtop_session.json"))
TIMEOUT = 30
NEW_NOTIF_DAYS = 21

# Shared cookie jar — persists cookies (e.g. ASP.NET session) across all requests
_cookie_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cookie_jar))


def out(data):
    if hasattr(sys.stdout, 'buffer'):
        sys.stdout.buffer.write((json.dumps(data, ensure_ascii=False) + "\n").encode('utf-8'))
        sys.stdout.buffer.flush()
    else:
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
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    req.add_header("Origin", "https://webtop.smartschool.co.il")
    req.add_header("Referer", "https://webtop.smartschool.co.il/")
    if token:
        # webToken is HttpOnly cookie — must be sent as Cookie header
        req.add_header("Cookie", f"webToken={urllib.parse.quote(token, safe='')}")
    try:
        with _opener.open(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"HTTP {e.code} on {path}: {body_text}")
    except Exception as e:
        raise RuntimeError(f"Request failed for {path}: {e}")


def load_token_from_session():
    """Load webToken from .webtop_session.json (set by cookie_injector or Playwright scraper)."""
    if not os.path.exists(SESSION_FILE):
        raise RuntimeError(f"Session file not found: {SESSION_FILE} — run the cookie injector first")
    with open(SESSION_FILE, encoding="utf-8") as f:
        sess = json.load(f)
    cookies = sess.get("cookies") or []
    for c in cookies:
        if c.get("name") == "webToken":
            raw = c.get("value", "")
            token = urllib.parse.unquote(raw)
            if token:
                log(f"Loaded webToken from session file ({len(token)} chars)")
                return token
    raise RuntimeError("webToken not found in session file — please refresh cookies via the bookmarklet")


def get_linked_students(token):
    """Returns list of student dicts from GetMultipleUsersForUser."""
    try:
        resp = api_post("/server/api/user/GetMultipleUsersForUser", {}, token=token)
        students = resp.get("data") or []
        if isinstance(students, list):
            return students
        return []
    except Exception as e:
        log(f"GetMultipleUsersForUser failed: {e}")
        return []


def switch_student(token, student_id, saved_user=""):
    """Switch active student context. Returns new token."""
    resp = api_post("/server/api/user/ChangeUser", {
        "StudentId": student_id,
        "savedUser": saved_user,
    }, token=token)
    data = resp.get("data") or {}
    new_token = data.get("token") or data.get("webToken") or token
    return new_token


def init_dashboard(token):
    """Returns dashboard data dict."""
    resp = api_post("/server/api/dashboard/InitDashboard", {}, token=token)
    return resp.get("data") or {}


def get_discipline_events(token, encrypted_id, class_code):
    """Get discipline events (absence, late, missing_equipment, grade, good_word)."""
    try:
        resp = api_post("/server/api/dashboard/GetPupilDiciplineEvents", {
            "id": encrypted_id,
            "ClassCode": class_code,
        }, token=token)
        result = resp.get("data") or []
        return result if isinstance(result, list) else []
    except Exception as e:
        log(f"GetPupilDiciplineEvents failed: {e}")
        return []


def get_homework_api(token, encrypted_id, class_code, class_number):
    """Get homework assignments."""
    try:
        resp = api_post("/server/api/dashboard/GetHomeWork", {
            "id": encrypted_id,
            "ClassCode": class_code,
            "ClassNumber": class_number,
        }, token=token)
        result = resp.get("data") or []
        return result if isinstance(result, list) else []
    except Exception as e:
        log(f"GetHomeWork failed: {e}")
        return []


def get_messages(token, page_id=0, label_id=0):
    """Get inbox messages."""
    try:
        resp = api_post("/server/api/messageBox/GetMessagesInbox", {
            "PageId": page_id,
            "LabelId": label_id,
            "HasRead": None,
            "SearchQuery": "",
        }, token=token)
        items = resp.get("data") or []
        if isinstance(items, dict):
            items = items.get("messages") or items.get("items") or []
        return items if isinstance(items, list) else []
    except Exception as e:
        log(f"GetMessagesInbox failed: {e}")
        return []


# ── Type mapping ──────────────────────────────────────────────────────────────
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
    raw_type = (
        event.get("eventType")
        or event.get("type")
        or event.get("eventName")
        or event.get("eventTypeName")
        or ""
    )
    ntype = detect_type(raw_type)
    date_raw = (
        event.get("eventDate")
        or event.get("date")
        or event.get("lessonDate")
        or event.get("alertDate")
        or ""
    )
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
        "homeworkText": None,
        "alertTime": alert_time,
        "alertDay": None,
        "category": event.get("category") or event.get("categoryName") or None,
    }


def normalize_homework_event(hw, student_short_name):
    """Map a homework item → our notification shape."""
    date_raw = (
        hw.get("submitDate")
        or hw.get("lessonDate")
        or hw.get("date")
        or hw.get("dueDate")
        or ""
    )
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


def normalize_message(msg, student_short_name=""):
    """Map a message dict → our message shape."""
    date_raw = (
        msg.get("sendingDate")
        or msg.get("msgTime")
        or msg.get("date")
        or msg.get("sentDate")
        or ""
    )
    date = parse_date_api(date_raw)
    time_str = None
    if date_raw and "T" in str(date_raw):
        try:
            dt = datetime.fromisoformat(str(date_raw))
            time_str = dt.strftime("%H:%M")
        except Exception:
            pass
    sender = (msg.get("senderName") or msg.get("from") or msg.get("sender") or "").strip()
    student_f = (msg.get("student_F_name") or "").strip()
    student_l = (msg.get("student_L_name") or "").strip()
    student = f"{student_f} {student_l}".strip() or student_short_name
    return {
        "student": student,
        "subject": (msg.get("subject") or "(ללא נושא)").strip(),
        "from": sender,
        "fromRole": (msg.get("senderRole") or msg.get("role") or "").strip(),
        "date": date,
        "time": time_str,
        "body": (msg.get("body") or msg.get("content") or msg.get("message") or "")[:500].strip(),
        "read": bool(msg.get("isRead") or msg.get("read") or False),
    }


def process_student(tok, child_info, short_name):
    """Fetch all data for one student. Returns (notifs, hw_list)."""
    enc_id = (
        child_info.get("encryptedId")
        or child_info.get("id")
        or child_info.get("studentId")
        or child_info.get("pupilId")
        or ""
    )
    class_code = child_info.get("classCode") or child_info.get("classID") or child_info.get("class") or ""
    class_num = child_info.get("classNumber") or child_info.get("grade") or child_info.get("classNum") or ""

    log(f"Fetching for {short_name} — id={str(enc_id)[:20]}, class={class_code}/{class_num}")

    notifs = []
    hw_list = []

    if enc_id:
        # Discipline events (absence, late, missing_equipment, grade, good_word)
        disc = get_discipline_events(tok, enc_id, class_code)
        for ev in disc:
            n = normalize_discipline_event(ev, short_name)
            if n["date"] and is_recent(n["date"]):
                notifs.append(n)
        log(f"  discipline events: {len([n for n in notifs])} recent")

        # Homework
        hw_raw = get_homework_api(tok, enc_id, class_code, class_num)
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
    else:
        log(f"  WARNING: no encrypted ID for {short_name} — skipping discipline/homework")

    return notifs, hw_list


if __name__ == "__main__":
    try:
        token = load_token_from_session()

        # ── Get linked students (multi-child accounts) ────────────────────────
        linked = get_linked_students(token)
        log(f"Linked students from GetMultipleUsersForUser: {len(linked)}")

        # ── Get primary dashboard ─────────────────────────────────────────────
        primary_dashboard = init_dashboard(token)
        childrens = primary_dashboard.get("childrens") or primary_dashboard.get("children") or []
        log(f"Children from InitDashboard: {[c.get('firstName', '?') for c in childrens]}")

        # ── Collect per-student data ──────────────────────────────────────────
        all_notifications = []
        homework_by_student = {}
        grades_by_student = {}
        class_events_by_student = {}
        school_events_by_student = {}
        all_messages = []
        students_found = []

        if len(linked) > 1:
            # Multi-student account: switch between students
            for s in linked:
                sid = s.get("studentId") or s.get("id")
                login_name = s.get("studentLogin") or ""
                if not sid:
                    continue
                log(f"Switching to student {sid}...")
                try:
                    tok2 = switch_student(token, sid, login_name)
                    dash2 = init_dashboard(tok2)
                    ch2_list = dash2.get("childrens") or dash2.get("children") or []
                    ch2 = ch2_list[0] if ch2_list else {}
                    short_name = (
                        ch2.get("firstName")
                        or s.get("firstName")
                        or s.get("name")
                        or str(sid)
                    ).strip()
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
                    log(f"Failed processing student {sid}: {e}")
        elif len(childrens) > 0:
            # One or more children in dashboard (parent account)
            for ch in childrens:
                short_name = (ch.get("firstName") or "").strip()
                if not short_name:
                    continue
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
            log("WARNING: No children found in dashboard — data may be incomplete")

        # ── Fetch messages (once per account) ─────────────────────────────────
        msgs_raw = get_messages(token)
        for m in msgs_raw:
            all_messages.append(normalize_message(m))
        log(f"Messages: {len(all_messages)}")

        # ── Deduplicate notifications ─────────────────────────────────────────
        seen = {}
        for n in all_notifications:
            k = f"{n.get('type','').strip()}_{n.get('student','').strip()}_{n.get('subject','').strip()}_{n.get('date','').strip()}_{n.get('lesson','')}"
            if k not in seen:
                seen[k] = n
        all_notifications = list(seen.values())

        # ── Build output ──────────────────────────────────────────────────────
        primary_student = students_found[0] if students_found else ""
        primary_name = (
            (childrens[0].get("firstName") if childrens else None)
            or primary_student
            or ""
        ).strip()

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
        err_str = str(e)
        # Exit code 2 = session expired (same signal as Playwright scraper)
        # push_loop.mjs handles this by triggering the cookie recovery flow
        if "401" in err_str or "Unauthorized" in err_str or "webToken not found" in err_str or "Session file not found" in err_str:
            out({"ok": False, "error": err_str})
            sys.exit(2)
        out({"ok": False, "error": err_str})
        sys.exit(1)
