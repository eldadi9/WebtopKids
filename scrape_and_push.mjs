#!/usr/bin/env node
/**
 * scrape_and_push.mjs — One-shot: scrape + push to VPS (no prompts)
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runWebtopScraperChild } from './webtop_scraper_child.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
}
loadEnv();

let VPS_URL = (process.env.VPS_URL || 'http://76.13.8.113:3001').replace(/\/$/, '');
if (VPS_URL.includes('/api/push')) VPS_URL = VPS_URL.replace(/\/api\/push.*$/, '');
const PUSH_SECRET = process.env.PUSH_SECRET || 'webtop2026';

async function runScraper() {
  return runWebtopScraperChild({
    log: (msg) => console.log(`[scrape_push] ${msg}`),
    useScrapingLock: false,
  });
}

async function pushToVPS(data) {
  const res = await fetch(`${VPS_URL}/api/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: PUSH_SECRET, data }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

(async () => {
  console.log('[scrape_push] Scraping webtop...');
  const data = await runScraper();

  if (!data?.ok) {
    console.error('[scrape_push] Scraper returned ok=false — skipping push to preserve cached data');
    console.error('[scrape_push] Reason:', data?.error || 'unknown');
    process.exit(1);
  }

  console.log(`[scrape_push] Got ${data?.data?.notifications?.length ?? 0} notifications`);

  console.log(`[scrape_push] Pushing to ${VPS_URL}...`);
  const result = await pushToVPS(data);
  console.log(`[scrape_push] Push OK — ${result?.count ?? '?'} notifications synced`);
})().catch(e => {
  console.error('[scrape_push] Error:', e.message);
  process.exit(1);
});
