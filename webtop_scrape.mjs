/**
 * webtop_scrape.mjs — Webtop SmartSchool scraper
 *
 * MODES:
 *   Normal run (headless, uses saved session):
 *     WEBTOP_USER=xxx WEBTOP_PASS=yyy node webtop_scrape.mjs
 *
 *   First-time session capture (headed, you solve reCAPTCHA manually):
 *     WEBTOP_CAPTURE=true node webtop_scrape.mjs
 *
 * ENV:
 *   WEBTOP_USER        login username
 *   WEBTOP_PASS        login password
 *   WEBTOP_CAPTURE     set to "true" to open browser for manual CAPTCHA solve
 *   WEBTOP_SESSION     path to session file (default: .webtop_session.json)
 *   WEBTOP_HEADLESS    override headless mode ("false" to watch)
 */

import { chromium } from "playwright";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { resolve } from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL      = "https://webtop.smartschool.co.il";
const LOGIN_URL     = `${BASE_URL}/account/login`;
const DASHBOARD_URL = `${BASE_URL}/dashboard`;

const USER         = process.env.WEBTOP_USER;
const PASS         = process.env.WEBTOP_PASS;
const CAPTURE_MODE = process.env.WEBTOP_CAPTURE === "true";
const SESSION_FILE = resolve(process.env.WEBTOP_SESSION || ".webtop_session.json");
const HEADLESS     = CAPTURE_MODE ? false : (process.env.WEBTOP_HEADLESS !== "false");
const TIMEOUT      = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function out(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, "utf8")); }
  catch { return null; }
}

function saveSession(state) {
  writeFileSync(SESSION_FILE, JSON.stringify(state), "utf8");
}

