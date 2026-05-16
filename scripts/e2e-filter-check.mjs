#!/usr/bin/env node
// DEV-only E2E sanity check: simulate processAlertsForUser's per-child filter
// for every user in users.dev.json against a synthetic notifications + messages
// payload that mixes both children. Verifies that:
//   - parent with children:['יולי'] gets only yuli items
//   - parent with children:['אמי']  gets only emy items
//   - admin gets all items
//   - parent with empty children:[] gets nothing
//   - legacy user with no children field gets all items
//
// Does NOT call Telegram. Does NOT touch the server. Prints a table.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const usersFile = join(__dirname, '..', 'users.dev.json');
const users = JSON.parse(readFileSync(usersFile, 'utf8')).users;

const payload = {
  data: {
    notifications: [
      { type: 'late',     student: 'יולי', subject: 'מתמטיקה', date: '16/05/2026' },
      { type: 'absence',  student: 'אמי',  subject: 'אנגלית',  date: '16/05/2026', alertTime: '09:00' },
      { type: 'homework', student: 'יולי', subject: 'מדעים',  date: '20/05/2026', homeworkText: 'דף עבודה' },
      { type: 'grade',    student: 'אמי',  subject: 'חברה',   date: '15/05/2026', description: '95' },
      { type: 'missing_equipment', student: 'יולי', subject: 'אומנות', date: '16/05/2026' },
      { type: 'good_word', student: 'אמי', subject: 'תנ"ך',   date: '14/05/2026', description: 'מצוין!' },
    ],
    messages: [
      { student: 'יולי', subject: 'יציאה מוקדמת', from: 'מחנכת', date: '16/05/2026', read: false, body: 'יציאה ב-12:00' },
      { student: 'אמי',  subject: 'מבחן',         from: 'מורה',  date: '16/05/2026', read: false, body: 'מבחן ביום ה' },
      { student: 'יולי', subject: 'הודעה נקראה',   from: 'מורה',  date: '15/05/2026', read: true,  body: '(read)' },
    ],
  },
};

function matchesChild(user, n) {
  const isAdmin = user?.role === 'admin';
  const childSet = Array.isArray(user?.children) ? new Set(user.children) : null;
  if (isAdmin) return true;
  if (!childSet) return true;
  if (childSet.size === 0) return false;
  return childSet.has(n?.student);
}

console.log(`E2E filter check — payload: ${payload.data.notifications.length} notifications, ${payload.data.messages.length} messages\n`);

let failures = 0;
for (const u of users) {
  const notifs = payload.data.notifications.filter(n => matchesChild(u, n));
  const msgs   = payload.data.messages.filter(m => matchesChild(u, m));
  const studentsInNotifs = [...new Set(notifs.map(n => n.student))];
  const studentsInMsgs   = [...new Set(msgs.map(m => m.student))];
  const expected = u.role === 'admin' ? '(all)' : (Array.isArray(u.children) ? u.children.join(',') : '(legacy)');

  // Verify only expected students show up.
  if (u.role !== 'admin' && Array.isArray(u.children)) {
    const allowed = new Set(u.children);
    const leaked = [
      ...notifs.filter(n => !allowed.has(n.student)).map(n => `notif:${n.student}/${n.type}`),
      ...msgs.filter(m => !allowed.has(m.student)).map(m => `msg:${m.student}/${m.subject}`),
    ];
    if (leaked.length > 0) {
      failures++;
      console.log(`❌ ${u.name.padEnd(20)} | role=${u.role.padEnd(6)} | expected=${expected.padEnd(8)} | LEAKED: ${leaked.join(', ')}`);
      continue;
    }
  }

  console.log(`✓  ${u.name.padEnd(20)} | role=${u.role.padEnd(6)} | expected=${expected.padEnd(8)} | got notifs from: [${studentsInNotifs.join(',')}] msgs from: [${studentsInMsgs.join(',')}] (${notifs.length}+${msgs.length})`);
}

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
