#!/usr/bin/env node
/**
 * push_local_cache.mjs — Push local data_cache.json to VPS (one-time restore)
 * Use when scraper fails but you have good data locally.
 *
 * node push_local_cache.mjs
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
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

const VPS_BASE = (process.env.VPS_URL || "http://76.13.8.113:3001").replace(/\/$/, "");
const VPS_URL = VPS_BASE.includes("/api/push") ? VPS_BASE : `${VPS_BASE}/api/push`;
const PUSH_SECRET = process.env.PUSH_SECRET || "webtop2026";
const cachePath = join(__dirname, "data_cache.json");

if (!existsSync(cachePath)) {
  console.error("❌ data_cache.json not found");
  process.exit(1);
}

const cached = JSON.parse(readFileSync(cachePath, "utf8"));
const data = cached?.data;
if (!data) {
  console.error("❌ No data in cache file");
  process.exit(1);
}

const count = data?.data?.notifications?.length ?? 0;
console.log(`[push_local_cache] Pushing ${count} notifications to VPS...`);

try {
  const res = await fetch(VPS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: PUSH_SECRET, data }),
  });

  const text = await res.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    console.error("❌ VPS returned non-JSON. Status:", res.status);
    console.error("   Response:", text.slice(0, 200));
    process.exit(1);
  }

  if (result.ok) {
    console.log(`✅ Pushed — ${result.count ?? count} notifications on VPS`);
  } else {
    console.error("❌ Push failed:", result.error);
    process.exit(1);
  }
} catch (e) {
  console.error("❌ Network error:", e.message);
  console.error("   Is VPS running? Check: " + VPS_URL + "/api/status");
  process.exit(1);
}
