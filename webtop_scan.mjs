/**
 * webtop_scan.mjs — סריקת כל חלונות האתר
 *
 * מריץ: WEBTOP_SCAN=true node webtop_scan.mjs
 *
 * סורק חלון חלון את Webtop, מגלה את כל הדפים והתוכן הזמין,
 * ומדפיס דו"ח JSON עם כל הכותרות, טבלאות וכרטיסים שנמצאו.
 * משמש לזיהוי נתונים שניתן להוסיף לאפליקציה.
 */

import { chromium } from "playwright";
import { resolve, dirname, join } from "path";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const BASE_URL      = "https://webtop.smartschool.co.il";
const DASHBOARD_URL = `${BASE_URL}/dashboard`;
const PROFILE_DIR   = resolve(process.env.WEBTOP_PROFILE || ".webtop_profile");
const TIMEOUT       = 25_000;
const sleep         = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
    locale: "he-IL",
  });

  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await sleep(2000);

  const needsLogin = page.url().includes("/account/login") || page.url().includes("/login");
  if (needsLogin) {
    console.log("\n>>> צריך התחברות. התחבר ידנית ואז לחץ Enter...");
    await page.waitForSelector("body", { timeout: 600_000 });
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: TIMEOUT });
    await sleep(2000);
  }

  const discovery = { pages: [], dashboard: null };

  // 1. שלב ראשון — מצא את כל הלינקים בתפריט הצד
  const sidebarLinks = await page.evaluate(() => {
    const links = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href], mat-nav-list a, nav a, [role='navigation'] a, .sidenav a, mat-sidenav a")) {
      const text = (a.textContent || "").trim().replace(/\s+/g, " ");
      const href = a.getAttribute("href") || "";
      if (text.length > 1 && text.length < 80 && !seen.has(text)) {
        seen.add(text);
        links.push({ text, href: href.startsWith("/") ? href : (href.startsWith("http") ? href : "/" + href) });
      }
    }
    return links;
  });

  discovery.sidebarLinks = sidebarLinks.filter((l) => !/תפריט ראשי|הגדרות|יציאה/.test(l.text));
  console.log("\n[סריקה] נמצאו לינקים בתפריט:", discovery.sidebarLinks.map((l) => l.text).join(", "));

  // 2. חלץ דשבורד ראשי
  const dash = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, [class*='title'], [class*='header']"))
      .map((el) => el.textContent.trim().replace(/\s+/g, " "))
      .filter((t) => t.length > 1 && t.length < 120);
    const tables = Array.from(document.querySelectorAll("table")).map((t) => ({
      headers: Array.from(t.querySelectorAll("th")).map((th) => th.textContent.trim()),
      rowCount: t.querySelectorAll("tbody tr").length,
    }));
    return { headings, tables };
  });
  discovery.dashboard = dash;

  // 3. עבור על כל לינק תפריט, לחץ ונמשוך תוכן
  for (const link of discovery.sidebarLinks) {
    try {
      const url = link.href.startsWith("http") ? link.href : BASE_URL + (link.href || "/");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
      await sleep(1500);

      const content = await page.evaluate((pageTitle) => {
        const main = document.querySelector("mat-sidenav-content, [role='main'], main") || document.body;
        const headings = Array.from(main.querySelectorAll("h1, h2, h3, h4, [class*='title'], [class*='header']"))
          .map((el) => el.textContent.trim().replace(/\s+/g, " "))
          .filter((t) => t.length > 1 && t.length < 150);

        const tables = Array.from(main.querySelectorAll("table")).map((t) => ({
          headers: Array.from(t.querySelectorAll("th")).map((th) => th.textContent.trim()),
          rows: Array.from(t.querySelectorAll("tbody tr")).slice(0, 15).map((tr) =>
            Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.trim().slice(0, 100))
          ),
        }));

        const allCards = Array.from(main.querySelectorAll("[class*='card'], [class*='panel'], mat-card"))
          .slice(0, 20)
          .map((c) => ({
            title: c.querySelector("h2, h3, h4, [class*='title']")?.textContent?.trim()?.slice(0, 80) || "",
            preview: c.textContent.trim().replace(/\s+/g, " ").slice(0, 150),
          }));

        return { pageTitle, headings, tables, cards: allCards.filter((c) => c.preview.length > 10) };
      }, link.text);

      discovery.pages.push({ link: link.text, url: page.url(), ...content });
      console.log(`[סריקה] ${link.text}: ${content.headings.length} כותרות, ${content.tables.length} טבלאות`);
    } catch (e) {
      console.warn(`[סריקה] שגיאה ב-${link.text}:`, e.message);
      discovery.pages.push({ link: link.text, error: e.message });
    }
  }

  await context.close();

  process.stdout.write(JSON.stringify(discovery, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
