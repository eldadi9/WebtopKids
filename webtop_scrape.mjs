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
// SILENT BY DEFAULT: run headless so the browser doesn't pop up and interfere with work.
// Browser only appears when session expired and manual login is needed (reCAPTCHA).
// WEBTOP_HEADLESS=false forces visible browser for every run (for debugging).
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
  else if (text.includes("מילה טובה")) type = "good_word";

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

// Only keep notifications within the last 21 days (3 weeks) or in the future.
const NEW_NOTIF_DAYS = 21;
function isNewNotification(n) {
  if (!n?.date) return false;
  const [dd, mm, yyyy] = String(n.date).split("/").map(Number);
  if (!dd || !mm || !yyyy) return false;
  const notifDate = new Date(yyyy, mm - 1, dd);
  notifDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - NEW_NOTIF_DAYS);
  return notifDate >= cutoff;
}

// ── Student switcher helpers ───────────────────────────────────────────────
// Known non-student option texts (language selector etc.)
const NON_STUDENT_OPTS = /עברית|English|عربيه|Русский|Pусский|ናይ|ትግርኛ|Українська|forgot|שכחתי/i;

// Reads the currently selected student name from the mat-select dropdown.
// Returns the selected text, or null if not found.
async function getCurrentStudent(page) {
  try {
    const selects = await page.locator("mat-select").all();
    for (const matSelect of selects) {
      const text = (await matSelect.textContent() || "").trim().replace(/\s+/g, " ");
      if (text && !NON_STUDENT_OPTS.test(text) && text.length > 2 && text.length < 40) {
        return text;
      }
    }
  } catch {}
  return null;
}

// Detects all students from the mat-select dropdown in the portal nav.
// Returns an array of student name strings, or null if only one student
// (or if no mat-select is found). Skips language selectors.
async function getAllStudents(page) {
  const selects = await page.locator("mat-select").all();
  for (const matSelect of selects) {
    await matSelect.click();
    await sleep(800);
    const opts = page.locator(".mat-mdc-select-panel mat-option, mat-option");
    const ok = await opts.first().waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
    if (ok) {
      const names = (await opts.allTextContents()).map((t) => t.trim()).filter(Boolean);
      await page.keyboard.press("Escape");
      await sleep(400);
      const looksLikeStudents = names.length >= 1 && names.every(n => !NON_STUDENT_OPTS.test(n));
      if (looksLikeStudents && names.length > 1) return names;
    } else {
      await page.keyboard.press("Escape");
    }
  }
  return null;
}

// Switches the portal to show data for a different student.
// Returns true if switch succeeded, false if not.
async function switchToStudent(page, name) {
  // Always start from dashboard for the switch
  if (!page.url().includes("/dashboard")) {
    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await sleep(1500);
  }

  // Check if already on the right student
  const current = await getCurrentStudent(page);
  if (current && (current === name || current.includes(name) || name.includes(current))) {
    process.stderr.write(`[info] Already on student "${current}" — no switch needed\n`);
    return true;
  }

  const selects = await page.locator("mat-select").all();
  for (const matSelect of selects) {
    // Read the current value to identify this is the student selector (not language)
    const selectText = (await matSelect.textContent() || "").trim();
    if (NON_STUDENT_OPTS.test(selectText)) continue; // skip language selectors

    await matSelect.click();
    await sleep(1200);
    const opts = page.locator(".mat-mdc-select-panel mat-option, mat-option");
    const ok = await opts.first().waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
    if (!ok) {
      await page.keyboard.press("Escape");
      await sleep(400);
      continue;
    }
    const allOpts = await opts.all();
    let clicked = false;
    for (const opt of allOpts) {
      const text = (await opt.textContent() || "").trim().replace(/\s+/g, " ");
      if (NON_STUDENT_OPTS.test(text)) continue;
      if (text === name || text.includes(name) || name.includes(text)) {
        await opt.click();
        clicked = true;
        process.stderr.write(`[info] Clicked student option: "${text}"\n`);
        break;
      }
    }
    if (clicked) {
      await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
      await sleep(2000);

      // Verify the switch actually took effect
      const afterSwitch = await getCurrentStudent(page);
      if (afterSwitch && (afterSwitch.includes(name) || name.includes(afterSwitch))) {
        process.stderr.write(`[info] Switch verified — now on "${afterSwitch}"\n`);
        return true;
      }
      process.stderr.write(`[warn] Switch may have failed — expected "${name}", got "${afterSwitch}"\n`);

      // Retry: reload dashboard and check again
      await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
      await sleep(1500);
      const afterReload = await getCurrentStudent(page);
      if (afterReload && (afterReload.includes(name) || name.includes(afterReload))) {
        process.stderr.write(`[info] Switch confirmed after reload — now on "${afterReload}"\n`);
        return true;
      }
      process.stderr.write(`[warn] Switch failed after retry — still on "${afterReload}"\n`);
      return false;
    }
    await page.keyboard.press("Escape");
    await sleep(400);
  }

  process.stderr.write(`[warn] Could not find student "${name}" in any dropdown\n`);
  return false;
}

