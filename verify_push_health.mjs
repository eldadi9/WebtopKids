#!/usr/bin/env node
/**
 * One-shot: load .env, GET VPS /api/status/system + /api/data (no secrets in stdout).
 * Usage: node verify_push_health.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) {
    console.error('No .env');
    process.exit(1);
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

let base = (process.env.VPS_URL || '').replace(/\/$/, '');
if (base.includes('/api/push')) base = base.replace(/\/api\/push.*$/, '');
if (!base) {
  console.error('VPS_URL missing');
  process.exit(1);
}

async function main() {
  console.log('VPS base:', base.replace(/^(https?:\/\/)([^/:]+)/, '$1***'));

  const sysRes = await fetch(`${base}/api/status/system`, { signal: AbortSignal.timeout(15_000) });
  const sysText = await sysRes.text();
  let sys;
  try {
    sys = JSON.parse(sysText);
  } catch {
    console.log('GET /api/status/system', sysRes.status, sysText.slice(0, 200));
    process.exit(1);
  }
  console.log('GET /api/status/system', sysRes.status, {
    stale: sys.stale,
    cacheAgeMin: sys.cacheAgeMin,
    staleThresholdMin: sys.staleThresholdMin,
    expectsHomePush: sys.expectsHomePush,
    triggerPending: sys.triggerPending,
    dataValid: sys.dataValid,
    message: sys.message,
  });

  const dataRes = await fetch(`${base}/api/data`, { signal: AbortSignal.timeout(15_000) });
  const dataText = await dataRes.text();
  let data;
  try {
    data = JSON.parse(dataText);
  } catch {
    console.log('GET /api/data', dataRes.status, dataText.slice(0, 200));
    process.exit(1);
  }
  console.log('GET /api/data', dataRes.status, {
    ok: data.ok,
    stale: data.stale,
    cacheAgeSec: data.cacheAge,
    staleThresholdMin: data.staleThresholdMin,
    expectsHomePush: data.expectsHomePush,
    notifCount: data.data?.notifications?.length,
  });

  // Push probe: wrong secret → 403 (proves route + firewall)
  const bad = await fetch(`${base}/api/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: '___wrong___', data: { ok: true, data: { usefulLinks: [], notifications: [] } } }),
    signal: AbortSignal.timeout(15_000),
  });
  const badTxt = await bad.text();
  console.log('POST /api/push (wrong secret)', bad.status, badTxt.slice(0, 120));
  if (bad.status !== 403) {
    console.warn('Expected 403 for wrong secret — check VPS / nginx');
  }

  // Do not POST real data here (would overwrite production cache). push_loop proves successful push.
  console.log('Tip: if stale=true, inspect the push_loop window or run: node scrape_and_push.mjs when push_loop is stopped');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
