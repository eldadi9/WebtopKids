#!/usr/bin/env node
/**
 * webtop_approve.mjs — מבצע אישור בדף חתימות ואישורים ב-Webtop
 * משתמש בפרופיל שמור (.webtop_profile) — הרץ WEBTOP_CAPTURE פעם אם צריך
 */
import { chromium } from "playwright";
import { resolve, dirname } from "path";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, ".env");
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

const BASE_URL = "https://webtop.smartschool.co.il";
const PROFILE_DIR = resolve(process.env.WEBTOP_PROFILE || ".webtop_profile");
const TIMEOUT = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("\n[webtop_approve] מתחבר ל-Webtop...\n");

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  });

  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  try {
    // 1. Dashboard
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle", timeout: TIMEOUT });
    await sleep(2500);

    const needsLogin = page.url().includes("/login");
    if (needsLogin) {
      console.log("[webtop_approve] נדרשת התחברות. התחבר ידנית בדפדפן ואז לחץ Enter...");
      await page.waitForURL((u) => !u.includes("/login"), { timeout: 300000 });
    }

    // 2. לחיצה על חתימות ואישורים (דרך התפריט)
    const signLink = page.locator("a:has-text('חתימות ואישורים'), a[href*='signMessaes']").first();
    if (!(await signLink.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log("[webtop_approve] לא נמצא לינק חתימות ואישורים. מנווט ישירות...");
      await page.goto(`${BASE_URL}/signMessaes`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    } else {
      await signLink.click();
      await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
    }
    await sleep(2000);

    if (page.url().includes("/error")) {
      console.error("[webtop_approve] שגיאה: הגישה נדחתה (דף /error). ייתכן שההרשאות או הסשן לא תקפים.");
      await context.close();
      process.exit(1);
    }

    // 3. מציאת פריטים שממתינים לאישור (ללא אד)
    const pendingItems = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll("tr, mat-row, .mat-mdc-row, [class*='row'], [class*='item']");
      for (const row of rows) {
        const text = (row.textContent || "").trim();
        if (text.length < 20 || !/אישור|טיול|יציאה|חתימה/.test(text)) continue;
        if (/אד\s|אושר/.test(text)) continue; // כבר מאושר
        const link = row.querySelector("a[href*='msgId'], a[href*='signMessaes']");
        if (link) items.push({ el: row, text: text.slice(0, 80), hasLink: true });
        else items.push({ el: row, text: text.slice(0, 80), hasLink: false });
      }
      return items.slice(0, 5);
    });

    if (!pendingItems || pendingItems.length === 0) {
      console.log("[webtop_approve] לא נמצאו אישורים ממתינים — הכל מאושר או אין גישה.");
      await sleep(3000);
      await context.close();
      process.exit(0);
    }

    console.log(`[webtop_approve] נמצאו ${pendingItems.length} פריטים. מנסה לאשר את הראשון...`);

    // 4. לחיצה על הפריט הראשון שממתין (לינק או שורה)
    const clicked = await page.evaluate(() => {
      for (const a of document.querySelectorAll("a[href*='msgId'], a[href*='signMessaes'], a[href]")) {
        const row = a.closest("tr, mat-row, .mat-mdc-row, [class*='row']") || a.parentElement;
        const text = (row?.textContent || a.textContent || "").trim();
        if (/אד\s|אושר/.test(text)) continue;
        if ((/אישור|טיול|יציאה|חתימה/.test(text)) && text.length > 25) {
          a.click();
          return true;
        }
      }
      // Fallback: לחץ על שורה ראשונה שמכילה אישור ולא מאושרת
      for (const row of document.querySelectorAll("tr, mat-row, .mat-mdc-row, [class*='row']")) {
        const text = (row.textContent || "").trim();
        if (/אד\s|אושר/.test(text)) continue;
        if ((/אישור|טיול|יציאה/.test(text)) && text.length > 30) {
          row.click();
          return true;
        }
      }
      return false;
    });
    if (clicked) await sleep(1500);

    // 5. חיפוש כפתור אישור בפאנל הפרטים
    const approveSelectors = [
      'button:has-text("אישור")',
      'button:has-text("אשר")',
      'button:has-text("אושר")',
      '[role="button"]:has-text("אישור")',
      '[role="button"]:has-text("אשר")',
      'a:has-text("אישור")',
      'input[type="checkbox"]',
      '.mat-mdc-button:has-text("אישור")',
      '.mat-mdc-button:has-text("אשר")',
    ];

    let approved = false;
    for (const sel of approveSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log(`[webtop_approve] לוחץ: ${sel}`);
        await btn.click();
        await sleep(2000);
        approved = true;
        break;
      }
    }

    if (!approved) {
      console.log("[webtop_approve] לא נמצא כפתור אישור ברור. הדפדפן נשאר פתוח — אשר ידנית.");
      await sleep(10000);
    } else {
      console.log("[webtop_approve] ניסיון אישור בוצע. בדוק בדף.");
      await sleep(5000);
    }
  } catch (e) {
    console.error("[webtop_approve] שגיאה:", e.message);
  }

  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