// ── Notification parser ────────────────────────────────────────────────────────
// Parses raw Hebrew notification strings into structured objects.
// Example input:
//   "אמי, נרשם לך חוסר ציוד לימודי במתמטיקה בתאריך 26/02/2026 בשיעור 3 מועד ההתראה: יום חמישי, 26/02/2026 (12:08)אירועי שיעור"
function parseNotification(raw) {
  const text = raw.trim().replace(/\s+/g, " ");

  // Student name: before the first ", "
  const commaIdx = text.indexOf(", ");
  const student = commaIdx > 0 ? text.substring(0, commaIdx).trim() : "";

  // Date: בתאריך DD/MM/YYYY
  const dateMatch = text.match(/בתאריך\s+(\d{2}\/\d{2}\/\d{4})/);
  const date = dateMatch ? dateMatch[1] : null;

  // Lesson number: בשיעור N (last occurrence to avoid homework "בשיעור subject" confusion)
  const lessonMatches = [...text.matchAll(/בשיעור\s+(\d+)/g)];
  const lesson = lessonMatches.length > 0
    ? parseInt(lessonMatches[lessonMatches.length - 1][1], 10)
    : null;

  // Alert time: (HH:MM) inside מועד ההתראה
  const alertTimeMatch = text.match(/מועד ההתראה[^(]*\((\d{2}:\d{2})\)/);
  const alertTime = alertTimeMatch ? alertTimeMatch[1] : null;

  // Alert full day + date
  const alertDayMatch = text.match(/מועד ההתראה:\s*([^(]+)/);
  const alertDay = alertDayMatch ? alertDayMatch[1].trim() : null;

  // Category: appears after the closing parenthesis of alert time, at end of string
  // e.g., ")אירועי שיעור" or ")נושאי שיעור ושיעורי-בית"
  const categoryMatch = text.match(/\([\d:]+\)(.+)$/);
  const category = categoryMatch ? categoryMatch[1].trim() : null;

  // Subject: dynamically extract from context
  // Strategy A (homework): text after literal "בשיעור " and before "בתאריך"
  //   e.g., "בשיעור מתמטיקה בתאריך" → "מתמטיקה"
  // Strategy B (events): last ב-prefixed word group before "בתאריך"
  //   e.g., "במתמטיקה בתאריך" → "מתמטיקה"
  //   e.g., "בחינוך גופני בתאריך" → "חינוך גופני"
  let subject = null;
  const textBeforeDate = text.replace(/\s*בתאריך.*$/, "");

  // Strategy A: explicit "בשיעור <subject>" (homework-style notifications)
  const hwSubjectMatch = textBeforeDate.match(/בשיעור\s+(.+)$/);
  if (hwSubjectMatch) {
    const s = hwSubjectMatch[1].trim();
    if (s && !/^\d/.test(s)) subject = s;  // skip if it starts with a digit
  }

  // Strategy B: last ב-prefixed word (plus optional following non-ב word) at end
  if (!subject) {
    const evSubjectMatch = textBeforeDate.match(/ב(\S+)(?:\s+([^\s,ב]\S*))?\s*$/);
    if (evSubjectMatch) {
      subject = evSubjectMatch[1];
      if (evSubjectMatch[2]) subject += " " + evSubjectMatch[2];
    }
  }

  // Description: main content — between student comma and "מועד ההתראה"
  const alertStart = text.indexOf("מועד ההתראה");
  const descStart = commaIdx >= 0 ? commaIdx + 2 : 0;
  const descEnd   = alertStart > 0 ? alertStart : text.length;
  const description = text.substring(descStart, descEnd).trim();

  // Homework text: extract quoted content from homework notifications
  // e.g., שיעורי-בית "לסיים עבודת כיתה" → "לסיים עבודת כיתה"
  const hwTextMatch = description.match(/שיעורי-?בית\s+"([^"]+)"/);
  const homeworkText = hwTextMatch ? hwTextMatch[1].trim() : null;

  // Detect notification type from description content
  let type = "general";
  if (text.includes("אי הכנת שיעורי בית")) type = "homework_not_done";
  else if (text.includes("חוסר ציוד")) type = "missing_equipment";
  else if (text.includes("שיעורי-בית") || text.includes("שיעורי בית")) type = "homework";
  else if (text.includes("חיסור")) type = "absence";
  else if (text.includes("היעדרות") || text.includes("נעדר")) type = "absence";
  else if (text.includes("איחור")) type = "late";
  else if (text.includes("ציון")) type = "grade";

  return {
    student,
    type,
    subject,
    date,
    lesson,
    ...(homeworkText ? { homeworkText } : {}),
    description,
    alertTime,
    alertDay,
    category,
  };
}

// Filter to keep only real individual notification rows
// (skip nav/header elements and concatenated page blobs)
function isRealNotification(n, raw) {
  return (
    n.student &&
    n.student.length <= 25 &&   // real student names are short
    raw.length < 600 &&          // individual rows are short; blobs are huge
    n.date !== null              // real notifications always have a date
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin(page) {
  if (CAPTURE_MODE) {
    // ── CAPTURE MODE: fully manual ───────────────────────────────────────
    // Just navigate to login page and wait up to 10 minutes for the user
    // to complete everything (fill form, solve CAPTCHA, click כניסה).
    process.stderr.write(
      "\n>>> CAPTCHA MODE: Log in manually in the browser.\n" +
      "    Fill username, password, solve CAPTCHA, click כניסה.\n" +
      "    Waiting up to 10 minutes...\n\n"
    );
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await page.waitForURL(/dashboard/, { timeout: 600_000 }); // 10 minutes
    return;
  }

  // ── HEADLESS MODE: auto-fill and submit ──────────────────────────────────
  if (!USER || !PASS) throw new Error("WEBTOP_USER / WEBTOP_PASS not set");

  await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
  await sleep(1000);

  // Fill username — placeholder "שם משתמש *"
  const userInput = page.getByPlaceholder(/שם משתמש/);
  await userInput.waitFor({ timeout: TIMEOUT });
  await userInput.fill(USER);

  // Fill password — placeholder "סיסמה *"
  const passInput = page.getByPlaceholder(/סיסמה/);
  await passInput.fill(PASS);

  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: TIMEOUT }),
    page.getByRole("button", { name: /כניסה/ }).click(),
  ]);
}

