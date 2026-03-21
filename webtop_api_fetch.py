#!/usr/bin/env python3
"""
webtop_api_fetch.py — Direct Webtop REST API fetcher (replaces webtop_scrape.mjs)

Calls the SmartSchool REST API directly — no browser, no CAPTCHA on the fetch path.
Authenticates each run via LoginByUserNameAndPassword (WEBTOP_USER / WEBTOP_PASS),
then uses webToken for API calls. If API login fails, falls back to webToken in
WEBTOP_SESSION file (bookmarklet / Playwright).

ENV:
  WEBTOP_USER       — login username (for API login)
  WEBTOP_PASS       — login password (for API login)
  WEBTOP_BASE       — API base URL (default: https://webtopserver.smartschool.co.il)
  WEBTOP_DATA       — encrypted "Data" field from the school login form (default provided)
  WEBTOP_API_LOGIN           — if false, skip API login and use session file only
  WEBTOP_SESSION_FALLBACK    — false = API only (fail if login returns no token). Default / unset = after
                               failed API login, try .webtop_session.json (some schools block cold REST login).
  WEBTOP_RECAPTCHA_RESPONSE  — optional; if set, sent on login POST when server requires reCAPTCHA v2 token.
  WEBTOP_SKIP_TOKEN_VALIDATE — if true, do not call server to verify file webToken (debug only).
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
from datetime import datetime, timedelta

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_env_file():
    """Load `.env` into os.environ (same rules as push_loop.mjs: do not override existing vars)."""
    path = os.path.join(_SCRIPT_DIR, ".env")
    if not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                eq = line.find("=")
                if eq < 0:
                    continue
                key, val = line[:eq].strip(), line[eq + 1 :].strip()
                if val.startswith('"') and val.endswith('"'):
                    val = val[1:-1]
                elif val.startswith("'") and val.endswith("'"):
                    val = val[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = val
    except OSError as e:
        sys.stderr.write(f"[api] Could not read .env: {e}\n")


_load_env_file()

BASE_URL = os.environ.get("WEBTOP_BASE", "https://webtopserver.smartschool.co.il")
USER = os.environ.get("WEBTOP_USER", "")
PASS = os.environ.get("WEBTOP_PASS", "")
DATA_PARAM = os.environ.get("WEBTOP_DATA", "+Aabe7FAdVluG6Lu+0ibrA==")
SESSION_FILE = os.environ.get("WEBTOP_SESSION", os.path.join(_SCRIPT_DIR, ".webtop_session.json"))
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
    """POST to Webtop API, returns parsed JSON response (3 tries on transient network errors)."""
    url = BASE_URL + path
    payload = json.dumps(body).encode("utf-8")
    last_err = None
    for attempt in range(3):
        req = urllib.request.Request(url, data=payload)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        req.add_header("Origin", "https://webtop.smartschool.co.il")
        req.add_header("Referer", "https://webtop.smartschool.co.il/")
        if token:
            req.add_header("Cookie", f"webToken={urllib.parse.quote(token, safe='')}")
        try:
            with _opener.open(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="replace")[:300]
            raise RuntimeError(f"HTTP {e.code} on {path}: {body_text}")
        except Exception as e:
            last_err = e
            if attempt < 2:
                log(f"api_post retry {attempt + 1}/3 {path}: {e}")
                time.sleep(1.5 * (attempt + 1))
            else:
                raise RuntimeError(f"Request failed for {path}: {last_err}") from last_err


def _token_from_cookie_jar():
    """Read webToken set by Set-Cookie on login response (fallback if JSON has no token)."""
    try:
        for paths in _cookie_jar._cookies.values():
            for cookies in paths.values():
                c = cookies.get("webToken")
                if c is not None and getattr(c, "value", None):
                    return urllib.parse.unquote(c.value)
    except Exception:
        pass
    return None


def _deep_find_token(obj, depth=0):
    """Find first string value for keys token/webToken (any casing) in nested dicts."""
    if depth > 8:
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and k.lower() in ("token", "webtoken", "accesstoken") and isinstance(v, str) and len(v) > 24:
                return v.strip()
        for v in obj.values():
            t = _deep_find_token(v, depth + 1)
            if t:
                return t
    elif isinstance(obj, list):
        for x in obj:
            t = _deep_find_token(x, depth + 1)
            if t:
                return t
    return None


def _extract_token_from_login_response(resp):
    """Normalize token from various API response shapes (incl. nested / PascalCase)."""
    if not isinstance(resp, dict):
        return None
    data = resp.get("data")
    nested = None
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            return data.strip() if len(data) > 80 and data.count(".") >= 2 else None
    if isinstance(data, (dict, list)):
        nested = _deep_find_token(data)
    return _deep_find_token(resp) or nested


def validate_web_token(token):
    """
    Lightweight server check: is this webToken still accepted?
    Returns False if server clearly rejects; True if OK or uncertain (e.g. transient network — do not wipe good token).
    """
    if not token:
        return False
    raw = (os.environ.get("WEBTOP_SKIP_TOKEN_VALIDATE") or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        log("Skipping token validation (WEBTOP_SKIP_TOKEN_VALIDATE)")
        return True
    try:
        resp = api_post("/server/api/user/GetMultipleUsersForUser", {}, token=token)
    except RuntimeError as e:
        err = str(e)
        if "HTTP 401" in err or "HTTP 403" in err:
            log("Token validation: HTTP 401/403 — token invalid")
            return False
        log(f"Token validation: network/API error (keeping token): {err[:180]}")
        return True
    except Exception as e:
        log(f"Token validation: unexpected {e!r} (keeping token)")
        return True

    st = resp.get("status")
    if st is False:
        msg = resp.get("message") or resp.get("errorDescription") or resp.get("errorId") or ""
        log(f"Token validation: status=False — {str(msg)[:220]}")
        return False
    if st is True:
        return True
    # Some responses omit status but return data
    if resp.get("data") is not None:
        return True
    log("Token validation: ambiguous response — treating as valid")
    return True


def login_via_api():
    """
    POST LoginByUserNameAndPassword; returns webToken or None on failure.
    Does not open a browser (no reCAPTCHA on this endpoint when credentials are valid).
    """
    if not USER or not PASS:
        return None
    log("Logging in via API (LoginByUserNameAndPassword)...")
    try:
        login_body = {
            "UserName": USER,
            "Password": PASS,
            "Data": DATA_PARAM,
            "RememberMe": False,
            "BiometricLogin": "",
        }
        captcha = (os.environ.get("WEBTOP_RECAPTCHA_RESPONSE") or "").strip()
        if captcha:
            login_body["gRecaptchaResponse"] = captcha
        resp = api_post(
            "/server/api/user/LoginByUserNameAndPassword",
            login_body,
            token=None,
        )
    except Exception as e:
        log(f"API login request failed: {e}")
        return None

    token = _extract_token_from_login_response(resp) or _token_from_cookie_jar()
    if token:
        log("API login OK")
        return token
    srv = resp.get("message") or resp.get("errorDescription") or resp.get("errorId") or ""
    if not (isinstance(srv, str) and srv.strip()) and resp.get("errorHTML"):
        eh = resp.get("errorHTML", "")
        if isinstance(eh, str):
            srv = re.sub(r"<[^>]+>", " ", eh)
            srv = " ".join(srv.split())[:400]
    if not isinstance(srv, str):
        srv = str(srv)
    if len(srv) > 400:
        srv = srv[:400] + "…"
    d = resp.get("data")
    eh = resp.get("errorHTML")
    log(
        "API login: no token — "
        f"status={resp.get('status')!r} server={srv!r} "
        f"data_type={type(d).__name__!r} errorHTML_len={len(str(eh or ''))} keys={list(resp.keys())}"
    )
    return None


def save_token_to_session_file(token):
    """Refresh .webtop_session.json so other tools (audit_api, Playwright) see a current webToken."""
    try:
        payload = {
            "cookies": [
                {
                    "name": "webToken",
                    "value": token,
                    "domain": "webtop.smartschool.co.il",
                    "path": "/",
                    "httpOnly": True,
                    "secure": True,
                }
            ]
        }
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        log(f"Saved webToken to {SESSION_FILE}")
    except OSError as e:
        log(f"Could not write {SESSION_FILE}: {e}")


def _session_fallback_allowed():
    """Default: allow session file after API failure (many portals reject REST login without captcha)."""
    raw = (os.environ.get("WEBTOP_SESSION_FALLBACK") or "").strip().lower()
    if raw in ("false", "0", "no", "off"):
        return False
    return True


def obtain_token():
    """
    Order: (1) API login if credentials; (2) session file only if token still valid on server;
    (3) API login again if file token expired; (4) fail with clear message.
    """
    api_on = os.environ.get("WEBTOP_API_LOGIN", "true").lower() not in ("0", "false", "no")
    allow_file = _session_fallback_allowed()

    if api_on and USER and PASS:
        token = login_via_api()
        if token:
            save_token_to_session_file(token)
            return token
        if not allow_file:
            raise RuntimeError(
                "API login failed — no browser fallback (WEBTOP_USER+WEBTOP_PASS set, "
                "WEBTOP_SESSION_FALLBACK not true). Check stderr for server message; often fix is "
                "WEBTOP_DATA (copy JSON field 'Data' from DevTools → Network on login POST) or password."
            )
        log("API login returned no token; checking .webtop_session.json on server…")

    if allow_file:
        try:
            file_tok = load_token_from_session()
        except Exception as e:
            log(f"No usable session file yet: {e}")
            file_tok = None
        else:
            if validate_web_token(file_tok):
                log("Session file webToken is still valid — using it")
                return file_tok
            log("Session file webToken rejected by server — trying API login again")

        if api_on and USER and PASS:
            token = login_via_api()
            if token:
                save_token_to_session_file(token)
                log("Got new webToken via API after invalid session file")
                return token

        if file_tok is not None:
            raise RuntimeError(
                "Webtop session expired and API login did not return a token. "
                "Log in once in the browser to Webtop, or send /cookie to the bot, "
                "or set WEBTOP_RECAPTCHA_RESPONSE if the school requires CAPTCHA on login."
            )

    raise RuntimeError(
        "Could not authenticate: add WEBTOP_USER/WEBTOP_PASS (+ WEBTOP_DATA) for API login, "
        "or set WEBTOP_SESSION_FALLBACK=true and provide .webtop_session.json (webToken)"
    )


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
        data = resp.get("data") or {}
        if isinstance(data, list):
            return data
        # API returns {allowToViewThis, dataTable: {diciplineEvents: [...]}}
        dt = data.get("dataTable") or {}
        if isinstance(dt, list):
            return dt
        events = dt.get("diciplineEvents") or dt.get("disciplineEvents") or []
        return events if isinstance(events, list) else []
    except Exception as e:
        log(f"GetPupilDiciplineEvents failed: {e}")
        return []


def get_homework_api(token, encrypted_id, class_code, class_number):
    """Get homework assignments (current/future)."""
    try:
        # ClassNumber must be int — API returns 400 if string
        try:
            class_num_int = int(class_number) if class_number else 0
        except (ValueError, TypeError):
            class_num_int = 0
        resp = api_post("/server/api/dashboard/GetHomeWork", {
            "id": encrypted_id,
            "ClassCode": class_code,
            "ClassNumber": class_num_int,
        }, token=token)
        data = resp.get("data") or {}
        if isinstance(data, list):
            return data
        # API returns {allowToViewThis, dataTable: [...]}
        dt = data.get("dataTable") or data.get("homeWork") or []
        return dt if isinstance(dt, list) else []
    except Exception as e:
        log(f"GetHomeWork failed: {e}")
        return []


def get_lessons_and_homework(token, encrypted_id, class_code, student_name, period_id=1052, period_name="מחצית ב", weeks_back=8):
    """Get lessons + homework history via PupilCard/GetPupilLessonsAndHomework.
    Returns list of {date, subject, teacher, homeWork, descClass} for lessons that have homework.
    """
    results = []
    study_year = datetime.now().year
    for week_offset in range(0, -weeks_back - 1, -1):
        try:
            resp = api_post("/server/api/PupilCard/GetPupilLessonsAndHomework", {
                "weekIndex": week_offset,
                "viewType": 0,
                "studyYear": study_year,
                "studyYearName": f"תשפ\u05d4",
                "studentID": encrypted_id,
                "studentName": student_name,
                "classCode": class_code,
                "periodID": period_id,
                "periodName": period_name,
                "moduleID": 11,
            }, token=token)
            days = resp.get("data") or []
            if not isinstance(days, list):
                continue
            for day in days:
                date_iso = day.get("date", "")[:10]  # YYYY-MM-DD
                # Convert to DD/MM/YYYY for consistency with is_recent()
                try:
                    y, m, d = date_iso.split("-")
                    date_fmt = f"{d}/{m}/{y}"
                except Exception:
                    date_fmt = date_iso
                for hour_data in (day.get("hoursData") or []):
                    for sched in (hour_data.get("scheduale") or []):
                        hw_text = (sched.get("homeWork") or "").strip()
                        if hw_text:
                            results.append({
                                "date": date_fmt,
                                "subject": sched.get("subject_name") or "",
                                "teacher": sched.get("teacher") or "",
                                "homeWork": hw_text,
                                "hour": hour_data.get("hour"),
                            })
        except Exception as e:
            log(f"GetPupilLessonsAndHomework week={week_offset} failed: {e}")
    return results


def get_messages(token, max_pages=5):
    """Get inbox messages — API uses 1-based page IDs, 30 per page."""
    all_msgs = []
    try:
        page = 1
        while page <= max_pages:
            resp = api_post("/server/api/messageBox/GetMessagesInbox", {
                "PageId": page,
                "LabelId": 0,
                "HasRead": None,
                "SearchQuery": "",
            }, token=token)
            items = resp.get("data") or []
            if not isinstance(items, list) or not items:
                break
            all_msgs.extend(items)
            total = items[0].get("count", 0) if items else 0
            if len(all_msgs) >= total or len(items) < 30:
                break
            page += 1
        log(f"GetMessagesInbox: {len(all_msgs)} messages fetched ({page} pages)")
    except Exception as e:
        log(f"GetMessagesInbox failed: {e}")
    return all_msgs


# ── Type mapping ──────────────────────────────────────────────────────────────
TYPE_MAP = {
    "absence": "absence",
    "late": "late",
    "חיסור": "absence",
    "איחור": "late",
    "נוכחות": "attendance",
    "attendance": "attendance",
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


def coerce_lesson_number(lesson):
    """Lesson index from API; sometimes a Hebrew label (e.g. 'שפה') instead of a number."""
    if lesson is None:
        return None
    if isinstance(lesson, int):
        return lesson
    s = str(lesson).strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return None


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
        "lesson": coerce_lesson_number(lesson),
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
        "lesson": coerce_lesson_number(lesson),
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
    # API uses student_F_name + student_L_name for the SENDER (teacher name)
    sender_f = (msg.get("student_F_name") or "").strip()
    sender_l = (msg.get("student_L_name") or "").strip()
    sender = f"{sender_f} {sender_l}".strip()
    if not sender:
        sender = (msg.get("senderName") or msg.get("from") or msg.get("sender") or "").strip()
    # hasRead is an integer (0/1), not a boolean isRead
    has_read = msg.get("hasRead") or msg.get("isRead") or msg.get("read") or 0
    return {
        "student": student_short_name,
        "subject": (msg.get("subject") or "(ללא נושא)").strip(),
        "from": sender,
        "fromRole": (msg.get("senderRole") or msg.get("role") or "").strip(),
        "date": date,
        "time": time_str,
        "body": (msg.get("body") or msg.get("content") or msg.get("message") or "")[:500].strip(),
        "read": bool(int(has_read)),
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

        # Homework (current/future from dashboard)
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
        log(f"  homework (dashboard): {len(hw_list)} items")

        # Homework history via PupilCard (lessons + homework per week)
        student_full_name = f"{child_info.get('lastName', '')} {child_info.get('firstName', '')}".strip()
        hw_history = get_lessons_and_homework(tok, enc_id, class_code, student_full_name)
        seen_hw_keys = {f"{h['date']}_{h['subject']}_{h['text'][:30]}" for h in hw_list}
        for hw in hw_history:
            key = f"{hw['date']}_{hw['subject']}_{hw['homeWork'][:30]}"
            if key not in seen_hw_keys:
                seen_hw_keys.add(key)
                hw_list.append({
                    "subject": hw["subject"],
                    "date": hw["date"],
                    "text": hw["homeWork"],
                    "lesson": hw.get("hour"),
                    "teacher": hw.get("teacher", ""),
                    "source": "history",
                })
                # Include homework in notifications if within 60 days (wider window for history)
                if is_recent(hw["date"], days=60):
                    notifs.append({
                        "student": short_name,
                        "type": "homework",
                        "subject": hw["subject"],
                        "date": hw["date"],
                        "lesson": hw.get("hour"),
                        "description": hw["homeWork"],
                        "homeworkText": hw["homeWork"],
                        "alertTime": None,
                        "alertDay": None,
                    })
        log(f"  homework total (incl. history): {len(hw_list)} items")
    else:
        log(f"  WARNING: no encrypted ID for {short_name} — skipping discipline/homework")

    return notifs, hw_list


if __name__ == "__main__":
    # רקע: רענון קובץ סשן / ניסיון לוגין API — בלי משיכת נתונים מלאה (נקרא מ-push_loop בתזמון)
    if os.environ.get("WEBTOP_REFRESH_TOKEN_ONLY") == "1":
        try:
            t = obtain_token()
            save_token_to_session_file(t)
            log("[refresh] Proactive token refresh — session file updated")
            sys.exit(0)
        except Exception as ex:
            log(f"[refresh] Skipped (will retry later): {ex}")
            sys.exit(0)

    try:
        token = obtain_token()

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
        if (
            "401" in err_str
            or "Unauthorized" in err_str
            or "webToken not found" in err_str
            or "Session file not found" in err_str
            or "Could not authenticate" in err_str
            or "API login failed" in err_str
        ):
            out({"ok": False, "error": err_str})
            sys.exit(2)
        out({"ok": False, "error": err_str})
        sys.exit(1)
