#!/usr/bin/env node
/** Quick technical check - run: node test_check.mjs */
const BASE = process.env.TEST_URL || 'http://localhost:3000';

async function fetchJson(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    if (text.startsWith('<')) return { error: r.status === 404 ? '404' : 'HTML response' };
    try { return JSON.parse(text); } catch (_) { return { error: 'not JSON' }; }
  } catch (e) {
    const m = e?.message || '';
    const msg = (m.includes('fetch failed') || m.includes('ECONNREFUSED'))
      ? 'השרת לא רץ' : m || 'שגיאה';
    return { error: msg };
  }
}

async function main() {
  console.log('\n=== WebtopKids בדיקה טכנית ===\n');
  console.log(`בדיקה: ${BASE}\n`);

  const checks = [];

  const status = await fetchJson('/api/status');
  checks.push({ name: 'GET /api/status', ok: status && !status.error, detail: status?.error || 'OK' });

  const data = await fetchJson('/api/data');
  const dataOk = data && (data.ok === true || data.pushRequired);
  const notifCount = data?.data?.notifications?.length ?? '?';
  const linkCount = data?.data?.usefulLinks?.length ?? 0;
  const hasBadLinks = (data?.data?.usefulLinks || []).some(l => (l.href || '').includes('forgotPassword'));
  checks.push({ name: 'GET /api/data', ok: dataOk, detail: dataOk ? `${notifCount} התראות, ${linkCount} קישורים` : (data?.error || 'no cache') });

  const sys = await fetchJson('/api/status/system');
  if (!sys?.error) {
    checks.push({ name: 'GET /api/status/system', ok: sys?.ok !== false, detail: sys?.message || 'OK' });
  }

  const children = await fetchJson('/api/children');
  const childCount = children?.children?.length ?? 0;
  checks.push({ name: 'GET /api/children', ok: !children?.error, detail: `${childCount} ילדים` });

  const events = await fetchJson('/api/events');
  checks.push({ name: 'GET /api/events', ok: Array.isArray(events) || !events?.error });

  const insights = await fetchJson('/api/insights');
  checks.push({ name: 'GET /api/insights', ok: insights?.ok !== false && !insights?.error });

  console.log('--- סיכום ---');
  for (const c of checks) {
    console.log(c.ok ? '✓' : '✗', c.name, '—', c.detail || '');
  }

  const allOk = checks.every(c => c.ok);
  console.log('\n' + (allOk ? '✅ כל הבדיקות עברו' : '⚠️ יש בעיות'));
  if (hasBadLinks && dataOk) console.log('\n⚠️ נתונים מכילים forgotPassword — הרץ WEBTOP_CAPTURE=true');
  console.log('');
  process.exit(allOk ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