// ── Manual login (browser visible — for reCAPTCHA) ────────────────────────────
// Used when session expired and we need the user to solve CAPTCHA.
async function doManualLogin(page) {
  process.stderr.write(
    "\n>>> Session expired. Browser opened for manual login.\n" +
    "    Fill username, password, solve CAPTCHA if shown, click כניסה.\n" +
    "    Waiting up to 10 minutes...\n\n"
  );
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await page.waitForURL(/dashboard/, { timeout: 600_000 }); // 10 minutes
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function doLogin(page, isHeaded = false) {
  if (CAPTURE_MODE || isHeaded) {
    // Manual login required — reCAPTCHA blocks auto-fill in headless
    return doManualLogin(page);
  }

  // ── HEADLESS + credentials: try auto-fill (may fail if reCAPTCHA) ───────────
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

  submitBtn.click();
  await page.waitForURL(/dashboard/, { timeout: 60000 });
}

// ── Dashboard extraction ──────────────────────────────────────────────────────
async function extractDashboard(page) {
  await page.waitForLoadState("networkidle", { timeout: TIMEOUT });

  return await page.evaluate(() => {
    const result = {};

    // ── Generic card extractor ──────────────────────────────────────────────
    // Strategy: find heading → walk up past immediate wrappers → get sibling
    // rows or child rows that are NOT the heading itself.
    // Walk an element's descendant text nodes and join with spaces at element
    // boundaries so "חיסור" + "יום" → "חיסור יום" instead of "חיסוריום".
    function spacedText(el) {
      const parts = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walk.nextNode())) {
        const t = node.textContent.trim();
        if (t) parts.push(t);
      }
      return parts.join(" ").replace(/\s+/g, " ").trim();
    }

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
          .map(r => spacedText(r))
          .filter(t => t && t !== headingText && t.length > 2);
      }

      // Fallback: get all text nodes in card, skip the heading text
      const allText = spacedText(card);
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

    // ── Useful links: קיצורי דרך + כרטיסים + תפריט צד + כל קישור רלוונטי ──
    let usefulLinks = [];
    const allHeadings = Array.from(document.querySelectorAll(
      "h2, h3, h4, h5, [class*='title'], [class*='header'], [class*='heading'], strong, span"
    ));
    const shortcutArea = allHeadings.find(el => el.textContent.includes("קיצורי דרך"));
    if (shortcutArea) {
      const card = shortcutArea.closest("[class*='card'], [class*='panel'], mat-card, div");
      if (card) {
        usefulLinks = Array.from(card.querySelectorAll("a[href]")).map(a => ({
          text: a.textContent.trim().replace(/\s+/g, " ").slice(0, 80),
          href: a.getAttribute("href") || "",
        })).filter(l => l.text.length > 1 && l.text.length < 60);
      }
    }
    // קישורים מכרטיסי תוכן (ציונים, שיעורי בית וכו') — לא רק קיצורי דרך
    const contentCards = document.querySelectorAll("[class*='card'] a[href], mat-card a[href], [class*='panel'] a[href]");
    for (const a of contentCards) {
      const text = (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
      let href = (a.getAttribute("href") || "").trim();
      if (text.length >= 2 && text.length < 70 && href && !/^\s*#/.test(href)) {
        if (!href.startsWith("http")) href = href.startsWith("/") ? href : "/" + href;
        usefulLinks.push({ text, href });
      }
    }

    // ── Sidebar + כל קישור רלוונטי (תפריט צד, אתרים חיצוניים) ──
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href], mat-nav-list a, nav a, [role='navigation'] a, mat-sidenav a, .sidenav a")) {
      const text = (a.textContent || "").trim().replace(/\s+/g, " ");
      let href = (a.getAttribute("href") || "").trim();
      if (!href || text.length < 2 || text.length > 70) continue;
      if (/תפריט ראשי|הגדרות|יציאה|^\d+$/.test(text)) continue;
      const key = text + "|" + href;
      if (seen.has(key)) continue;
      seen.add(key);
      if (href.startsWith("/")) href = href;
      else if (!href.startsWith("http")) href = "/" + href;
      usefulLinks.push({ text, href });
    }
    result.usefulLinks = usefulLinks;

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

