#!/usr/bin/env node
/**
 * test_send_telegram.mjs — שולח את כל ההתראות לטלגרם לפי הסדר (בדיקת תקינות אמיתית)
 * דורש: שרת רץ + TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID ב-.env
 * שימוש: node test_send_telegram.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const p = join(__dirname, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !process.env[k]) process.env[k] = v;
  }
}
loadEnv();

let BASE = process.env.TEST_URL || process.env.VPS_URL || 'http://localhost:3000';
if (BASE.includes('/api/push')) BASE = BASE.replace(/\/api\/push.*$/, '');
BASE = BASE.replace(/\/$/, '');
const PUSH_SECRET = process.env.PUSH_SECRET || 'webtop2026';
const ts = Date.now(); // ייחודי לכל הרצה

const USEFUL_LINKS = [
  { text: 'התראות', href: '/notification' },
  { text: 'דשבורד', href: '/dashboard' },
];

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function push(data) {
  const res = await fetch(`${BASE}/api/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: PUSH_SECRET, data }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

async function homeworkDone(id, body) {
  const res = await fetch(`${BASE}/api/homework/done`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

const results = [];

async function run() {
  console.log('\n=== שליחת התראות לטלגרם — בדיקת תקינות ===\n');
  console.log(`שרת: ${BASE}\n`);

  const basePayload = () => ({
    ok: true,
    data: {
      studentName: 'בדיקה',
      classEvents: [],
      usefulLinks: USEFUL_LINKS,
      notifications: [],
      messages: [],
    },
  });

  const order = [
    { name: '1. late (איחור)', fn: async () => {
      const p = basePayload();
      p.data.notifications = [{ student: 'בדיקה', type: 'late', subject: `מתמטיקה_${ts}`, date: futureDate(5), lesson: 1, alertDay: 'יום שני' }];
      return push(p);
    }},
    { name: '2. absence (חיסור)', fn: async () => {
      const p = basePayload();
      p.data.notifications = [{ student: 'בדיקה', type: 'absence', subject: `עברית_${ts}`, date: futureDate(5), lesson: 2, alertTime: '10:30', alertDay: 'יום שני' }];
      return push(p);
    }},
    { name: '3. missing_equipment (ציוד חסר)', fn: async () => {
      const p = basePayload();
      p.data.notifications = [{ student: 'בדיקה', type: 'missing_equipment', subject: `ספורט_${ts}`, date: futureDate(5), lesson: 3, alertDay: 'יום שני' }];
      return push(p);
    }},
    { name: '4. grade (ציון חדש)', fn: async () => {
      const p = basePayload();
      p.data.notifications = [{ student: 'בדיקה', type: 'grade', subject: `מדעים_${ts}`, date: futureDate(5), description: 'ציון 92', alertDay: 'יום שני' }];
      return push(p);
    }},
    { name: '5. homework_not_done (שיעורי בית לא הוכנו)', fn: async () => {
      const p = basePayload();
      p.data.notifications = [{ student: 'בדיקה', type: 'homework_not_done', subject: `מתמטיקה_${ts}`, date: futureDate(2), description: 'לא הכין תרגיל 5', lesson: 1, alertDay: 'יום שני' }];
      return push(p);
    }},
    { name: '6. homework (שיעורי בית חדשים)', fn: async () => {
      const p = basePayload();
      p.data.notifications = [{ student: 'בדיקה', type: 'homework', subject: `מתמטיקה_${ts}`, date: futureDate(5), homeworkText: 'להשלים תרגיל 7', lesson: 1, alertDay: 'יום שני' }];
      return push(p);
    }},
    { name: '7. message (הודעה מהמורה)', fn: async () => {
      const p = basePayload();
      p.data.messages = [{ from: 'מחנכת בדיקה', subject: `הודעה בדיקה ${ts}`, date: futureDate(0), body: 'זו הודעת בדיקה', read: false }];
      return push(p);
    }},
    { name: '8. homework_complete (הושלם)', fn: async () => {
      const id = `מתמטיקה_${ts}_${futureDate(5)}_1`;
      return homeworkDone(id, { id, homeworkText: 'תרגיל בדיקה', studentName: 'בדיקה', subject: 'מתמטיקה', date: futureDate(5), lesson: 1 });
    }},
  ];

  for (const { name, fn } of order) {
    try {
      const { ok, json } = await fn();
      const status = ok && (json.ok !== false) ? '✓ נשלח' : `✗ ${json.error || 'שגיאה'}`;
      results.push({ name, ok, status });
      console.log(`${ok ? '✓' : '✗'} ${name} — ${status}`);
      await new Promise(r => setTimeout(r, 800)); // הפסקה בין שליחות
    } catch (e) {
      results.push({ name, ok: false, status: e.message });
      console.log(`✗ ${name} — שגיאה: ${e.message}${e.cause ? ` (${e.cause.message})` : ''}`);
    }
  }

  console.log('\n--- סטטוס תקינות ---');
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`✅ נשלחו: ${passed}`);
  if (failed) console.log(`❌ נכשלו: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ כל ההתראות נשלחו לטלגרם' : '⚠️ בדוק חיבור לשרת ו-TELEGRAM_BOT_TOKEN'}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
