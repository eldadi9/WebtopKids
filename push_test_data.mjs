#!/usr/bin/env node
/**
 * push_test_data.mjs — דחיפת נתוני בדיקה ל-VPS
 * שימוש: node push_test_data.mjs
 * דוחף נתונים תקינים כדי לוודא שהאפליקציה עובדת כשאין סריקה פעילה.
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

const VPS_URL = (process.env.VPS_URL || 'http://76.13.8.113:3001').replace(/\/$/, '');
const PUSH_SECRET = process.env.PUSH_SECRET || 'webtop2026';

const SAMPLE_DATA = {
  ok: true,
  data: {
    studentName: "גונשרוביץ אלדד",
    classEvents: ["שיעורי יום, 02/03/2026 – תרגול שיעור 1", "שיעור יום מיקודי, 26/02/2026 – אירוע שיעור 3"],
    classEventsByStudent: {
      "יולי": ["שיעורי יום – תרגול שיעור 1"],
      "אמי": ["שיעור מיקודי – אירוע שיעור 2"]
    },
    homework: ["להשלים תרגילי בית במתמטיקה"],
    grades: ["מתמטיקה: 85", "שפה: 92"],
    tables: [],
    notifications: [
      { student: "יולי", type: "homework", subject: "מתמטיקה", date: "03/03/2026", description: "שיעורי בית", alertDay: "יום שלישי" },
      { student: "אמי", type: "general", subject: "שפה", date: "02/03/2026", description: "מילה טובה", alertDay: "יום שני" }
    ],
    messages: [{ from: "מחנכת", subject: "הודעה חשובה", date: "01/03/2026", body: "תוכן", read: false }],
    schoolEvents: [{ name: "פורים", type: "event" }],
    signoffs: [{ details: "אישור טיול כיתתי – 15/03/2026" }],
    usefulLinks: [
      { text: "ריכוז מידע", href: "/dashboard" },
      { text: "כרטיס תלמיד", href: "/Student_Card" },
      { text: "תיבת הודעות", href: "/Messages" },
      { text: "יומן פגישות", href: "/mettingsScheduale" },
      { text: "התראות", href: "/notification" },
      { text: "עזרה", href: "https://www.webtop.co.il/applications/zendesk/" }
    ]
  },
  count: 2
};

async function main() {
  console.log('דוחף נתוני בדיקה ל-VPS...');
  const res = await fetch(`${VPS_URL}/api/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: PUSH_SECRET, data: SAMPLE_DATA }),
    signal: AbortSignal.timeout(15000)
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.ok) {
    console.log('✅ נתונים נדחפו בהצלחה. רענן את הדשבורד.');
  } else {
    console.error('❌ שגיאה:', json.error || res.status, json);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
