import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const STATUS_FILE = join(__dirname, 'homework_status.json');
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ─── In-memory cache ──────────────────────────────────────────────────────────
let cache = { data: null, timestamp: 0 };

// Track which deadline reminders were already sent this session
const sentReminders = new Set();

// ─── Homework status persistence ──────────────────────────────────────────────
function loadStatus() {
  try {
    if (existsSync(STATUS_FILE)) return JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveStatus(status) {
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

// ─── Homework ID helper (must match frontend) ─────────────────────────────────
function hwId(n) {
  return `${n.subject || ''}_${n.date || ''}_${n.lesson || ''}`;
}

// ─── Scraper runner ───────────────────────────────────────────────────────────
function runScraper() {
  return new Promise((resolve, reject) => {
    const scraperPath = join(__dirname, 'webtop_scrape.mjs');
    const env = {
      ...process.env,
      WEBTOP_SESSION: join(__dirname, '.webtop_session.json'),
    };

    // Use the same node binary running the server — avoids PATH issues on Windows
    const proc = spawn(process.execPath, [scraperPath], { env, cwd: __dirname });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => (stdout += d));
    proc.stderr.on('data', d => (stderr += d));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 500)}`));
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        reject(new Error(`JSON parse failed: ${stdout.slice(0, 300)}`));
      }
    });
  });
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}

// ─── Deadline reminder scheduler ──────────────────────────────────────────────
function startDeadlineReminders() {
  async function checkDeadlines() {
    if (!cache.data?.data?.notifications) return;
    const status = loadStatus();
    const now = new Date();

    const notifications = cache.data.data.notifications;
    for (const n of notifications) {
      if (n.type !== 'homework' || !n.date) continue;
      const id = hwId(n);
      if (status[id]?.done) continue;       // already done
      if (sentReminders.has(id)) continue;  // reminder already sent this session

      // Parse "DD/MM/YYYY"
      const [dd, mm, yyyy] = n.date.split('/').map(Number);
      if (!dd || !mm || !yyyy) continue;
      const hwDate = new Date(yyyy, mm - 1, dd);
      const daysLeft = (hwDate - now) / (1000 * 60 * 60 * 24);

      // Send if 0 < daysLeft ≤ 1 (due tomorrow or sooner, but not already past)
      if (daysLeft > 0 && daysLeft <= 1) {
        sentReminders.add(id);
        const textLines = [
          `⏰ <b>תזכורת — שיעורי בית!</b>`,
          `📚 מקצוע: ${n.subject || '?'}`,
          `👦 תלמיד: ${n.student || '?'}`,
          `📅 מועד הגשה: ${n.date} (שיעור ${n.lesson || '?'})`,
          n.homeworkText ? `📝 תוכן: ${n.homeworkText}` : '',
          `⚠️ לא סומן כהושלם עדיין!`,
        ].filter(Boolean).join('\n');
        await sendTelegram(textLines);
      }
    }
  }

  // Run at startup (after 1 min delay) and every hour
  setTimeout(checkDeadlines, 60 * 1000);
  setInterval(checkDeadlines, 60 * 60 * 1000);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/data — scraper with 15-min cache
app.get('/api/data', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';
  const now = Date.now();

  if (!forceRefresh && cache.data && now - cache.timestamp < CACHE_TTL_MS) {
    return res.json({ ...cache.data, cached: true, cacheAge: Math.round((now - cache.timestamp) / 1000) });
  }

  try {
    const result = await runScraper();
    cache = { data: result, timestamp: now };
    res.json({ ...result, cached: false });
  } catch (err) {
    if (cache.data) {
      return res.json({ ...cache.data, cached: true, stale: true, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/status — homework done/undone map
app.get('/api/status', (req, res) => {
  res.json(loadStatus());
});

// POST /api/homework/done — ID in request body (avoids Hebrew '/' in URL routing)
app.post('/api/homework/done', async (req, res) => {
  const { id, homeworkText, studentName } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });

  const status = loadStatus();
  const now = new Date();
  const parts = id.split('_');
  const subject = parts[0] || '?';
  const date    = parts[1] || '?';
  const lesson  = parts[2] || '?';

  const timeStr = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('he-IL');

  status[id] = { done: true, markedAt: now.toISOString() };
  saveStatus(status);

  // Mark reminder as sent so we don't re-remind
  sentReminders.add(id);

  const lines = [
    `✅ <b>שיעורי בית הושלמו!</b>`,
    studentName ? `👦 תלמיד: ${studentName}` : '',
    `📚 מקצוע: ${subject}`,
    `📅 תאריך: ${date} | שיעור ${lesson}`,
    homeworkText ? `📝 תוכן: ${homeworkText}` : '',
    `⏰ סומן: ${timeStr} ${dateStr}`,
  ].filter(Boolean).join('\n');

  await sendTelegram(lines);
  res.json({ ok: true, id, done: true });
});

// POST /api/homework/undone — unmark
app.post('/api/homework/undone', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
  const status = loadStatus();
  delete status[id];
  saveStatus(status);
  sentReminders.delete(id);
  res.json({ ok: true, id, done: false });
});

// Fallback → index.html
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Webtop dashboard running on http://localhost:${PORT}`);
  startDeadlineReminders();
});
