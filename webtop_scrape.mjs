/**
 * webtop_scrape.mjs — Webtop SmartSchool scraper
 *
 * Uses a PERSISTENT BROWSER PROFILE (.webtop_profile/) so the site's auth
 * token (sessionStorage/cookies) survives between runs without re-login.
 *
 * FIRST-TIME SETUP (run once, headed browser opens):
 *   WEBTOP_CAPTURE=true node webtop_scrape.mjs
 *   → Browser opens → log in manually → profile saved → browser closes
 *
 * NORMAL RUN (headless, reuses saved profile):
 *   node webtop_scrape.mjs
 *
 * ENV:
 *   WEBTOP_USER        login username (used only if session is invalid)
 *   WEBTOP_PASS        login password (used only if session is invalid)
 *   WEBTOP_CAPTURE     set to "true" to open browser for manual login
 *   WEBTOP_PROFILE     path to browser profile dir (default: .webtop_profile)
 *   WEBTOP_HEADLESS    override headless mode ("false" to watch)
 */

import { chromium } from "playwright";
import { resolve, dirname, join } from "path";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env (same as push_scrape / push_loop) ─────────────────────────────────
function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL      = "https://webtop.smartschool.co.il";
const LOGIN_URL     = `${BASE_URL}/account/login`;
const DASHBOARD_URL = `${BASE_URL}/dashboard`;

const USER         = process.env.WEBTOP_USER;
const PASS         = process.env.WEBTOP_PASS;
const CAPTURE_MODE = process.env.WEBTOP_CAPTURE === "true";
const PROFILE_DIR  = resolve(process.env.WEBTOP_PROFILE || ".webtop_profile");
const HEADLESS     = CAPTURE_MODE ? false : (process.env.WEBTOP_HEADLESS !== "false");
const TIMEOUT      = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function out(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
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

// ── Student switcher helpers ───────────────────────────────────────────────
// Detects all students from the mat-select dropdown in the portal nav.
// Returns an array of student name strings, or null if only one student
// (or if no mat-select is found).
async function getAllStudents(page) {
  const matSelect = page.locator("mat-select").first();
  if ((await matSelect.count()) === 0) return null;

  await matSelect.click();
  await sleep(800);

  // Options are rendered in an overlay appended to body
  const opts = page.locator("mat-option");
  await opts.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  const names = (await opts.allTextContents()).map((t) => t.trim()).filter(Boolean);

  // Close dropdown
  await page.keyboard.press("Escape");
  await sleep(400);

  return names.length > 1 ? names : null;
}

// Switches the portal to show data for a different student.
// Must be called while on the dashboard page.
async function switchToStudent(page, name) {
  if (!page.url().includes("/dashboard")) {
    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await sleep(800);
  }

  const matSelect = page.locator("mat-select").first();
  await matSelect.click();
  await sleep(800);

  // Find matching option — exact text match first, fallback to contains
  const opts = page.locator("mat-option");
  await opts.first().waitFor({ state: "visible", timeout: 5000 });
  const allOpts = await opts.all();
  let clicked = false;
  for (const opt of allOpts) {
    const text = (await opt.textContent() || "").trim();
    if (text === name) {
      await opt.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    // fallback: partial match
    await page.locator("mat-option").filter({ hasText: name }).first().click();
  }

  await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
  await sleep(1000);
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

  // Fill username — Angular Material input (no placeholder attr, use type selector)
  const userInput = page.locator('input[type="text"].mat-input-element').first();
  await userInput.waitFor({ timeout: TIMEOUT });
  await userInput.fill(USER);

  // Fill password — Angular Material password input
  const passInput = page.locator('input[type="password"]').first();
  await passInput.fill(PASS);

  // Wait for the submit button to become enabled (reCAPTCHA must pass first)
  // Try up to 45 seconds for the button to enable
  const submitBtn = page.locator('button[type="submit"]').first();
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
    },
    { timeout: 45000 }
  ).catch(() => {
    // Button still disabled — try clicking anyway (some reCAPTCHA v3 may auto-pass)
    process.stderr.write('Warning: submit button still disabled after 45s, attempting click anyway\n');
  });

  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: TIMEOUT }),
    submitBtn.click(),
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

    // ── Useful links (קיצורי דרך) ──
    const allHeadings = Array.from(document.querySelectorAll(
      "h2, h3, h4, h5, [class*='title'], [class*='header'], [class*='heading'], strong, span"
    ));
    const shortcutArea = allHeadings.find(el => el.textContent.includes("קיצורי דרך"));
    if (shortcutArea) {
      const card = shortcutArea.closest("[class*='card'], [class*='panel'], mat-card, div");
      if (card) {
        result.usefulLinks = Array.from(card.querySelectorAll("a[href]")).map(a => ({
          text: a.textContent.trim().replace(/\s+/g, " ").slice(0, 80),
          href: a.getAttribute("href") || "",
        })).filter(l => l.text.length > 1 && l.text.length < 60);
      }
    }

    // ── Debug: capture all heading texts found on page ──
    result._headingsFound = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, [class*='title'], [class*='header']")
    ).map(el => el.textContent.trim().replace(/\s+/g, " ")).filter(t => t.length < 100);

    return result;
  });
}