// ── External sites links (אתרים מותאמים) — קישורים חיצוניים מהדף ─────────
async function extractExternalSitesLinks(page) {
  const links = [];
  try {
    await page.goto(`${BASE_URL}/externalSites`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await sleep(1200);
    const items = await page.evaluate(() => {
      const found = [];
      const seen = new Set();
      for (const a of document.querySelectorAll("a[href]")) {
        let href = (a.getAttribute("href") || "").trim();
        const text = (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
        if (!href || text.length < 2 || text.length > 70) continue;
        if (/תפריט|הגדרות|יציאה|^\d+$/.test(text)) continue;
        const key = text + "|" + href;
        if (seen.has(key)) continue;
        seen.add(key);
        if (href.startsWith("/")) href = href;
        else if (!href.startsWith("http")) href = "/" + href;
        found.push({ text, href });
      }
      return found;
    });
    for (const l of items) {
      if (l.text && l.href) links.push(l);
    }
  } catch (e) {
    if (process.env.WEBTOP_DEBUG === "1") process.stderr.write(`[debug] extractExternalSitesLinks: ${e.message}\n`);
  }
  return links;
}

// ── Signoffs (חתימות ואישורים) — full structured data from signMessaes ────
// Navigate via dashboard (click link) to avoid /error "access denied" on direct URL
async function extractSignoffs(page) {
  const signoffs = [];
  const approvals = [];  // structured: msgId, url, title, sender, date, status, itinerary, requiredEquipment
  try {
    // סעיף 2: גישה דרך Dashboard במקום ישיר — מקטין סיכון ל-/error
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await sleep(1200);

    const signLink = page.locator("a:has-text('חתימות ואישורים'), a[href*='signMessaes']").first();
    if (await signLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await signLink.click();
      await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
      await sleep(1500);
    } else {
      await page.goto(`${BASE_URL}/signMessaes`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
      await sleep(1500);
    }

    if (page.url().includes("/error")) {
      if (process.env.WEBTOP_DEBUG === "1") process.stderr.write("[debug] Landed on /error — access denied\n");
      return { signoffs, approvals };
    }

    // 1. Extract list items with msgId links (right panel)
    const listItems = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll("a[href*='msgId'], a[href*='signMessaes']")) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/msgId=([^&]+)/);
        const msgId = m ? decodeURIComponent(m[1]) : null;
        if (!msgId) continue;
        const fullUrl = href.startsWith("http") ? href : (href.startsWith("/") ? "https://webtop.smartschool.co.il" + href : "https://webtop.smartschool.co.il/signMessaes?" + href.split("?")[1]);
        const row = a.closest("tr, [class*='row'], mat-row, .mat-mdc-row, [class*='item'], li");
        const container = row || a.parentElement;
        const text = (container?.textContent || a.textContent || "").trim().replace(/\s+/g, " ");
        // status: אד=approved (green), שמ=rejected (red) — look for button or badge
        let status = "pending";
        const statusEl = container?.querySelector("[class*='approve'], [class*='reject'], .mat-mdc-button, button, [class*='badge']");
        const statusText = (statusEl?.textContent || "").trim();
        if (/אד|אושר|approved/i.test(statusText)) status = "approved";
        else if (/שמ|נדחה|rejected/i.test(statusText)) status = "rejected";
        // Also check for green/red by class or aria
        if (status === "pending" && container) {
          const html = container.innerHTML || "";
          if (/background.*green|color.*green|\.approved|אושר/.test(html)) status = "approved";
          if (/background.*red|color.*red|\.rejected|נדחה/.test(html)) status = "rejected";
        }
        out.push({ msgId, url: fullUrl, raw: text, status });
      }
      return out;
    });

    // Fallback: if no msgId links, extract from rows (legacy)
    if (listItems.length === 0) {
      const rows = await page.evaluate(() => {
        const items = [];
        const nodes = document.querySelectorAll("tr, [class*='row'], mat-row, [class*='item']");
        for (const r of nodes) {
          const text = r.textContent.trim().replace(/\s+/g, " ");
          if (text.length > 30 && /אישור|חתימה|טיול|יציאה/.test(text)) items.push(text);
        }
        return items;
      });
      for (const t of rows) {
        if (t && t.length > 30 && !/בחר\/י הודעה|אפשרויות|סינון/.test(t)) {
          signoffs.push({ details: t });
          approvals.push({ label: t.slice(0, 80), details: t, title: t.slice(0, 60), status: "pending", requiredEquipment: [] });
        }
      }
      // Don't return here — fall through to dedup at end of function
    } else {

    const seenMsgId = new Set();
    for (const it of listItems) {
      if (!it.msgId || seenMsgId.has(it.msgId)) continue;
      seenMsgId.add(it.msgId);
      const parts = it.raw.split(/\s+/);
      let date = "";
      let sender = "";
      let title = it.raw;
      const dateMatch = it.raw.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (dateMatch) date = dateMatch[1];
      const parenMatch = it.raw.match(/\(([^)]+)\)/);
      if (parenMatch) sender = parenMatch[1].replace(/\s*\(מורה\)\s*$/, "").trim();
      if (it.raw.length > 80) title = it.raw.slice(0, 80) + "...";

      approvals.push({
        msgId: it.msgId,
        url: it.url,
        label: title,
        title,
        sender,
        date,
        status: it.status,
        itinerary: "",
        requiredEquipment: [],
      });
      signoffs.push({ details: it.raw, msgId: it.msgId, url: it.url, status: it.status });
    }

    // 2. If we have list items, click first to load detail panel and extract itinerary + equipment
    if (approvals.length > 0) {
      const firstLink = page.locator("a[href*='msgId']").first();
      if (await firstLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstLink.click();
        await sleep(1200);
        const detail = await page.evaluate(() => {
          const body = document.body?.innerText || "";
          let itinerary = "";
          let equipment = [];
          const itMatch = body.match(/מסלול[\s:]*([^\n]+?)(?=\n\n|\nציוד|$)/s);
          if (itMatch) itinerary = itMatch[1].trim();
          const eqMatch = body.match(/ציוד נדרש[\s:]*([^\n]+?)(?=\n\n|$)/s);
          if (eqMatch) {
            const eqText = eqMatch[1];
            equipment = eqText.split(/\n|•|·|\d+\./).map(s => s.trim()).filter(Boolean);
          }
          return { itinerary, equipment };
        });
        approvals[0].itinerary = detail.itinerary || "";
        approvals[0].requiredEquipment = detail.equipment || [];
      }
    }
    } // close else (listItems.length > 0)
  } catch (e) {
    if (process.env.WEBTOP_DEBUG === "1") process.stderr.write(`[debug] extractSignoffs: ${e.message}\n`);
  }

  // ── Filter navigation noise from signoffs and approvals ───────────────
  const isNoise = (text) => /ריכוז מידע|תיבת הודעות|כרטיס תלמיד|ספר טלפונים|אחסון קבצים|תמיכה טכנית|יציאה מהמערכת|תפריט ראשי/.test(text || "");
  const cleanSignoffs = signoffs.filter(s => !isNoise(s.details));
  const cleanApprovals = approvals.filter(a => !isNoise(a.details || a.label || a.title));

  // ── Deduplicate approvals — same approval appears in 3 variants: ────────
  // 1. "אד אפלברג דנה (מורה) 23/02/2026 אישור יציאה לטיול"  (initials + sender + date + title)
  // 2. "אפלברג דנה (מורה) 23/02/2026 אישור יציאה לטיול"      (sender + date + title)
  // 3. "אישור יציאה לטיול -שכבת ג'"                            (title only)
  // Normalize by extracting just the core title (after date), falling back to stripping initials.
  function normApproval(t) {
    const s = (t || "").replace(/^[א-ת]{1,2}\s+/, "").trim().replace(/\s+/g, " ");
    // Try to extract just the title after the DD/MM/YYYY date
    const dateIdx = s.search(/\d{2}\/\d{2}\/\d{4}/);
    if (dateIdx >= 0) {
      const afterDate = s.slice(dateIdx + 10).trim();
      if (afterDate.length >= 10) return afterDate.slice(0, 70);
    }
    return s.slice(0, 70);
  }
  const seenAppr = new Map();
  const dedupedApprovals = [];
  for (const a of cleanApprovals) {
    const key = normApproval(a.title || a.label || a.details);
    if (!key || key.length < 10) continue;
    if (seenAppr.has(key)) continue;
    seenAppr.set(key, true);
    // Clean the title: strip initials prefix, keep full sender info
    a.title = (a.title || "").replace(/^[א-ת]{1,2}\s+/, "").trim().replace(/\s+/g, " ");
    a.label = (a.label || "").replace(/^[א-ת]{1,2}\s+/, "").trim().replace(/\s+/g, " ");
    dedupedApprovals.push(a);
  }

  const dedupedSignoffs = [];
  const seenSig = new Map();
  for (const s of cleanSignoffs) {
    const key = normApproval(s.details);
    if (!key || key.length < 10) continue;
    if (seenSig.has(key)) continue;
    seenSig.set(key, true);
    dedupedSignoffs.push(s);
  }

  return { signoffs: dedupedSignoffs, approvals: dedupedApprovals };
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
      // Fallback: navigate directly to notifications page
      if (process.env.WEBTOP_DEBUG === "1") process.stderr.write("[debug] 'התראות' link not found — trying direct URL\n");
      try {
        await page.goto(`${BASE_URL}/notification`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
        await sleep(2000);
      } catch {
        return [];
      }
    } else {
      await notifLink.click();
      await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
    }
    await sleep(800);

    const items = await page.evaluate(() => {
      // spacedText: walk text nodes and join with spaces to avoid concatenated Hebrew
      function spacedText(el) {
        const parts = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walk.nextNode())) {
          const t = node.textContent.trim();
          if (t) parts.push(t);
        }
        return parts.join(" ").replace(/\s+/g, " ").trim();
      }
      const sel = "tr, [class*='notification'], [class*='alert'], [class*='row'], [class*='item'], li, mat-row";
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.map(el => spacedText(el)).filter(t => t.length > 20);
    });
    return items;
  } catch (e) {
    if (process.env.WEBTOP_DEBUG === "1") process.stderr.write(`[debug] extractNotifications error: ${e.message}\n`);
    return [];
  }
}

