/* ─── State ────────────────────────────────────────────────────────────── */
let currentFilter  = 'all';
let currentSection = 'overview';
let currentStudent = null;   // null = show all students
let lastData   = null;
let lastStatus = {};

/* ─── Pull-to-refresh state ────────────────────────────────────────────── */
let ptrStartY  = 0;
let ptrPulling = false;
const PTR_THRESHOLD = 70;

/* ─── Type labels ──────────────────────────────────────────────────────── */
const TYPE_LABEL = {
  homework:          '📚 שיעורי בית',
  homework_not_done: '⚠️ אי הכנת שיעורי בית',
  missing_equipment: '🎒 ציוד חסר',
  late:              '⏰ איחור',
  absence:           '🚫 חיסור',
  grade:             '🏅 ציון',
  general:           '📋 כללי',
};

/* ─── Fetch & init ─────────────────────────────────────────────────────── */
async function fetchAll(forceRefresh = false) {
  showSpinner(true);
  try {
    const url = forceRefresh ? '/api/data?refresh=1' : '/api/data';
    const [dataRes, statusRes] = await Promise.all([
      fetch(url),
      fetch('/api/status'),
    ]);
    lastData   = await dataRes.json();
    lastStatus = await statusRes.json();
    render(lastData, lastStatus);
  } catch (err) {
    console.error('fetchAll error:', err);
  } finally {
    showSpinner(false);
  }
}

async function refresh() {
  return fetchAll(true);
}

/* ─── Main render ──────────────────────────────────────────────────────── */
function render(data, status) {
  if (!data?.ok) return;
  const d = data.data || {};

  // Stale banner
  let staleBanner = document.querySelector('.stale-banner');
  if (data.stale) {
    if (!staleBanner) {
      staleBanner = document.createElement('div');
      staleBanner.className = 'stale-banner';
      staleBanner.textContent = '⚠️ הנתונים ישנים — לא ניתן להפעיל את הסורק כרגע';
      document.querySelector('.top-bar').after(staleBanner);
    }
  } else if (staleBanner) {
    staleBanner.remove();
  }

  // Last update time
  const ts = data.extractedAt ? new Date(data.extractedAt) : null;
  const timeStr = ts
    ? ts.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : '';
  document.getElementById('last-update').textContent = timeStr ? `⏱ ${timeStr}` : '';

  const notifications = d.notifications || [];
  const classEvents   = d.classEvents   || [];

  // Student switcher must run before rerender so currentStudent is set
  updateStudentSwitcher(notifications);
  renderStats(notifications, classEvents);
  rerender();
}

/* ─── Re-render all content (called on student/filter change too) ──────── */
function rerender() {
  if (!lastData?.ok) return;
  const d             = lastData.data || {};
  const notifications = d.notifications || [];
  const classEvents   = d.classEvents   || [];

  const visibleNotifs = currentStudent
    ? notifications.filter(n => n.student === currentStudent)
    : notifications;

  renderHomework(visibleNotifs, lastStatus);
  renderClassEvents(classEvents);
  renderFeed(visibleNotifs, currentFilter);
}

