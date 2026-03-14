/**
 * debug_login.mjs — Inspect login page structure and test auto-fill
 * Run: node debug_login.mjs
 * This opens a visible browser, fills credentials, prints what it finds, and waits.
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
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

const USER = process.env.WEBTOP_USER;
const PASS = process.env.WEBTOP_PASS;
const LOGIN_URL = "https://webtop.smartschool.co.il/account/login";
const PROFILE_DIR = join(__dirname, ".webtop_profile");

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log("Starting debug browser (headed)...");
  console.log(`USER=${USER}, PASS=${PASS ? "***" : "NOT SET"}`);

  // Remove lock
  try { require("fs").unlinkSync(join(PROFILE_DIR, "Default/LOCK")); } catch {}

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "he-IL",
  });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  console.log("Navigating to login page...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(3000);

  console.log("Current URL:", page.url());

  // Inspect inputs
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("input")).map(i => ({
      type: i.type,
      name: i.name,
      id: i.id,
      placeholder: i.placeholder,
      className: i.className.slice(0, 60),
      disabled: i.disabled,
      visible: i.offsetParent !== null,
    }));
  });
  console.log("\n=== INPUTS FOUND ===");
  inputs.forEach((inp, i) => console.log(`[${i}]`, JSON.stringify(inp)));

  // Inspect buttons
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).map(b => ({
      type: b.type,
      text: b.innerText.trim().slice(0, 40),
      disabled: b.disabled,
      ariaDisabled: b.getAttribute("aria-disabled"),
      className: b.className.slice(0, 60),
    }));
  });
  console.log("\n=== BUTTONS FOUND ===");
  buttons.forEach((btn, i) => console.log(`[${i}]`, JSON.stringify(btn)));

  // Try filling
  console.log("\n=== FILLING CREDENTIALS ===");
  try {
    const userInput = page.locator('input[type="text"]').first();
    const count = await userInput.count();
    console.log("Text inputs count:", count);
    if (count > 0) {
      await userInput.click();
      await sleep(500);
      await userInput.type(USER, { delay: 80 });
      console.log("Filled username OK");
    }

    const passInput = page.locator('input[type="password"]').first();
    const passCount = await passInput.count();
    console.log("Password inputs count:", passCount);
    if (passCount > 0) {
      await passInput.click();
      await sleep(300);
      await passInput.type(PASS, { delay: 80 });
      console.log("Filled password OK");
    }
  } catch (e) {
    console.log("Fill error:", e.message);
  }

  console.log("\n=== WAITING 10s — check button state ===");
  await sleep(5000);

  const btnState = await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    if (!btn) return "NO SUBMIT BUTTON FOUND";
    return {
      disabled: btn.disabled,
      ariaDisabled: btn.getAttribute("aria-disabled"),
      text: btn.innerText.trim(),
    };
  });
  console.log("Button state after fill:", JSON.stringify(btnState));

  await sleep(5000);

  console.log("Clicking submit...");
  try {
    const submitBtn = page.locator('button[type="submit"]').first();
    await submitBtn.click({ force: true });
    console.log("Clicked!");
  } catch (e) {
    console.log("Click error:", e.message);
  }

  console.log("\nWaiting 30s to observe result...");
  await sleep(30000);
  console.log("Final URL:", page.url());

  await context.close();
  console.log("Done.");
})();