// ── Messages page (הודעות) — משותף ל-2 הבנות, מיועד להורים ────────────────────
// Deduplicate by normalized subject+date — remove "תק " prefix (common duplicate variant)
function msgDedupKey(m) {
  const subj = (m.subject || "").trim().replace(/\s+/g, " ").replace(/^\s*תק\s+/, "").slice(0, 80);
  const date = m.date || "";
  return `${subj}__${date}`;
}

// Parse DD/MM/YYYY from subject when date is missing (e.g. "|04/03/2026|" or "(רביעי) 02/03/2026")
function parseDateFromSubject(subject) {
  if (!subject) return null;
  const m = subject.match(/(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : null;
}

async function extractMessages(page) {
  const messages = [];
  try {
    // Navigate to messages page
    await page.goto(`${BASE_URL}/Messages`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await sleep(2500);

    // Wait for message list to render (Angular Material table/list)
    await page.waitForSelector("mat-row, .mat-mdc-row, tr.mat-row, [class*='mail'] tr, table tr", { timeout: 10000 }).catch(() => null);
    await sleep(1000);

    const rows = await page.evaluate(() => {
      const items = [];

      // ── Strategy 1: mat-cell based rows (Angular Material table) ──────
      const matRows = document.querySelectorAll("mat-row, .mat-mdc-row, tr.mat-mdc-row");
      for (const row of matRows) {
        const cells = row.querySelectorAll("mat-cell, .mat-mdc-cell, td.mat-mdc-cell, td");
        if (cells.length < 2) continue;
        const texts = Array.from(cells).map(c => c.textContent.trim().replace(/\s+/g, " "));
        // Skip if any cell looks like navigation noise
        if (texts.some(t => /תפריט ראשי|הגדרות|יציאה מהמערכת|סינון|אפשרויות/.test(t))) continue;
        // Check for unread: bold font-weight, unread class, or mat-row-bold
        const style = window.getComputedStyle(row);
        const isBold = style.fontWeight >= 600 || style.fontWeight === "bold";
        const hasUnreadClass = row.className.includes("unread") || row.className.includes("bold") || row.className.includes("Unread");
        const isUnread = isBold || hasUnreadClass;
        items.push({ cells: texts, read: !isUnread, html: row.innerHTML.slice(0, 200) });
      }

      // ── Strategy 2: regular table rows (fallback) ─────────────────────
      if (items.length === 0) {
        const trs = document.querySelectorAll("table tbody tr, table tr");
        for (const row of trs) {
          const cells = row.querySelectorAll("td");
          if (cells.length < 2) continue;
          const texts = Array.from(cells).map(c => c.textContent.trim().replace(/\s+/g, " "));
          if (texts.some(t => /תפריט ראשי|הגדרות|יציאה מהמערכת|סינון|אפשרויות/.test(t))) continue;
          const hasUnreadClass = row.className.includes("unread") || row.className.includes("bold");
          items.push({ cells: texts, read: !hasUnreadClass });
        }
      }

      return items;
    });

    // Parse each row — try to extract sender, date, subject from cells
    for (const r of rows) {
      const cells = r.cells || [];
      if (cells.length < 2) continue;

      // Common Webtop patterns for cells:
      // Pattern A: [sender, subject, date] — 3 cells
      // Pattern B: [sender, subject] — 2 cells
      // Pattern C: [initials, sender, date, subject] — 4 cells (with profile initials)
      let from = "", subject = "", date = "", time = "", body = "";

      // Find which cell contains a date (DD/MM/YYYY)
      const dateIdx = cells.findIndex(c => /\d{2}\/\d{2}\/\d{4}/.test(c));

      if (dateIdx >= 0) {
        const dateMatch = cells[dateIdx].match(/(\d{2}\/\d{2}\/\d{4})/);
        date = dateMatch ? dateMatch[1] : "";
        // Time: look for HH:MM near the date
        const timeMatch = cells[dateIdx].match(/(\d{2}:\d{2})/);
        time = timeMatch ? timeMatch[1] : "";
      }

      if (cells.length >= 3) {
        // Try: cells before date = sender, cells after = subject
        if (dateIdx === 2) {
          from = cells[0] || cells[1] || "";
          subject = cells[1] || "";
          if (cells[0].length <= 3 && cells[1]) { // first cell is initials (אד, תש)
            from = cells[1];
            subject = cells.length > 3 ? cells[3] : "";
          }
        } else if (dateIdx === 1) {
          from = cells[0] || "";
          subject = cells.length > 2 ? cells[2] : "";
        } else {
          // Fallback: first cell sender, last cell or second = subject
          from = cells[0] || "";
          subject = cells[cells.length - 1] || cells[1] || "";
        }
      } else if (cells.length === 2) {
        from = cells[0] || "";
        subject = cells[1] || "";
      }

      // Clean sender — extract name and role from "מנחם טל (מורה)"
      let fromRole = "";
      const roleMatch = from.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (roleMatch) {
        from = roleMatch[1].trim();
        fromRole = roleMatch[2].trim();
      }
      // Remove 2-letter initials prefix: "תש תורגמן שיר" → "תורגמן שיר"
      from = from.replace(/^[א-ת]{1,2}\s+/, "").trim();

      // If subject is empty but from contains date+subject pattern, parse it
      // Pattern: "מנחם טל (מורה) 02/03/2026 שומרים על החוסן בבית"
      if (!subject && from) {
        const combo = from.match(/^(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
        if (combo) {
          from = combo[1].trim();
          date = date || combo[2];
          subject = combo[3].trim();
          const role2 = from.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
          if (role2) { from = role2[1].trim(); fromRole = role2[2].trim(); }
          from = from.replace(/^[א-ת]{1,2}\s+/, "").trim();
        }
      }

      // If subject still contains embedded "sender date subject" pattern, parse it
      if (subject && !date) {
        const embDate = subject.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (embDate) {
          date = embDate[1];
          // Split subject at the date
          const parts = subject.split(embDate[1]);
          if (parts.length >= 2) {
            subject = parts[1].trim() || parts[0].trim();
          }
        }
      }

      // Skip garbage rows — navigation/sidebar text
      const fullText = cells.join(" ");
      if (/תפריט ראשי|הגדרות|יציאה|סינון|אפשרויות נוספות|WEBTOP.*כניסה אחרונה/.test(fullText)) continue;
      if (/^Webtop\s+תיבת/.test(fullText)) continue; // page title row
      if (/התיקיות שלי|נכנסות|יוצאות|טיוטות|נמחקו/.test(subject)) continue; // folder tabs

      // Skip if no meaningful subject
      if (!subject || subject.length < 3) continue;

      messages.push({ from, fromRole, subject: subject.slice(0, 200), date: date || null, time: time || null, body, read: !!r.read });
    }

    // If mat-row strategy returned nothing, try a text-pattern fallback
    // Parse raw text nodes that match "SenderName (Role) DD/MM/YYYY Subject"
    if (messages.length === 0) {
      const rawItems = await page.evaluate(() => {
        const results = [];
        // Look for any element that contains sender+date+subject pattern
        const allEls = document.querySelectorAll("tr, mat-row, .mat-mdc-row, [class*='row'], [class*='item'], li");
        for (const el of allEls) {
          const text = el.textContent.trim().replace(/\s+/g, " ");
          // Must have a date and reasonable length (real message row)
          if (text.length < 20 || text.length > 300 || !/\d{2}\/\d{2}\/\d{4}/.test(text)) continue;
          // Must NOT be navigation noise
          if (/תפריט ראשי|הגדרות|יציאה|סינון|WEBTOP.*כניסה/.test(text)) continue;
          // Check read status
          const style = window.getComputedStyle(el);
          const isBold = style.fontWeight >= 600 || style.fontWeight === "bold";
          const hasUnread = el.className.includes("unread") || el.className.includes("bold");
          results.push({ text, read: !(isBold || hasUnread) });
        }
        return results;
      });

      for (const r of rawItems) {
        // Parse: "SenderName (Role) DD/MM/YYYY Subject"
        const m = r.text.match(/^(?:[א-ת]{1,2}\s+)?(.+?)\s*(?:\(([^)]+)\))?\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
        if (m) {
          messages.push({
            from: m[1].replace(/^[א-ת]{1,2}\s+/, "").trim(),
            fromRole: m[2] || "",
            subject: m[4].trim().slice(0, 200),
            date: m[3],
            time: null,
            body: "",
            read: !!r.read,
          });
        }
      }
    }

    // Deduplicate by normalized subject+date
    const seen = new Map();
    const deduped = [];
    for (const m of messages) {
      const key = msgDedupKey(m);
      if (seen.has(key)) continue;
      seen.set(key, true);
      deduped.push(m);
    }

    // Try to fetch body by clicking each unread message (up to 3)
    const needBody = deduped.filter(m => !m.body).slice(0, 3);
    for (let i = 0; i < needBody.length; i++) {
      try {
        const msgSubjShort = (needBody[i].subject || "").slice(0, 30);
        const clickTarget = page.locator(`mat-row, .mat-mdc-row, tr`).filter({ hasText: msgSubjShort }).first();
        if (await clickTarget.isVisible({ timeout: 2000 }).catch(() => false)) {
          await clickTarget.click();
          await sleep(1500);
          const detail = await page.evaluate(() => {
            // Look for message body panel — common selectors for Webtop detail pane
            const sel = "[class*='msg-body'], [class*='message-body'], [class*='detail-content'], [class*='mail-body'], .msg-content, [class*='content'] p, mat-dialog-content, [role='dialog']";
            const panel = document.querySelector(sel);
            if (panel) return panel.textContent.trim().replace(/\s+/g, " ").slice(0, 800);
            // Fallback: look for a large text block in the right/detail pane
            const right = document.querySelector("[class*='detail'], [class*='preview'], [class*='reading']");
            if (right) return right.textContent.trim().replace(/\s+/g, " ").slice(0, 800);
            return "";
          });
          if (detail && detail.length > 10) {
            needBody[i].body = detail.slice(0, 800);
          }
          // Go back to messages list
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null);
          await sleep(800);
        }
      } catch (_) {}
    }

    return deduped;
  } catch (e) {
    if (process.env.WEBTOP_DEBUG === "1") process.stderr.write(`[debug] extractMessages error: ${e.message}\n`);
  }
  return messages;
}

// ── Launch options (reused for initial + fallback launches) ────────────────────
const LAUNCH_OPTS = {
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=TranslateUI",
  ],
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  locale: "he-IL",
  timezoneId: "Asia/Jerusalem",
};

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  // ── Persistent browser profile ────────────────────────────────────────────
  // SILENT BY DEFAULT: run headless. Browser only pops up when session expired (reCAPTCHA).
  let context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    ...LAUNCH_OPTS,
  });

  let page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  await page.setViewportSize({ width: 1400, height: 900 });

  // ── Dismiss cookie consent / popups ──────────────────────────────────────
  async function dismissCookies() {
    try {
      // Common cookie consent button patterns (Hebrew + English)
      const selectors = [
        'button:has-text("אישור")', 'button:has-text("קבל")', 'button:has-text("אשר")',
        'button:has-text("Accept")', 'button:has-text("OK")', 'button:has-text("Got it")',
        '[class*="cookie"] button', '[class*="consent"] button', '[id*="cookie"] button',
        '[class*="cookie-banner"] button', '[class*="gdpr"] button',
        '.cc-accept', '.cc-dismiss', '#accept-cookies',
      ];
      for (const sel of selectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await btn.click({ timeout: 2000 }).catch(() => {});
          process.stderr.write('[info] Dismissed cookie/consent popup\n');
          await sleep(500);
          break;
        }
      }
    } catch {}
  }

  // ── Try to go directly to dashboard ───────────────────────────────────────
  await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
  await sleep(3000);
  await dismissCookies();

  // ── Check if we're logged in (redirected to login = not logged in) ─────────
  const currentUrl = page.url();
  const needsLogin = currentUrl.includes("/account/login") || currentUrl.includes("/login");

  if (needsLogin) {
    if (!CAPTURE_MODE && !USER) {
      out({ ok: false, error: "Not logged in and no credentials. Run with WEBTOP_CAPTURE=true first." });
      await context.close();
      process.exit(1);
    }
    if (HEADLESS) {
      // reCAPTCHA blocks headless login. Relaunch headed for manual login only.
      await context.close();
      process.stderr.write("\n>>> Session expired. Opening browser for manual login (reCAPTCHA required)...\n>>> Log in, solve CAPTCHA if shown, click כניסה. Waiting up to 10 min.\n\n");
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        ...LAUNCH_OPTS,
      });
      page = await context.newPage();
      page.setDefaultTimeout(TIMEOUT);
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
      await page.waitForURL(/dashboard/, { timeout: 600_000 });
      await dismissCookies();
    } else {
      await doLogin(page);
      await dismissCookies();
    }
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
  // סגור overlays, המתן לתוכן ראשי
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Escape");
    await sleep(400);
  }
  await sleep(3000);
  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500);
  await page.getByText("קיצורי דרך", { exact: false }).first().waitFor({ state: "visible", timeout: 20000 }).catch(() => null);
  await sleep(2000);
  // בחר עברית אם הדף מציג שפה זרה — חיפוש mat-select שמכיל עברית
  try {
    const hasHebrew = await page.evaluate(() => {
      const t = (document.body?.innerText || "").slice(0, 3000);
      return /ריכוז|קיצורי|תלמיד|שיעור|התראות/.test(t);
    });
    if (!hasHebrew) {
      for (const sel of await page.locator("mat-select").all()) {
        await page.keyboard.press("Escape");
        await sleep(300);
        await sel.click();
        await sleep(800);
        const heb = page.locator("mat-option").filter({ hasText: "עברית" }).first();
        if (await heb.isVisible({ timeout: 1500 }).catch(() => false)) {
          await heb.click();
          await sleep(3500);
          await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
          break;
        }
        await page.keyboard.press("Escape");
      }
    }
  } catch (_) {}

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

  const classEventsByStudent  = {};
  const schoolEventsByStudent = {};
  const homeworkByStudent     = {};
  const gradesByStudent       = {};
  let   allNotifications      = [];
  let   mainDashboard         = null;

  // Helper: store data under both full name and short name (אמי / גונשרוביץ אמי)
  function storeByStudent(map, fullName, data) {
    map[fullName] = data;
    const shortName = fullName.split(/\s+/).pop() || fullName;
    if (shortName !== fullName) map[shortName] = data;
  }

  // ── Multi-student extraction loop — כל ילדה בנפרד ─────────────────────────
  const loopStudents = (studentList && studentList.length > 1) ? studentList : [null];

  for (let i = 0; i < loopStudents.length; i++) {
    const studentName = loopStudents[i];

    // Switch portal to this student (skip for single-student accounts)
    if (studentName !== null) {
      let switchOk = false;
      try {
        switchOk = await switchToStudent(page, studentName);
      } catch (e) {
        process.stderr.write(`[warn] switchToStudent("${studentName}") failed: ${e.message?.slice(0, 80)}\n`);
      }

      if (!switchOk) {
        process.stderr.write(`[warn] Could not switch to "${studentName}" — retrying after full reload\n`);
        await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
        await sleep(2000);
        try {
          switchOk = await switchToStudent(page, studentName);
        } catch (e2) {
          process.stderr.write(`[warn] Retry also failed for "${studentName}": ${e2.message?.slice(0, 80)}\n`);
        }
        if (!switchOk) {
          process.stderr.write(`[ERROR] Skipping "${studentName}" — switch failed after retry\n`);
          continue; // skip this student entirely rather than storing wrong data
        }
      }

      // Navigate to dashboard after successful switch
      if (!page.url().includes("/dashboard")) {
        await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
        await sleep(1000);
      }
    }

    // Extract dashboard card data (classEvents, homework, grades, …)
    const dashboard = await extractDashboard(page);
    if (!mainDashboard) mainDashboard = dashboard;

    process.stderr.write(`[info] Extracting data for "${studentName || "(single)"}" — ` +
      `classEvents: ${(dashboard.classEvents||[]).length}, ` +
      `homework: ${(dashboard.homework||[]).length}, ` +
      `grades: ${(dashboard.grades||[]).length}\n`);

    // Store ALL dashboard data per-student (not just classEvents)
    if (studentName !== null) {
      storeByStudent(classEventsByStudent,  studentName, dashboard.classEvents || []);
      storeByStudent(homeworkByStudent,     studentName, dashboard.homework    || []);
      storeByStudent(gradesByStudent,       studentName, dashboard.grades      || []);

      // Extract school events (יומן פגישות) per student — אסיפות הורים וכו'
      const schoolEv = await extractSchoolEvents(page).catch(() => []);
      storeByStudent(schoolEventsByStudent, studentName, schoolEv);
    }

    // Extract notifications for this student (navigates to /התראות)
    const rawNotifs = await extractNotifications(page);
    const notifs = rawNotifs
      .map((raw) => ({ parsed: parseNotification(raw), raw }))
      .filter(({ parsed, raw }) => isRealNotification(parsed, raw))
      .map(({ parsed }) => parsed);

    process.stderr.write(`[info] Student "${studentName || "(single)"}" notifications: ${rawNotifs.length} raw → ${notifs.length} parsed\n`);
    if (process.env.WEBTOP_DEBUG === "1" && rawNotifs.length > 0 && notifs.length === 0) {
      const sample = rawNotifs[0].slice(0, 150);
      process.stderr.write(`[debug] Sample raw: "${sample}..."\n`);
    }

    allNotifications.push(...notifs);

    // Return to dashboard before switching to next student
    if (studentName !== null && i < loopStudents.length - 1) {
      await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
      await sleep(1000);
    }
  }

  // ── Filter to only NEW notifications (within last 21 days or future) ───────
  allNotifications = allNotifications.filter(isNewNotification);

  // ── Deduplicate notifications (same content from multiple students) ───────
  const notifKey = (n) => `${(n.type||'').trim()}_${(n.student||'').trim()}_${(n.subject||'').trim()}_${(n.date||'').trim()}_${(n.lesson||'')}`;
  const seenNotifs = new Map();
  for (const n of allNotifications) {
    const k = notifKey(n);
    if (!seenNotifs.has(k)) seenNotifs.set(k, n);
  }
  allNotifications = Array.from(seenNotifs.values());

  // ── Single-student fallback: map all data to detected student name ──
  if (!studentList || studentList.length <= 1) {
    mainDashboard = mainDashboard || {};
    const uniqueNames = [...new Set(allNotifications.map((n) => n.student).filter(Boolean))];
    const fallbackSchool = await extractSchoolEvents(page).catch(() => []);
    for (const name of uniqueNames) {
      if (!classEventsByStudent[name])  classEventsByStudent[name]  = mainDashboard.classEvents || [];
      if (!homeworkByStudent[name])     homeworkByStudent[name]     = mainDashboard.homework    || [];
      if (!gradesByStudent[name])       gradesByStudent[name]       = mainDashboard.grades      || [];
      if (!schoolEventsByStudent[name]) schoolEventsByStudent[name] = fallbackSchool;
    }
  }

  // ── Build homeworkByStudent from NOTIFICATIONS (reliable) instead of dashboard card (daily-only) ──
  // The dashboard "נושאי שיעור" card only shows TODAY's schedule — often empty.
  // Homework notifications contain the full 21-day history with subject, date, and text.
  // Clear dashboard-sourced homework first (it's unreliable — shows "לא נמצאו נתונים." when empty)
  for (const key of Object.keys(homeworkByStudent)) delete homeworkByStudent[key];
  for (const n of allNotifications) {
    if (n.type !== "homework" || !n.student) continue;
    const shortName = n.student;
    // Find matching full name from studentList
    const fullName = (studentList || []).find(s => s.includes(shortName)) || shortName;
    const entry = {
      subject: n.subject || "",
      date: n.date || "",
      text: n.homeworkText || n.description || "",
      lesson: n.lesson || null,
    };
    if (!homeworkByStudent[fullName]) homeworkByStudent[fullName] = [];
    homeworkByStudent[fullName].push(entry);
    if (shortName !== fullName) {
      if (!homeworkByStudent[shortName]) homeworkByStudent[shortName] = [];
      homeworkByStudent[shortName].push(entry);
    }
  }

  // ── Extract messages (הודעות) — once per account ───────────────────────────
  const messages = await extractMessages(page).catch(() => []);

  // ── schoolEvents: backward compat (merge all per-student for API consumers that expect flat list)
  const schoolEvents = Object.values(schoolEventsByStudent).flat();
  const schoolEventsUnique = [...new Map(schoolEvents.map(e => [e.name, e])).values()];
  const signoffResult = await extractSignoffs(page).catch(() => ({ signoffs: [], approvals: [] }));
  const signoffs      = Array.isArray(signoffResult) ? signoffResult : (signoffResult?.signoffs || []);
  const approvals     = signoffResult?.approvals || [];
  const externalLinks = await extractExternalSitesLinks(page).catch(() => []);
  // Merge dashboard links + external sites, dedupe by text|href
  const baseLinks = mainDashboard?.usefulLinks || [];
  const seen = new Map();
  const isNoise = (t) => !t || t.length < 3 || /^\d+$/.test(t) || /^\s*\d+\s*$/.test(t);
  for (const l of [...baseLinks, ...externalLinks]) {
    const text = (l.text || "").trim();
    if (isNoise(text) || !l.href) continue;
    const key = text + "|" + (l.href || "");
    if (!seen.has(key)) seen.set(key, { ...l, text });
  }
  const usefulLinks = Array.from(seen.values());

  await context.close();

  out({
    ok: true,
    extractedAt: new Date().toISOString(),
    url: DASHBOARD_URL,
    data: {
      studentName:          mainDashboard?.studentName || "",
      classEvents:          mainDashboard?.classEvents || [],   // backward compat (first student)
      classEventsByStudent,                                      // per-student class events
      homework:             mainDashboard?.homework    || [],   // backward compat (first student)
      homeworkByStudent,                                         // per-student homework
      grades:               mainDashboard?.grades      || [],   // backward compat (first student)
      gradesByStudent,                                           // per-student grades
      tables:               mainDashboard?.tables      || [],
      notifications:        allNotifications,
      messages:             messages,
      schoolEvents:         schoolEventsUnique,
      schoolEventsByStudent,
      signoffs:             signoffs,
      approvals:            approvals,
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