// ── School events (יומן פגישות) — פורים, אסיפות הורים וכו' ─────────────────
async function extractSchoolEvents(page) {
  const events = [];
  try {
    await page.goto(`${BASE_URL}/mettingsScheduale`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await sleep(1200);
    const items = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("[class*='card'], [class*='event'], [class*='title']"));
      const found = [];
      for (const c of cards) {
        const title = c.querySelector("h2, h3, h4, [class*='title']");
        const text = (title?.textContent || c.textContent).trim().replace(/\s+/g, " ");
        if (text.length > 2 && text.length < 150 && !/^\d+$/.test(text)) {
          if (/פורים|פגישה|אירוע|אסיפת|טיול|חג/.test(text)) found.push(text);
        }
      }
      const headings = Array.from(document.querySelectorAll("h2, h3, h4")).map(h => h.textContent.trim());
      for (const h of headings) {
        if (h.length > 2 && /פורים|פגישה|אירוע|אסיפת|טיול|חג/.test(h)) found.push(h);
      }
      return [...new Set(found)];
    });
    for (const t of items) {
      if (t && t.length > 3) events.push({ name: t, type: "event" });
    }
  } catch (e) {
    if (process.env.WEBTOP_DEBUG === "1") process.stderr.write(`[debug] extractSchoolEvents: ${e.message}\n`);
  }
  return events;
}

