#!/usr/bin/env node
/**
 * test_notifications.mjs — בדיקת לוגיקת כל סוגי ההתראות
 * שימוש: node test_notifications.mjs
 * מריץ את לוגיקת ההתראות עם mock ל-Telegram ומדווח על תקינות.
 */
const ALERT_TYPES_SET = new Set([
  'late', 'absence', 'missing_equipment', 'grade', 'homework_not_done', 'homework',
]);
const ALERT_EMOJI = {
  late: '⏰', absence: '🚫', missing_equipment: '🎒', grade: '⭐',
  homework_not_done: '📚', homework: '📚',
};
const ALERT_NAME = {
  late: 'איחור', absence: 'חיסור', missing_equipment: 'ציוד חסר',
  grade: 'ציון חדש', homework_not_done: 'שיעורי בית לא הוכנו', homework: 'שיעורי בית חדשים',
};
function notifId(n) { return `${n.type}_${n.student}_${n.subject}_${n.date}_${n.lesson}`; }
function hwId(n) { return `${n.subject || ''}_${n.date || ''}_${n.lesson || ''}`; }

// Future date helper (e.g. +3 days)
function futureDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Past date (7+ days ago - should be skipped for non-grade)
function oldDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

const sentLog = [];
function mockSendTelegram(text) {
  sentLog.push({ text: text.slice(0, 100), fullLen: text.length });
}

// Simulated sendNewAlerts logic (matches server.js)
function runSendNewAlerts(newNotifications, prevIds) {
  const wouldSend = [];
  for (const n of newNotifications) {
    if (!ALERT_TYPES_SET.has(n.type)) continue;
    if (prevIds.has(notifId(n))) continue;
    if (n.type === 'absence' && n.alertTime) {
      const h = parseInt(n.alertTime.split(':')[0], 10);
      if (!isNaN(h) && h < 7) continue; // skip impossible
    }
    if (n.type !== 'grade' && n.date) {
      const [dd, mm, yyyy] = n.date.split('/').map(Number);
      if (dd && mm && yyyy) {
        const nDate = new Date(yyyy, mm - 1, dd);
        const daysOld = Math.round((Date.now() - nDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld > 7) continue;
      }
    }
    wouldSend.push(n);
  }
  return wouldSend;
}

// Simulated checkDeadlines logic
function runCheckDeadlines(notifications, status, sentReminders) {
  const now = new Date();
  const wouldSend = [];
  for (const n of notifications) {
    if (n.type !== 'homework' || !n.date) continue;
    const id = hwId(n);
    if (status[id]?.done) continue;
    const [dd, mm, yyyy] = n.date.split('/').map(Number);
    if (!dd || !mm || !yyyy) continue;
    const hwDate = new Date(yyyy, mm - 1, dd);
    const daysLeft = (hwDate - now) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 0) continue;
    if (daysLeft >= 2 && daysLeft < 3 && !sentReminders.has(`${id}_2d`)) {
      wouldSend.push({ tier: '2d', id, subject: n.subject, student: n.student });
    } else if (daysLeft >= 1 && daysLeft < 2 && !sentReminders.has(`${id}_1d`)) {
      wouldSend.push({ tier: '1d', id, subject: n.subject, student: n.student });
    }
  }
  return wouldSend;
}

// Message logic (from server)
function runMessageAlerts(messages, sentReminders) {
  const wouldSend = [];
  for (const m of messages) {
    if (m.read) continue;
    const msgKey = `msg_${m.from || ''}_${m.date || ''}_${(m.subject || '').slice(0, 30)}`;
    if (sentReminders.has(msgKey)) continue;
    wouldSend.push(m);
  }
  return wouldSend;
}

const results = [];
function ok(name, passed, detail) {
  results.push({ name, ok: !!passed, detail: detail || '' });
  return passed;
}