/* ─── Student switcher ─────────────────────────────────────────────────── */
function updateStudentSwitcher(notifications) {
  const names    = [...new Set(notifications.map(n => n.student).filter(Boolean))];
  const switcher = document.getElementById('student-switcher');
  const nameEl   = document.getElementById('student-name');

  if (!names.length) {
    // Fallback: strip greeting from account studentName field
    const rawName = lastData?.data?.studentName || '';
    const fallback = rawName
      .replace(/^(לילה טוב|בוקר טוב|ערב טוב)[,،,]?\s*/i, '')
      .trim() || '—';
    nameEl.textContent = fallback;
    switcher.innerHTML = '';
    return;
  }

  // Single student — just show their name, no pill UI
  if (names.length === 1) {
    if (!currentStudent) currentStudent = null;  // keep as null (= all)
    nameEl.textContent = names[0];
    switcher.innerHTML = '';
    return;
  }

  // Multiple students — show pills
  nameEl.textContent = currentStudent || 'כל התלמידים';

  switcher.innerHTML = [
    `<button class="student-pill${!currentStudent ? ' active' : ''}" data-student="">הכל</button>`,
    ...names.map(n =>
      `<button class="student-pill${currentStudent === n ? ' active' : ''}" data-student="${esc(n)}">${esc(n)}</button>`
    ),
  ].join('');

  switcher.onclick = e => {
    const pill = e.target.closest('.student-pill');
    if (!pill) return;
    currentStudent = pill.dataset.student || null;
    document.querySelectorAll('.student-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    document.getElementById('student-name').textContent = currentStudent || 'כל התלמידים';
    rerender();
  };
}

/* ─── Stats bar ────────────────────────────────────────────────────────── */
function renderStats(notifications, classEvents) {
  const hw      = notifications.filter(n => n.type === 'homework').length;
  const hwNot   = notifications.filter(n => n.type === 'homework_not_done').length;
  const late    = notifications.filter(n => n.type === 'late').length;
  const absence = notifications.filter(n => n.type === 'absence').length;
  const missing = notifications.filter(n => n.type === 'missing_equipment').length;
  const grade   = notifications.filter(n => n.type === 'grade').length;

  const chips = [
    hw      ? `📚 ${hw}`      : null,
    hwNot   ? `⚠️ ${hwNot}`  : null,
    late    ? `⏰ ${late}`    : null,
    absence ? `🚫 ${absence}` : null,
    missing ? `🎒 ${missing}` : null,
    grade   ? `🏅 ${grade}`   : null,
    classEvents.length ? `📋 ${classEvents.length}` : null,
  ].filter(Boolean);

  document.getElementById('stats-bar').innerHTML = chips
    .map(c => `<span class="stat-chip">${c}</span>`)
    .join('');
}

/* ─── Homework (renders into overview + hw-only section) ───────────────── */
function renderHomework(notifications, status) {
  const hwItems = notifications
    .filter(n => n.type === 'homework' && n.date)
    .sort((a, b) => dateSortKey(a.date) - dateSortKey(b.date));

  const html = hwItems.length
    ? hwItems.map(n => {
        const id   = homeworkId(n);
        const done = !!(status[id]?.done);
        return hwCard(n, id, done);
      }).join('')
    : '<div class="empty">אין שיעורי בית 🎉</div>';

  const overviewEl = document.getElementById('hw-list-overview');
  const hwOnlyEl   = document.getElementById('hw-list-hw');
  if (overviewEl) overviewEl.innerHTML = html;
  if (hwOnlyEl)   hwOnlyEl.innerHTML   = html;
}

function hwCard(n, id, done) {
  const btnLabel = done ? '✅ הושלם' : '✓ סמן כהושלם';
  const btnClass = done ? 'btn-done done' : 'btn-done';
  const cardCls  = `card type-homework${done ? ' done-card' : ''}`;

  const meta = [
    n.date,
    n.lesson   ? `שיעור ${n.lesson}` : null,
    n.student  ? `👤 ${n.student}`   : null,
  ].filter(Boolean).join(' | ');

  const hwHtml = n.homeworkText
    ? `<div class="hw-text">📝 ${esc(n.homeworkText)}</div>`
    : '';

  return `
    <div class="${cardCls}" data-hw-id="${esc(id)}">
      <div class="card-header">
        <span class="card-title">${esc(n.subject || '?')}</span>
        <button class="${btnClass}"
          data-id="${esc(id)}"
          data-hw-text="${esc(n.homeworkText || '')}"
          data-student="${esc(n.student || '')}"
          onclick="handleMarkDone(this)"
          ${done ? 'disabled' : ''}>${btnLabel}</button>
      </div>
      <div class="card-meta">${esc(meta)}</div>
      ${hwHtml}
    </div>`;
}

/* ─── Class events (renders into overview + events-only section) ────────── */
function renderClassEvents(classEvents) {
  const real = classEvents.filter(e => !e.includes('לא נמצאו'));
  const html = real.length
    ? real.map(eventCard).join('')
    : '<div class="empty">אין אירועי שיעור</div>';

  const overviewEl = document.getElementById('events-list-overview');
  const eventsEl   = document.getElementById('events-list-events');
  if (overviewEl) overviewEl.innerHTML = html;
  if (eventsEl)   eventsEl.innerHTML   = html;
}

function eventCard(raw) {
  let type = 'general';
  if      (raw.includes('חוסר ציוד'))                              type = 'missing_equipment';
  else if (raw.includes('אי הכנת שיעורי'))                          type = 'homework_not_done';
  else if (raw.includes('שיעורי-בית') || raw.includes('שיעורי בית')) type = 'homework';
  else if (raw.includes('איחור'))                                   type = 'late';
  else if (raw.includes('חיסור') || raw.includes('נעדר'))           type = 'absence';
  else if (raw.includes('ציון'))                                    type = 'grade';

  const label     = TYPE_LABEL[type] || TYPE_LABEL.general;
  const truncated = raw.length > 200 ? raw.slice(0, 200) + '...' : raw;

  return `
    <div class="card type-${type}">
      <div class="card-header">
        <span class="badge badge-${type}">${label}</span>
      </div>
      <div class="card-desc">${esc(truncated)}</div>
    </div>`;
}

/* ─── Notifications feed ───────────────────────────────────────────────── */
function renderFeed(notifications, filter) {
  const filtered = filter === 'all'
    ? notifications
    : notifications.filter(n => n.type === filter);

  const container = document.getElementById('feed-list');
  if (!container) return;

  container.innerHTML = filtered.length
    ? filtered.map(feedCard).join('')
    : '<div class="empty">אין התראות</div>';
}

function feedCard(n) {
  const label = TYPE_LABEL[n.type] || TYPE_LABEL.general;
  const meta  = [
    n.date,
    n.lesson    ? `שיעור ${n.lesson}` : null,
    n.alertTime ? n.alertTime         : null,
    n.student   ? `👤 ${n.student}`  : null,
  ].filter(Boolean).join(' | ');

  const hwHtml = n.homeworkText
    ? `<div class="hw-text">📝 ${esc(n.homeworkText)}</div>`
    : '';

  return `
    <div class="card type-${n.type || 'general'}">
      <div class="card-header">
        <span class="card-title">${esc(n.subject || n.student || '?')}</span>
        <span class="badge badge-${n.type || 'general'}">${label}</span>
      </div>
      <div class="card-meta">${esc(meta)}</div>
      ${hwHtml}
      <div class="card-desc">${esc((n.description || '').slice(0, 200))}</div>
    </div>`;
}

/* ─── Mark done — FIXED: POST body instead of URL param ────────────────── */
function handleMarkDone(btn) {
  if (btn.disabled) return;
  markDone(btn.dataset.id, btn.dataset.hwText, btn.dataset.student, btn);
}

async function markDone(id, homeworkText, studentName, btn) {
  btn.disabled    = true;
  btn.textContent = '...';

  try {
    const res = await fetch('/api/homework/done', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, homeworkText, studentName }),
    });
    const result = await res.json();

    if (result.ok) {
      lastStatus[id] = { done: true };

      // Update ALL cards that share this homework id (overview + hw section)
      document.querySelectorAll('.card[data-hw-id]').forEach(card => {
        if (card.dataset.hwId === id) {
          card.classList.add('done-card');
          const title = card.querySelector('.card-title');
          if (title) title.style.textDecoration = 'line-through';
          const cardBtn = card.querySelector('.btn-done');
          if (cardBtn) {
            cardBtn.textContent = '✅ הושלם';
            cardBtn.className   = 'btn-done done';
            cardBtn.disabled    = true;
          }
        }
      });
    } else {
      throw new Error(result.error || 'שגיאה לא ידועה');
    }
  } catch (err) {
    console.error('markDone error:', err);
    btn.disabled    = false;
    btn.textContent = '✓ סמן כהושלם';
  }
}