// ── Signoffs (חתימות ואישורים) ────────────────────────────────────────────
async function extractSignoffs(page) {
  const signoffs = [];
  try {
    await page.goto(`${BASE_URL}/signMessaes`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await sleep(1000);
    const items = await page.evaluate(() => {
      const rows = document.querySelectorAll("tr, [class*='row'], mat-row, [class*='item']");
      const found = [];
      for (const r of rows) {
        const text = r.textContent.trim().replace(/\s+/g, " ");
        if (text.length > 30 && /אישור|חתימה|טיול|יציאה/.test(text)) found.push(text);
      }
      return found;
    });
    for (const t of items) {
      if (t && t.length > 30 && !/בחר\/י הודעה|אפשרויות|סינון/.test(t)) signoffs.push({ details: t });
    }
  } catch (e) {
    if (process.env.WEBTOP_DEBUG === "1") process.stderr.write(`[debug] extractSignoffs: ${e.message}\n`);
  }
  return signoffs;
}

// ── Notifications page ────────────────────────────────────────────────────────
async function extractNotifications(page) {
  try {
    // Click "התראות" in sidebar — try multiple selectors (portal may have changed)
    let notifLink = page.getByRole("link", { name: /התראות/ }).first();
    if (!(await notifLink.isVisible({ timeout: 3000 }).catch(() => false))) {
      notifLink = page.locator("a:has-text('התראות')").first();
    }
    if (!(await notifLink.isVisible({ timeout: 2000 }).catch(() => false))) {
      if (process.env.WEBTOP_DEBUG === "1") process.stderr.write("[debug] 'התראות' link not found\n");
      return [];
    }
    await notifLink.click();
    await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
    await sleep(800);

    const items = await page.evaluate(() => {
      const sel = "tr, [class*='notification'], [class*='alert'], [class*='row'], [class*='item'], li, mat-row";
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.map(el => el.textContent.trim().replace(/\s+/g, " ")).filter(t => t.length > 20);
    });
    return items;
  } catch (e) {
    if (process.env.WEBTOP_DEBUG === "1") process.stderr.write(`[debug] extractNotifications error: ${e.message}\n`);
    return [];
  }
}

// ── Messages page (הודעות) ───────────────────────────────────────────────────
async function extractMessages(page) {
  const messages = [];
  try {
    let msgLink = page.getByRole("link", { name: /הודעות/ }).first();
    if (!(await msgLink.isVisible({ timeout: 2000 }).catch(() => false))) {
      msgLink = page.locator("a:has-text('הודעות')").first();
    }
    if (!(await msgLink.isVisible({ timeout: 2000 }).catch(() => false))) {
      try {
        await page.goto(`${BASE_URL}/messages`, { waitUntil: "domcontentloaded", timeout: 8000 });
      } catch {
        return [];
      }
    } else {
      await msgLink.click();
      await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
    }
    await sleep(600);

    const rows = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll("tr, [class*='message'], [class*='mail'], mat-row, .mat-mdc-row");
      for (const row of rows) {
        const text = row.textContent.trim().replace(/\s+/g, " ");
        if (text.length < 30) continue;
        const cells = row.querySelectorAll("td, [class*='cell']");
        let from = "", subject = "", date = "", body = "", read = false;
        if (cells.length >= 2) {
          from = cells[0]?.textContent.trim() || "";
          subject = cells[1]?.textContent.trim() || "";
          if (cells.length >= 3) date = cells[2]?.textContent.trim() || "";
          if (cells.length >= 4) body = cells[3]?.textContent.trim() || "";
        } else {
          const noRead = row.querySelector("[class*='unread'], [class*='bold'], .msg-unread");
          read = !noRead;
          subject = text.slice(0, 80);
        }
        if (subject || from) items.push({ from, subject, date, body, read });
      }
      return items;
    });

    let childrenByGrade = {};
    try {
      if (existsSync(join(__dirname, "children_config.json"))) {
        const cc = JSON.parse(readFileSync(join(__dirname, "children_config.json"), "utf8"));
        for (const c of cc.children || []) {
          if (c.name && c.grade) childrenByGrade[c.grade] = c.name;
        }
      }
    } catch {}

    for (const r of rows) {
      const [datePart, timePart] = (r.date || "").split(/\s+/);
      let student = null;
      const combined = `${r.subject || ""} ${r.body || ""}`;
      if (/שכבת\s*ג['\u05f3]?|כיתה\s*ג|כיתת\s*ג/.test(combined) && childrenByGrade["ג"]) student = childrenByGrade["ג"];
      else if (/שכבת\s*ב['\u05f3]?|כיתה\s*ב|כיתת\s*ב/.test(combined) && childrenByGrade["ב"]) student = childrenByGrade["ב"];
      messages.push({
        from: r.from || "",
        subject: r.subject || "(ללא נושא)",
        date: datePart || null,
        time: timePart || null,
        body: (r.body || "").slice(0, 500),
        read: !!r.read,
        ...(student ? { student } : {}),
      });
    }
  } catch (e) {
    if (process.env.WEBTOP_DEBUG === "1") process.stderr.write(`[debug] extractMessages error: ${e.message}\n`);
  }
  return messages;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  // ── Persistent browser profile ────────────────────────────────────────────
  // launchPersistentContext stores ALL browser state (cookies, localStorage,
  // sessionStorage, IndexedDB) in PROFILE_DIR across runs — so the site's JWT
  // auth token is preserved and reCAPTCHA trust builds up over time.
  // First-time setup: run with WEBTOP_CAPTURE=true once to log in manually.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
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
      await context.close();
      process.exit(1);
    }
    await doLogin(page);
  }

  if (CAPTURE_MODE) {
    out({ ok: true, message: "Profile saved to " + PROFILE_DIR + ". Run without WEBTOP_CAPTURE to scrape data." });
    await context.close();
    return;
  }

  // ── Navigate back to dashboard if needed ──────────────────────────────────
  if (!page.url().includes("/dashboard")) {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
    await sleep(800);
  }

  // ── Detect all available students from portal switcher ────────────────────
  let studentList = await getAllStudents(page).catch((e) => {
    process.stderr.write(`[warn] Student detection failed: ${e.message}\n`);
    return null;
  });

  // Fallback: use children_config when portal dropdown not found (2+ children)
  if ((!studentList || studentList.length < 2) && existsSync(join(__dirname, "children_config.json"))) {
    try {
      const cc = JSON.parse(readFileSync(join(__dirname, "children_config.json"), "utf8"));
      const names = (cc.children || []).map((c) => c.name).filter(Boolean);
      if (names.length > 1) {
        studentList = names;
        process.stderr.write(`[info] Using children_config: ${names.join(", ")}\n`);
      }
    } catch {}
  }

  const classEventsByStudent = {};
  let   allNotifications     = [];
  let   mainDashboard        = null;

  // ── Multi-student extraction loop ─────────────────────────────────────────
  const loopStudents = (studentList && studentList.length > 1) ? studentList : [null];

  for (let i = 0; i < loopStudents.length; i++) {
    const studentName = loopStudents[i];

    // Switch portal to this student (skip for single-student accounts)
    if (studentName !== null) {
      await switchToStudent(page, studentName);
    }

    // Extract dashboard card data (classEvents, homework, grades, …)
    const dashboard = await extractDashboard(page);
    if (!mainDashboard) mainDashboard = dashboard;

    // Store class events keyed by student name
    if (studentName !== null) {
      classEventsByStudent[studentName] = dashboard.classEvents || [];
    }

    // Extract notifications for this student (navigates to /התראות)
    const rawNotifs = await extractNotifications(page);
    const notifs = rawNotifs
      .map((raw) => ({ parsed: parseNotification(raw), raw }))
      .filter(({ parsed, raw }) => isRealNotification(parsed, raw))
      .map(({ parsed }) => parsed);

    if (process.env.WEBTOP_DEBUG === "1") {
      process.stderr.write(`[debug] Student: ${studentName || "(single)"} | raw items: ${rawNotifs.length} | passed: ${notifs.length}\n`);
      if (rawNotifs.length > 0 && notifs.length === 0) {
        const sample = rawNotifs[0].slice(0, 150);
        process.stderr.write(`[debug] Sample raw: "${sample}..."\n`);
      }
    }

    allNotifications.push(...notifs);

    // Return to dashboard before switching to next student
    if (studentName !== null && i < loopStudents.length - 1) {
      await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
      await sleep(800);
    }
  }

  // ── Single-student fallback: map classEvents to detected student name ──────
  if (!studentList || studentList.length <= 1) {
    mainDashboard = mainDashboard || {};
    const uniqueNames = [...new Set(allNotifications.map((n) => n.student).filter(Boolean))];
    for (const name of uniqueNames) {
      if (!classEventsByStudent[name]) {
        classEventsByStudent[name] = mainDashboard.classEvents || [];
      }
    }
  }

  // ── Extract messages (הודעות) — once per account ───────────────────────────
  const messages = await extractMessages(page).catch(() => []);

  // ── Extract school events, signoffs, useful links ───────────────────────────
  const schoolEvents  = await extractSchoolEvents(page).catch(() => []);
  const signoffs      = await extractSignoffs(page).catch(() => []);
  const usefulLinks   = mainDashboard?.usefulLinks || [];

  await context.close();

  out({
    ok: true,
    extractedAt: new Date().toISOString(),
    url: DASHBOARD_URL,
    data: {
      studentName:          mainDashboard?.studentName || "",
      classEvents:          mainDashboard?.classEvents || [],   // backward compat (first student)
      classEventsByStudent,                                      // NEW: per-student class events
      homework:             mainDashboard?.homework    || [],
      grades:               mainDashboard?.grades      || [],
      tables:               mainDashboard?.tables      || [],
      notifications:        allNotifications,
      messages:             messages,
      schoolEvents:         schoolEvents,
      signoffs:             signoffs,
      usefulLinks:          usefulLinks,
      _debug: {
        headingsFound:  mainDashboard?._headingsFound || [],
        studentsFound:  studentList || [],
      },
    },
    count: (mainDashboard?.classEvents?.length || 0) +
           (mainDashboard?.homework?.length    || 0) +
           (allNotifications?.length           || 0),
  });

})().catch((e) => {
  out({ ok: false, error: String(e), stack: e.stack });
  process.exit(1);
});