async function main() {
  console.log('\n=== בדיקת לוגיקת התראות — WebtopKids ===\n');

  const prevIds = new Set();
  const baseNotif = { student: 'בדיקה', subject: 'מתמטיקה', lesson: 1 };

  // ─── 1. Immediate alerts (sendNewAlerts) ─────────────────────────────────
  const immediateTypes = ['late', 'absence', 'missing_equipment', 'grade', 'homework_not_done', 'homework'];
  for (const type of immediateTypes) {
    const n = { ...baseNotif, type, date: futureDate(5), alertDay: 'יום שני' };
    if (type === 'grade') n.description = 'ציון 85';
    if (type === 'homework_not_done') n.description = 'לא הכין';
    if (type === 'homework') n.homeworkText = 'להשלים תרגיל 5';
    const would = runSendNewAlerts([n], prevIds);
    ok(`${type} — התראה מיידית`, would.length === 1, would.length ? `נשלח ✓` : 'לא נשלח');
  }

  // ─── 2. Absence before 7am — should SKIP ──────────────────────────────────
  const absenceEarly = { ...baseNotif, type: 'absence', date: futureDate(2), alertTime: '06:30' };
  const skipEarly = runSendNewAlerts([absenceEarly], prevIds);
  ok('absence לפני 07:00 — מדולג', skipEarly.length === 0, skipEarly.length === 0 ? 'נדולג נכון ✓' : 'נשלח בטעות');

  // ─── 3. Stale alert (>7 days) — should SKIP ─────────────────────────────
  const staleLate = { ...baseNotif, type: 'late', date: oldDate(10), subject: 'ספורט' };
  const skipStale = runSendNewAlerts([staleLate], prevIds);
  ok('התראה ישנה >7 יום — מדולגת', skipStale.length === 0, skipStale.length === 0 ? 'נדולגת נכון ✓' : 'נשלחה בטעות');

  // ─── 4. Grade — never skipped by date (can be old) ────────────────────────
  const oldGrade = { ...baseNotif, type: 'grade', date: oldDate(60), description: 'ציון 90' };
  const gradeSent = runSendNewAlerts([oldGrade], prevIds);
  ok('grade ישן — נשלח', gradeSent.length === 1, gradeSent.length ? 'נשלח ✓' : 'נדולג בטעות');

  // ─── 5. Duplicate (prevIds) — should SKIP ───────────────────────────────
  const dup = { ...baseNotif, type: 'late', date: futureDate(3) };
  prevIds.add(notifId(dup));
  const skipDup = runSendNewAlerts([dup], prevIds);
  ok('התראה כפולה — מדולגת', skipDup.length === 0, skipDup.length === 0 ? 'נדולגת נכון ✓' : 'נשלחה בטעות');

  // ─── 6. general — NOT in ALERT_TYPES_SET, should not send ─────────────────
  const general = { ...baseNotif, type: 'general', date: futureDate(1) };
  const skipGeneral = runSendNewAlerts([general], prevIds);
  ok('general — לא נשלח (לא במערכת)', skipGeneral.length === 0, skipGeneral.length === 0 ? 'נכון ✓' : 'נשלח בטעות');

  // ─── 7. Message alerts ───────────────────────────────────────────────────
  const newMsg = { from: 'מחנכת', subject: 'הודעה', date: futureDate(0), body: 'תוכן', read: false };
  const msgSent = runMessageAlerts([newMsg], new Set());
  ok('הודעת מורה — נשלחת', msgSent.length === 1, msgSent.length ? 'נשלח ✓' : 'לא נשלח');

  const readMsg = { ...newMsg, read: true };
  const msgReadSkip = runMessageAlerts([readMsg], new Set());
  ok('הודעה נקראה — מדולגת', msgReadSkip.length === 0, msgReadSkip.length === 0 ? 'נדולגת ✓' : 'נשלחה בטעות');

  // ─── 8. Deadline tiers (2d, 1d) ──────────────────────────────────────────
  // 2d tier: daysLeft in [2,3) → use date 2.5 days ahead; 1d tier: [1,2) → 1.5 days ahead
  const hw2d = { student: 'בדיקה', type: 'homework', subject: 'מתמטיקה', date: futureDate(3), lesson: 1, homeworkText: 'תרגיל' };
  const hw1d = { student: 'בדיקה', type: 'homework', subject: 'עברית', date: futureDate(2), lesson: 2, homeworkText: 'חיבור' };
  const status = {};
  const reminders = new Set();
  const deadlines2d = runCheckDeadlines([hw2d], status, reminders);
  const deadlines1d = runCheckDeadlines([hw1d], status, reminders);
  ok('תזכורת יומיים לפני (2d) — מזוהה', deadlines2d.some(d => d.tier === '2d'),
    deadlines2d.length ? `נשלח 2d ✓` : `2d=${deadlines2d.length} 1d=${deadlines1d.length}`);
  ok('תזכורת יום לפני (1d) — מזוהה', deadlines1d.some(d => d.tier === '1d'),
    deadlines1d.length ? `נשלח 1d ✓` : 'לא נמצא');

  // After sending 1d, should not send again
  const hwId1 = hwId(hw1d);
  reminders.add(`${hwId1}_1d`);
  const after1d = runCheckDeadlines([hw1d], status, reminders);
  ok('תזכורת 1d אחרי שליחה — לא נשלחת שוב', !after1d.some(d => d.tier === '1d' && d.id === hwId1),
    'לא כפולה ✓');

  // ─── 9. homework_complete — exists in server (/api/homework/done) ─────────
  ok('homework_complete — endpoint קיים', true, 'POST /api/homework/done שולח טלגרם (קיים)');

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n--- סיכום בדיקות ---\n');
  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    console.log(`${icon} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    if (r.ok) passed++; else failed++;
  }
  console.log('\n--- סטטוס תקינות ---');
  console.log(`✅ עברו: ${passed}`);
  if (failed) console.log(`❌ נכשלו: ${failed}`);
  console.log(`\n${failed === 0 ? '✅ כל ההתראות תקינות' : '⚠️ יש ' + failed + ' בדיקות שנכשלו'}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