/* ─── Section tab navigation ───────────────────────────────────────────── */
document.getElementById('section-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.stab');
  if (!btn) return;
  const section = btn.dataset.section;

  // Update active tab style
  document.querySelectorAll('.stab').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');

  // Show the correct page section
  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const target = document.getElementById(`section-${section}`);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  // Show filter tabs only in the feed section
  document.getElementById('filter-tabs').classList.toggle('hidden', section !== 'feed');

  currentSection = section;

  // Scroll content to just below the sticky top bar
  const topH = document.querySelector('.top-bar').offsetHeight;
  window.scrollTo({ top: topH, behavior: 'smooth' });
});

/* ─── Filter tabs (inside feed section) ────────────────────────────────── */
document.getElementById('filter-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentFilter = tab.dataset.filter;

  if (lastData) {
    const notifications = lastData.data?.notifications || [];
    const visible = currentStudent
      ? notifications.filter(n => n.student === currentStudent)
      : notifications;
    renderFeed(visible, currentFilter);
  }
});

/* ─── Pull-to-refresh (touch) ──────────────────────────────────────────── */
const ptrEl     = document.getElementById('ptr');
const ptrTextEl = document.getElementById('ptr-text');

document.addEventListener('touchstart', e => {
  if (window.scrollY === 0) {
    ptrStartY  = e.touches[0].clientY;
    ptrPulling = true;
  }
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!ptrPulling) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy > 10 && window.scrollY === 0) {
    ptrEl.classList.add('visible');
    ptrTextEl.textContent = dy > PTR_THRESHOLD ? 'שחרר לרענון ↑' : 'משוך למטה לרענון';
  } else {
    ptrEl.classList.remove('visible');
  }
}, { passive: true });

document.addEventListener('touchend', async e => {
  if (!ptrPulling) return;
  ptrPulling = false;
  const dy = e.changedTouches[0].clientY - ptrStartY;
  if (dy > PTR_THRESHOLD && window.scrollY === 0) {
    ptrEl.classList.add('refreshing');
    ptrTextEl.textContent = 'מרענן...';
    await refresh();
    ptrEl.classList.remove('visible', 'refreshing');
    ptrTextEl.textContent = 'משוך למטה לרענון';
  } else {
    ptrEl.classList.remove('visible');
  }
}, { passive: true });

/* ─── Helpers ──────────────────────────────────────────────────────────── */
function showSpinner(show) {
  document.getElementById('spinner').classList.toggle('hidden', !show);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function homeworkId(n) {
  return `${n.subject || ''}_${n.date || ''}_${n.lesson || ''}`;
}

function dateSortKey(dateStr) {
  if (!dateStr) return 0;
  const [d, m, y] = dateStr.split('/');
  return parseInt(`${y}${m}${d}`, 10) || 0;
}

/* ─── Auto-refresh every 15 min ────────────────────────────────────────── */
setInterval(fetchAll, 15 * 60 * 1000);

/* ─── Init ──────────────────────────────────────────────────────────── */
fetchAll();