// ── Dashboard extraction ──────────────────────────────────────────────────────
async function extractDashboard(page) {
  await page.waitForLoadState("networkidle", { timeout: TIMEOUT });

  return await page.evaluate(() => {
    const result = {};

    // ── Generic card extractor ──────────────────────────────────────────────
    // Strategy: find heading → walk up past immediate wrappers → get sibling
    // rows or child rows that are NOT the heading itself.
    function extractCard(titleText) {
      // Find the heading element that contains the title text
      const allElements = Array.from(document.querySelectorAll(
        "h2, h3, h4, h5, [class*='title'], [class*='header'], [class*='heading'], strong, span"
      ));
      const heading = allElements.find(el =>
        el.textContent.trim().includes(titleText) &&
        el.textContent.trim().length < titleText.length + 30  // avoid matching too-large containers
      );
      if (!heading) return [];

      // Try walking up to find a proper card container (not just an immediate wrapper)
      // Look for a container that has >1 child elements (i.e., heading + content)
      let card = heading.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!card) break;
        const children = Array.from(card.children);
        // If the card has more than 1 meaningful child, it's likely the card container
        if (children.length > 1 || card.querySelectorAll("tr, li, [class*='row'], [class*='item']").length > 0) {
          break;
        }
        card = card.parentElement;
      }
      if (!card) return [];

      // Extract rows from within the card, excluding the heading text itself
      const headingText = heading.textContent.trim();
      const rows = Array.from(card.querySelectorAll("tr, li, [class*='row'], [class*='item'], [class*='entry']"));

      if (rows.length > 0) {
        return rows
          .map(r => r.textContent.trim().replace(/\s+/g, " "))
          .filter(t => t && t !== headingText && t.length > 2);
      }

      // Fallback: get all text nodes in card, skip the heading text
      const allText = card.textContent.trim().replace(/\s+/g, " ");
      if (allText === headingText) return [];
      return [allText.replace(headingText, "").trim()].filter(Boolean);
    }

    // ── Events in class (אירועים בשיעור) ──
    result.classEvents = extractCard("אירועים בשיעור");

    // ── Homework (נושאי שיעור ושיעורי בית) ──
    result.homework = extractCard("נושאי שיעור");

    // ── Grades (ציונים שוטפים) ──
    result.grades = extractCard("ציונים שוטפים");

    // ── Full table rows (catch-all for any table on page) ──
    const tables = Array.from(document.querySelectorAll("table"));
    result.tables = tables.map(table => {
      const headers = Array.from(table.querySelectorAll("th")).map(th => th.textContent.trim());
      const rows = Array.from(table.querySelectorAll("tbody tr")).map(tr =>
        Array.from(tr.querySelectorAll("td")).map(td => td.textContent.trim())
      );
      return { headers, rows };
    });

    // ── Student name: try multiple selectors ──
    const nameSelectors = [
      "[class*='student-name']",
      "[class*='studentName']",
      "[class*='student_name']",
      "[class*='user-name']",
      "[class*='userName']",
      "[class*='greeting']",
      "[class*='welcome']",
      "header [class*='name']",
      "nav [class*='name']",
      ".navbar [class*='name']",
    ];
    let studentName = "";
    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 0) {
        studentName = el.textContent.trim();
        break;
      }
    }
    result.studentName = studentName;

    // ── Debug: capture all heading texts found on page ──
    result._headingsFound = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, [class*='title'], [class*='header']")
    ).map(el => el.textContent.trim().replace(/\s+/g, " ")).filter(t => t.length < 100);

    return result;
  });
}

// ── Notifications page ────────────────────────────────────────────────────────
async function extractNotifications(page) {
  try {
    // Click "התראות" in sidebar
    const notifLink = page.getByRole("link", { name: /התראות/ }).first();
    if (await notifLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await notifLink.click();
      await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
      await sleep(500);

      return await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll(
          "tr, [class*='notification'], [class*='alert'], [class*='row'], li"
        ));
        return items.map(el => el.textContent.trim().replace(/\s+/g, " ")).filter(Boolean);
      });
    }
  } catch {}
  return [];
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const savedSession = loadSession();

  const context = await browser.newContext({
    storageState: savedSession ?? undefined,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  });

  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // ── Try to go directly to dashboard ───────────────────────────────────────
  await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await sleep(1000);

  // ── Check if we're logged in (redirected to login = not logged in) ─────────
  const currentUrl = page.url();
  const needsLogin = currentUrl.includes("/account/login") || currentUrl.includes("/login");

  if (needsLogin) {
    if (!CAPTURE_MODE && !USER) {
      out({ ok: false, error: "Not logged in and no credentials. Run with WEBTOP_CAPTURE=true first." });
      await browser.close();
      process.exit(1);
    }
    await doLogin(page);
  }

  // ── Save session after login ───────────────────────────────────────────────
  const sessionState = await context.storageState();
  saveSession(sessionState);

  if (CAPTURE_MODE) {
    out({ ok: true, message: "Session saved. Run without WEBTOP_CAPTURE to scrape data." });
    await browser.close();
    return;
  }

  // ── Navigate back to dashboard if needed ──────────────────────────────────
  if (!page.url().includes("/dashboard")) {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
  }

  // ── Extract dashboard data ─────────────────────────────────────────────────
  const dashboard = await extractDashboard(page);

  // ── Extract notifications ──────────────────────────────────────────────────
  const rawNotifications = await extractNotifications(page);

  // Parse and filter notifications into structured objects
  const notifications = rawNotifications
    .map(raw => ({ parsed: parseNotification(raw), raw }))
    .filter(({ parsed, raw }) => isRealNotification(parsed, raw))
    .map(({ parsed }) => parsed);

  await browser.close();

  out({
    ok: true,
    extractedAt: new Date().toISOString(),
    url: DASHBOARD_URL,
    data: {
      studentName: dashboard.studentName,
      classEvents: dashboard.classEvents,
      homework: dashboard.homework,
      grades: dashboard.grades,
      tables: dashboard.tables,
      notifications,
      _debug: {
        headingsFound: dashboard._headingsFound,
      },
    },
    count: (dashboard.classEvents?.length || 0) +
           (dashboard.homework?.length || 0) +
           (notifications?.length || 0),
  });

})().catch((e) => {
  out({ ok: false, error: String(e), stack: e.stack });
  process.exit(1);
});
