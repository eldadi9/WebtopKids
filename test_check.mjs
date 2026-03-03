#!/usr/bin/env node
/** Quick technical check - run: node test_check.mjs */
const BASE = process.env.TEST_URL || 'http://76.13.8.113:3001';

async function fetchJson(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    if (text.startsWith('<')) return { error: r.status === 404 ? '404' : 'HTML response' };
    try { return JSON.parse(text); } catch (_) { return { error: 'not JSON' }; }
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  console.log('\n=== WebtopKids בדיקה טכנית ===\n');
  console.log(`בדיקה: ${BASE}\n`);

  const checks = [];

  // 1. /api/status
  const status = await fetchJson('/api/status');
  const statusOk = status && !status.error;
  checks.push({ name: 'GET /api/status', ok: statusOk, detail: statusOk ? 'OK' : (status?.error || 'fail') });
  if (statusOk) console.log('✓ /api/status —', typeof status === 'object' ? 'OK' : status);

  // 2. /api/data
  const data = await fetchJson('/api/data');
  const dataOk = data && !data.error && (data.ok !== false || data.pushRequired);
  const notifCount = data?.data?.notifications?.length ?? '?';
  const linkCount = data?.data?.usefulLinks?.length ?? 0;
  const hasBadLinks = (data?.data?.usefulLinks || []).some(l => (l.href || '').includes('forgotPassword'));
  checks.push({ name: 'GET /api/data', ok: dataOk, detail: dataOk ? `${notifCount} התראות, ${linkCount} קישורים` : (data?.error || (data?.pushRequired ? 'no cache' : 'fail')) });

  // 3. /api/status/system (if exists - new endpoint)
  const sys = await fetchJson('/api/status/system');
  const sysOk = sys && sys.ok !== false && !sys.error;
  checks.push({ name: 'GET /api/status/system', ok: sysOk, detail: sysOk ? (sys.message || 'OK') : (sys?.error || '404') });

  // 4. /api/children
  const children = await fetchJson('/api/children');
  const childrenOk = children && !children.error;
  const childCount = children?.children?.length ?? 0;
  checks.push({ name: 'GET /api/children', ok: childrenOk, detail: childrenOk ? `${childCount} children` : (children?.error || 'fail') });

  // 5. /api/events
  const events = await fetchJson('/api/events');
  checks.push({ name: 'GET /api/events', ok: Array.isArray(events) || (events && !events.error) });

  // 6. /api/insights
  const insights = await fetchJson('/api/insights');
  checks.push({ name: 'GET /api/insights', ok: insights && (insights.ok !== false) && !insights.error });

  console.log('\n--- סיכום ---');
  for (const c of checks) {
    console.log(c.ok ? '✓' : '✗', c.name, c.detail ? `— ${c.detail}` : '');
  }

  const allOk = checks.every(c => c.ok);
  console.log('\n' + (allOk ? '✅ כל הבדיקות עברו' : '⚠️ יש בעיות — ראה למעלה'));
  if (hasBadLinks && dataOk) console.log('\n⚠️ הנתונים מכילים forgotPassword — כנראה דף התחברות. הרץ WEBTOP_CAPTURE=true');
  console.log('');
  process.exit(allOk ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
