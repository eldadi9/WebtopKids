/* ─── State ────────────────────────────────────────────────────────────── */
let currentSection = 'homework';
let currentStudent = null;
let lastData       = null;
let lastStatus     = {};
let lastSyncTime   = null;
let lastEvents     = [];   // special events from /api/events (birthdays, meetings)
let lastChildren   = { children: [] }; // per-child config: valid subjects, grade, birthdate
let lastInsights   = null; // smart insights from /api/insights
let lastExternalLinks = []; // external links (forms, webtop pages)
let lastSchedule = {}; // weekly schedule per student from /api/schedule

/* ─── Card data store (index → notification object) ───────────────────── */
let _cardStore = {};
let _cardIdx   = 0;

function allocCard(n) {
  const idx = _cardIdx++;
  _cardStore[idx] = n;
  return idx;
}

/* ─── Pull-to-refresh state ────────────────────────────────────────────── */
let ptrStartY  = 0;
let ptrPulling = false;
const PTR_THRESHOLD = 70;

/* ─── Fix spacing in displayed text (אתר מוציא מילים מחוברות) ────────────── */
function fixSpacingForDisplay(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/חיסוריום/g, 'חיסור יום')
    .replace(/איחוריום/g, 'איחור יום')
    .replace(/מילהטובה/g, 'מילה טובה')
    .replace(/מילה\s*טובהיום/g, 'מילה טובה יום')
    .replace(/חוסרציוד/g, 'חוסר ציוד')
    .replace(/חוסר ציוד לימודיום/g, 'חוסר ציוד לימודי יום')
    .replace(/אירועישיעור/g, 'אירועי שיעור')
    .replace(/נושאישיעור/g, 'נושאי שיעור')
    .replace(/לימודיום/g, 'לימודי יום')
    .replace(/שיעוריום/g, 'שיעורי יום')
    .replace(/ביתיום/g, 'ביית יום')
    .replace(/תפריטראשי/g, 'תפריט ראשי')
    .replace(/ריכוזמידע/g, 'ריכוז מידע')
    .replace(/תיבתהודעות/g, 'תיבת הודעות')
    .replace(/כרטיסנתלמיד/g, 'כרטיס תלמיד')
    .replace(/חתימותואישורים/g, 'חתימות ואישורים')
    .replace(/מ\.?\s*שעותושינויים/g, 'מ. שעות ושינויים')
    .replace(/ספרטלפונים/g, 'ספר טלפונים');
}

/* ─── Type labels & icons ──────────────────────────────────────────────── */
const TYPE_LABEL = {
  homework:          '📚 שיעורי בית',
  homework_not_done: '⚠️ אי הכנת שיעורי בית',
  missing_equipment: '🎒 ציוד חסר',
  late:              '⏰ איחור',
  absence:           '🚫 חיסור',
  attendance:        '✅ נוכחות',
  grade:             '🏅 ציון',
  good_word:         '🌟 מילה טובה',
  general:           '📋 כללי',
  message:           '📨 הודעה',
};

/* ─── Fetch & init ─────────────────────────────────────────────────────── */
async function fetchAll(forceRefresh = false) {
  showSpinner(true);
  showErrorBanner(false);
  try {
    const url = forceRefresh ? '/api/data?refresh=1' : '/api/data';
    const fetchOpts = { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } };
    const results = await Promise.allSettled([
      fetch(url, fetchOpts),
      fetch('/api/status', fetchOpts),
      fetch('/api/events', fetchOpts),
      fetch('/api/children', fetchOpts),
      fetch('/api/insights' + (currentStudent ? '?student=' + encodeURIComponent(currentStudent) : ''), fetchOpts),
      fetch('/api/external-links', fetchOpts),
      fetch('/api/schedule', fetchOpts),
    ]);
    const dataRes = results[0].status === 'fulfilled' ? results[0].value : null;
    const statusRes = results[1].status === 'fulfilled' ? results[1].value : null;
    const eventsRes = results[2].status === 'fulfilled' ? results[2].value : null;
    const childrenRes = results[3].status === 'fulfilled' ? results[3].value : null;
    const insightsRes = results[4].status === 'fulfilled' ? results[4].value : null;
    const extLinksRes = results[5].status === 'fulfilled' ? results[5].value : null;

    const safeJson = async (res, fallback) => {
      if (!res || !res.ok) return fallback;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return fallback;
      try { return await res.json(); } catch { return fallback; }
    };
    lastData = await safeJson(dataRes, null);
    lastData = lastData?.ok ? lastData : { ok: false, error: lastData?.error || 'No data' };
    lastStatus = await safeJson(statusRes, {});
    lastEvents = await safeJson(eventsRes, []);
    lastChildren = await safeJson(childrenRes, { children: [] });
    lastInsights = await safeJson(insightsRes, null);
    const ext = await safeJson(extLinksRes, { links: [] });
    lastExternalLinks = ext?.links || [];
    const scheduleRes = results[6].status === 'fulfilled' ? results[6].value : null;
    const scheduleData = await safeJson(scheduleRes, { ok: false, schedule: {} });
    lastSchedule = scheduleData?.schedule || {};
    if (!Array.isArray(lastEvents)) lastEvents = [];

    if (!lastData?.ok) {
      showErrorBanner(true);
    } else {
      showErrorBanner(false); /* ensure banner hidden when we have valid data */
    }

    lastSyncTime = new Date();
    const savedScroll = !forceRefresh ? window.scrollY : null;
    try { render(lastData, lastStatus); } catch (err) {
      console.error('render error:', err);
      showErrorBanner(true);
    }
    if (savedScroll != null) requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  } catch (err) {
    console.error('fetchAll error:', err);
    showErrorBanner(true);
    lastSyncTime = new Date();
  } finally {
    showSpinner(false);
    updateSyncTime();
  }
}

async function refresh() {
  const btn = document.getElementById('btn-refresh');
  if (btn) { btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }
  await fetchAll(true);
  if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
}

/* ─── Timestamp display ────────────────────────────────────────────────── */
function updateSyncTime() {
  const el = document.getElementById('sync-time');
  if (!el || !lastSyncTime) return;
  const t = lastSyncTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  el.textContent = `🔄 ${t}`;
  const m = document.getElementById('sync-time-mobile');
  if (m) m.textContent = el.textContent;
}

/* ─── Main render ──────────────────────────────────────────────────────── */
function render(data, status) {
  if (!data?.ok) return;
  const d = data.data || {};

  // Stale banner — shows cache age so user knows how old the data is
  let staleBanner = document.querySelector('.stale-banner');
  if (data.stale) {
    if (!staleBanner) {
      staleBanner = document.createElement('div');
      staleBanner.className = 'stale-banner';
      document.querySelector('.top-bar').after(staleBanner);
    }
    const ageMin = data.cacheAge ? Math.round(data.cacheAge / 60) : '?';
    const thr = data.staleThresholdMin != null ? data.staleThresholdMin : 45;
    const home = data.expectsHomePush !== false;
    staleBanner.textContent = home
      ? `⚠️ הנתונים ישנים (${ageMin} דק׳; מעל ~${thr} דק׳ בלי דחיפה מהבית) — משוך למטה לבקשת סריקה או ודא ש־start_daemon.bat / node push_loop.mjs רצים במחשב הבית`
      : `⚠️ הנתונים ישנים (${ageMin} דק׳) — רענון או בדוק את סקרייפר השרת (USE_LOCAL_SCRAPER)`;
  } else if (staleBanner) {
    staleBanner.remove();
  }

  // Data timestamp (when scraper last ran on local machine)
  const ts = data.extractedAt ? new Date(data.extractedAt) : null;
  const dtEl = document.getElementById('data-time');
  const dtText = ts ? `📡 ${ts.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '';
  if (dtEl) dtEl.textContent = dtText;
  const dtM = document.getElementById('data-time-mobile');
  if (dtM) dtM.textContent = dtText;

  const notifications = d.notifications || [];
  const classEvents   = resolveClassEventsForStudent(d.classEventsByStudent, currentStudent, d.classEvents);

  updateStudentSwitcher(notifications);
  // Stats use student-filtered notifications (same as tabs)
  const visibleForStats = currentStudent
    ? notifications.filter(n => studentMatch(n.student, currentStudent))
    : notifications;
  renderStats(visibleForStats, classEvents);
  renderInsights();
  rerender();
}

/* ─── Re-render all sections ───────────────────────────────────────────── */
function rerender() {
  if (!lastData?.ok) return;
  const d             = lastData.data && typeof lastData.data === 'object' ? lastData.data : {};
  const notifications = d.notifications || [];
  const classEvents   = resolveClassEventsForStudent(d.classEventsByStudent, currentStudent, d.classEvents);

  // Reset card store every full re-render
  _cardStore = {};
  _cardIdx   = 0;

  const visible = currentStudent
    ? notifications.filter(n => studentMatch(n.student, currentStudent))
    : notifications;

  renderHomework(visible, lastStatus);
  renderAlerts(visible);
  renderGrades(visible);
  renderClassEvents(classEvents);
  (() => {
    const schoolEvResolved = resolveSchoolEventsForStudent(
      lastData?.data?.schoolEventsByStudent, currentStudent, lastData?.data?.schoolEvents || []);
    const mergedEvents = [...lastEvents];
    const today = new Date();
    const todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
    for (const se of schoolEvResolved) {
      mergedEvents.push({ name: se.name, type: se.type || 'event', date: todayStr, details: se.details || '', emoji: '🏫' });
    }
    renderCalendar(visible, classEvents, mergedEvents);
  })();
  renderApprovals();
  renderMessages();
  renderSchedule();
  renderExternalLinks();
  const schoolEvResolved = resolveSchoolEventsForStudent(
    lastData?.data?.schoolEventsByStudent, currentStudent, lastData?.data?.schoolEvents || []);
  const mergedEvents = [...lastEvents];
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
  for (const se of schoolEvResolved) {
    mergedEvents.push({ name: se.name, type: se.type || 'event', date: todayStr, details: se.details || '', emoji: '🏫' });
  }
  renderFeed(visible, classEvents);
  updateTabCounts(visible, classEvents);
}

/* ─── Tab count badges ─────────────────────────────────────────────────── */
function updateTabCounts(notifications, classEvents) {
  const hw      = notifications.filter(n => n.type === 'homework' && n.date && isSubjectValid(n.student, n.subject) && !lastStatus[homeworkId(n)]?.done).length;
  const alerts  = notifications.filter(n =>
    ['late','missing_equipment','absence','homework_not_done'].includes(n.type) && isValidNotification(n)).length;
  const grades  = notifications.filter(n => n.type === 'grade').length;
  const calItems = hw
    + classEvents.filter(e => !e.includes('לא נמצאו') && isEventValidForCurrentChild(e)).length
    + lastEvents.length;

  const setTab = (id, icon, label, count) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = count > 0 ? `${icon} ${label} (${count})` : `${icon} ${label}`;
    el.classList.toggle('tab-has-data', count > 0);
  };
  const msgs = (lastData?.data?.messages || []).filter(m => !m.read).length;
  const scrapedApprovals = lastData?.data?.approvals || [];
  const pendingScraped = scrapedApprovals.filter(a => !lastStatus[approvalId(a)]?.approved).length;
  const approvals = lastEvents.filter(ev =>
    ev.type === 'event' || /אישור/.test(ev.details || '')
  ).filter(ev => !ev.childName || !currentStudent || ev.childName === currentStudent).length
    + notifications.filter(n => n.type === 'approval').length + pendingScraped;

  setTab('tab-homework',  '📚', 'שיעורי בית', hw);
  setTab('tab-alerts',    '⚠️', 'התראות',      alerts);
  setTab('tab-grades',    '🏅', 'ציונים',      grades);
  setTab('tab-calendar',  '📅', 'יומן',        calItems);
  setTab('tab-approvals', '✍️', 'אישורים',     approvals);
  setTab('tab-messages',  '📨', 'הודעות',      msgs);
  const feedCount = notifications.filter(n => (n.type !== 'homework' || isSubjectValid(n.student, n.subject)) && isValidNotification(n)).length
    + (classEvents || []).filter(e => !e.includes('לא נמצאו') && isEventValidForCurrentChild(e)).length
    + (lastData?.data?.messages || []).length
    + (lastData?.data?.approvals || []).length + (lastData?.data?.signoffs || []).length
    + lastEvents.length;
  setTab('tab-feed',      '📬', 'הכל',         feedCount);
  setTab('tab-external',  '🔗', 'אתרים חיצוניים', lastExternalLinks.length);
}

/* ─── Student switcher (dropdown) ─────────────────────────────────────── */
function updateStudentSwitcher(notifications) {
  let names = [...new Set(notifications.map(n => n.student).filter(Boolean))];
  // Fallback: use children_config when we have fewer student names in notifications
  if (names.length < 2 && lastChildren?.children?.length > 1) {
    // Use short names (last word) from children_config to match notification format
    const configNames = lastChildren.children.map(c => c.name).filter(Boolean);
    const shortNames = configNames.map(n => n.split(/\s+/).pop());
    // Prefer notification names when they exist, fill in from config for missing
    const merged = [];
    for (let i = 0; i < configNames.length; i++) {
      const notifMatch = names.find(n => studentMatch(n, configNames[i]));
      merged.push(notifMatch || shortNames[i]);
    }
    names = merged;
  }
  const switcher = document.getElementById('student-switcher');
  const nameEl   = document.getElementById('student-name');

  if (!names.length) {
    const rawName = lastData?.data?.studentName || '';
    nameEl.style.display = '';
    nameEl.textContent = rawName
      .replace(/^(לילה טוב|בוקר טוב|ערב טוב)[,،,]?\s*/i, '')
      .trim() || '—';
    switcher.innerHTML = '';
    updateChildPhoto();
    return;
  }

  if (names.length === 1) {
    currentStudent = names[0];
    nameEl.style.display = '';
    nameEl.textContent = names[0];
    switcher.innerHTML = '';
    updateChildPhoto();
    return;
  }

  // Restore from localStorage or pick first child (no "all" option)
  if (!currentStudent || !names.some(n => studentMatch(n, currentStudent))) {
    const saved = localStorage.getItem('webtop_student');
    currentStudent = (saved && names.some(n => studentMatch(n, saved))) ? saved : names[0];
  }

  // Hide the plain name span — the dropdown shows the name itself
  nameEl.textContent = '';
  nameEl.style.display = 'none';
  switcher.innerHTML = `
    <select class="child-select" id="child-select">
      ${names.map(n =>
        `<option value="${esc(n)}"${n === currentStudent ? ' selected' : ''}>${esc(n)}</option>`
      ).join('')}
    </select>`;

  document.getElementById('child-select').onchange = e => {
    currentStudent = e.target.value;
    localStorage.setItem('webtop_student', currentStudent);
    updateChildPhoto();
    rerender();
  };

  updateChildPhoto();
}

/* ─── Child photo update ────────────────────────────────────────────────── */
function updateChildPhoto() {
  const img = document.getElementById('child-photo');
  if (!img) return;
  const config = resolveChildConfig(currentStudent);
  const photo  = config?.photo;
  if (photo) {
    img.src = photo;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
    img.src = '';
  }
}

/* ─── Child photo upload ────────────────────────────────────────────────── */
function initPhotoUpload() {
  const btnAdd    = document.getElementById('btn-add-photo');
  const popup     = document.getElementById('photo-picker-popup');
  const pickGal   = document.getElementById('photo-pick-gallery');
  const pickFile  = document.getElementById('photo-pick-file');
  const inputGal  = document.getElementById('photo-upload-input');
  const inputFile = document.getElementById('photo-upload-file-input');
  if (!btnAdd || !popup) return;

  // Toggle popup
  btnAdd.addEventListener('click', e => {
    e.stopPropagation();
    popup.classList.toggle('hidden');
  });

  // Close popup on outside click
  document.addEventListener('click', () => popup.classList.add('hidden'));
  popup.addEventListener('click', e => e.stopPropagation());

  // Route to appropriate input
  pickGal?.addEventListener('click',  () => { popup.classList.add('hidden'); inputGal?.click();  });
  pickFile?.addEventListener('click', () => { popup.classList.add('hidden'); inputFile?.click(); });

  // Shared upload handler — opens crop modal before saving
  async function handleFileInput(input) {
    const file = input.files?.[0];
    if (!file || !currentStudent) return;
    input.value = '';
    const reader = new FileReader();
    reader.onload = async ev => {
      const croppedBase64 = await openCropModal(ev.target.result);
      if (!croppedBase64) return; // user cancelled
      try {
        const res = await fetch(`/api/children/${encodeURIComponent(currentStudent)}/photo`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ photo: croppedBase64 }),
        });
        if (!res.ok) throw new Error(await res.text());
        const child = resolveChildConfig(currentStudent);
        if (child) child.photo = croppedBase64;
        updateChildPhoto();
      } catch (e) {
        console.error('[photo] Upload failed:', e.message);
      }
    };
    reader.readAsDataURL(file);
  }

  inputGal?.addEventListener('change',  () => handleFileInput(inputGal));
  inputFile?.addEventListener('change', () => handleFileInput(inputFile));
}

/* ═══════════════════════════════════════════════════════════════
   PHOTO CROP MODAL
   ═══════════════════════════════════════════════════════════════ */
let _cropResolve = null;
let _cropImgX    = 0;
let _cropImgY    = 0;
let _cropDragSX  = null;
let _cropDragSY  = null;

function openCropModal(imageSrc) {
  return new Promise(resolve => {
    _cropResolve = resolve;
    const modal = document.getElementById('crop-modal');
    const img   = document.getElementById('crop-img');
    const vp    = document.getElementById('crop-viewport');
    const VW    = 240;

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    img.onload = () => {
      // Scale so shortest side just covers the viewport
      const scale = Math.max(VW / img.naturalWidth, VW / img.naturalHeight) * 1.1;
      const W = img.naturalWidth  * scale;
      const H = img.naturalHeight * scale;
      img.style.width  = W + 'px';
      img.style.height = H + 'px';
      // Start: centred horizontally, upper-third vertically (face position)
      _cropImgX = (VW - W) / 2;
      _cropImgY = -(H - VW) * 0.25; // 25% from top
      img.style.left = _cropImgX + 'px';
      img.style.top  = _cropImgY + 'px';
    };
    img.src = imageSrc;

    // Touch drag
    vp.ontouchstart = e => {
      const t = e.touches[0];
      _cropDragSX = t.clientX - _cropImgX;
      _cropDragSY = t.clientY - _cropImgY;
      e.preventDefault();
    };
    vp.ontouchmove = e => {
      if (_cropDragSX === null) return;
      const t = e.touches[0];
      _cropImgX = t.clientX - _cropDragSX;
      _cropImgY = t.clientY - _cropDragSY;
      img.style.left = _cropImgX + 'px';
      img.style.top  = _cropImgY + 'px';
      e.preventDefault();
    };
    vp.ontouchend = () => { _cropDragSX = null; };

    // Mouse drag
    vp.onmousedown = e => {
      _cropDragSX = e.clientX - _cropImgX;
      _cropDragSY = e.clientY - _cropImgY;
      e.preventDefault();
    };
    document.onmousemove = e => {
      if (_cropDragSX === null) return;
      _cropImgX = e.clientX - _cropDragSX;
      _cropImgY = e.clientY - _cropDragSY;
      img.style.left = _cropImgX + 'px';
      img.style.top  = _cropImgY + 'px';
    };
    document.onmouseup = () => { _cropDragSX = null; };
  });
}

function confirmCrop() {
  const img = document.getElementById('crop-img');
  const VW  = 240;
  const OUT = 192; // output px (2× for retina)

  const canvas = document.createElement('canvas');
  canvas.width  = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext('2d');

  // Circular clip
  ctx.beginPath();
  ctx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2);
  ctx.clip();

  // The img element sits at (_cropImgX, _cropImgY) inside the VW×VW viewport
  // Scale from display size → natural size
  const displayW = parseFloat(img.style.width);
  const scaleF   = img.naturalWidth / displayW;

  // Source coords in natural image space
  const sx = (-_cropImgX) * scaleF;
  const sy = (-_cropImgY) * scaleF;
  const sw = VW * scaleF;

  ctx.drawImage(img, sx, sy, sw, sw, 0, 0, OUT, OUT);

  const base64 = canvas.toDataURL('image/jpeg', 0.88);
  closeCropModal();
  if (_cropResolve) { _cropResolve(base64); _cropResolve = null; }
}

function cancelCrop() {
  closeCropModal();
  if (_cropResolve) { _cropResolve(null); _cropResolve = null; }
}

function closeCropModal() {
  const modal = document.getElementById('crop-modal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
  // Clean up global mouse handlers
  document.onmousemove = null;
  document.onmouseup   = null;
  _cropDragSX = null;
}

// Wire crop modal buttons — DOM is already ready when app.js executes (script at bottom of body)
document.getElementById('btn-cancel-crop')?.addEventListener('click',  cancelCrop);
document.getElementById('btn-cancel-crop2')?.addEventListener('click', cancelCrop);
document.getElementById('btn-confirm-crop')?.addEventListener('click', confirmCrop);

/* ─── Notification validity check ──────────────────────────────────────── */
/**
 * Returns false for alerts that are clearly invalid:
 *  • Absences at impossible hours (before 07:00 — school is closed)
 *  • Non-grade / non-homework alerts older than 45 days (stale)
 */
function isValidNotification(n) {
  // Block absences before 7am — school doesn't start that early
  if (n.type === 'absence' && n.alertTime) {
    const h = parseInt(n.alertTime.split(':')[0], 10);
    if (!isNaN(h) && h < 7) return false;
  }
  // Block stale actionable alerts (not grades / homework) — only new (within 7 days)
  if (!['grade', 'homework'].includes(n.type)) {
    const daysOld = calcDaysLeft(n.date);
    if (daysOld !== null && daysOld < -7) return false;
  }
  return true;
}

/* ─── Stats bar — Figma: 4 large cards (הודעות, ציונים, התראות, שיעורי בית) ── */
function renderStats(notifications, classEvents) {
  // Messages: count those not read (check both scraper field and local status)
  const messages = (lastData?.data?.messages || []).filter(m => !(m.read || lastStatus[msgId(m)]?.read)).length;
  const grades   = notifications.filter(n => n.type === 'grade').length;
  // Alerts: use same filter as renderAlerts (isValidNotification drops stale ones)
  const alerts   = notifications.filter(n =>
    ['late', 'missing_equipment', 'absence', 'homework_not_done'].includes(n.type) && isValidNotification(n)).length;
  const homework = notifications.filter(n => n.type === 'homework' && n.date && isSubjectValid(n.student, n.subject))
    .filter(n => !lastStatus[homeworkId(n)]?.done).length;
  // Unread = messages not read + alerts not seen (use local status to track)
  const unread   = messages + notifications.filter(n =>
    isValidNotification(n) && !lastStatus['seen_' + notifId(n)]?.seen).length;

  const cards = [
    { icon: '📚', num: homework, label: 'שיעורי בית', cls: 'stat-homework', section: 'homework' },
    { icon: '⚠️', num: alerts,   label: 'התראות',  cls: 'stat-alerts',    section: 'alerts' },
    { icon: '🎓', num: grades,   label: 'ציונים',  cls: 'stat-grades',    section: 'grades' },
    { icon: '📨', num: messages, label: 'הודעות',  cls: 'stat-messages',  section: 'messages' },
    { icon: '🔔', num: unread,   label: 'לא נקרא', cls: 'stat-unread',    section: 'feed', action: 'markAllSeen' },
  ];
  document.getElementById('stats-bar').innerHTML = cards.map(c =>
    `<div class="stat-card ${c.cls}" onclick="${c.action ? c.action + '()' : `navigateTo('${c.section}')`}" role="button" tabindex="0">
       <span class="stat-card-icon">${c.icon}</span>
       <span class="stat-card-num">${c.num}</span>
       <span class="stat-card-label">${c.label}</span>
     </div>`
  ).join('');
}

/* ─── Mark all notifications as seen (clears "לא נקרא" counter) ────────── */
function markAllSeen() {
  const notifications = lastData?.data?.notifications || [];
  for (const n of notifications) {
    if (isValidNotification(n)) lastStatus['seen_' + notifId(n)] = { seen: true };
  }
  // Also mark all messages read
  for (const m of lastData?.data?.messages || []) {
    const id = msgId(m);
    if (!lastStatus[id]?.read) markMessageRead(id);
  }
  navigateTo('feed');
  // Re-render stats to show 0
  const notifications2 = (lastData?.data?.notifications || []);
  const visible = currentStudent ? notifications2.filter(n => studentMatch(n.student, currentStudent)) : notifications2;
  renderStats(visible, []);
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: שיעורי בית
   ═══════════════════════════════════════════════════════════════ */
function renderHomework(notifications, status) {
  const hwItems = notifications
    .filter(n => n.type === 'homework' && n.date && isSubjectValid(n.student, n.subject))
    .sort((a, b) => dateSortKey(b.date) - dateSortKey(a.date));

  const container = document.getElementById('hw-list');
  if (!container) return;

  // Split into pending (visible) and done (history)
  const pending = hwItems.filter(n => !status[homeworkId(n)]?.done);
  const done    = hwItems.filter(n =>  status[homeworkId(n)]?.done);

  if (!pending.length && !done.length) {
    container.innerHTML = '<div class="empty" data-icon="🎉">אין שיעורי בית פעילים!</div>';
    return;
  }

  let html = '';

  if (!pending.length) {
    // All done — celebrate
    html += '<div class="empty" data-icon="🎉">כל שיעורי הבית הושלמו!</div>';
  } else {
    html += pending.map(n => hwCard(n, homeworkId(n), false)).join('');
  }

  // History button — shown whenever there are completed items
  if (done.length) {
    html += `
      <button class="btn-hw-history" onclick="openHomeworkHistory()">
        ✅ הושלמו — ${done.length} שיעורי בית
      </button>`;
  }

  // Full API history button
  const allHwByStudent = lastData?.data?.homeworkByStudent || {};
  const studentHwHistory = currentStudent ? (allHwByStudent[currentStudent] || []) : Object.values(allHwByStudent).flat();
  const historyItems = studentHwHistory.filter(h => h.source === 'history');
  if (historyItems.length) {
    html += `
      <button class="btn-hw-history" style="background:rgba(99,102,241,.12);border-color:rgba(99,102,241,.4);color:#818cf8;margin-top:0.5rem;" onclick="openAllHomeworkHistory()">
        📋 היסטוריה מלאה — ${historyItems.length} שיעורי בית
      </button>`;
  }

  container.innerHTML = html;
}

function hwCard(n, id, done) {
  const idx      = allocCard(n);
  const daysLeft     = calcDaysLeft(n.date);
  const urgent       = daysLeft !== null && daysLeft <= 1 && !done;
  const subjectValid = isSubjectValid(n.student, n.subject);

  const dueBadge     = daysLeft === 0 ? '<span class="due-badge due-today">היום!</span>'
    : daysLeft === 1                   ? '<span class="due-badge due-soon">מחר!</span>'
    : '';
  const suspectBadge = !subjectValid
    ? '<span class="badge badge-suspect">⚠️ מקצוע חשוד</span>' : '';

  const meta = [
    n.alertDay || n.date,
    n.lesson   ? `שיעור ${n.lesson}` : null,
    n.student  ? `👤 ${n.student}`   : null,
  ].filter(Boolean).join(' | ');

  const btnLabel = done ? '✅ הושלם' : '✓ סמן כהושלם';
  const btnClass = done ? 'btn-done done' : 'btn-done';

  return `
    <div class="card type-homework${done ? ' done-card' : ''}${urgent ? ' card-urgent' : ''} clickable-card"
         data-card-idx="${idx}" data-hw-id="${esc(id)}">
      <div class="card-inner">
        <div class="card-icon-box">📚</div>
        <div class="card-content">
          <div class="card-header">
            <div class="card-title-row">
              <span class="card-title">${n.subject ? `שיעורי בית ב${esc(n.subject)}` : 'שיעורי בית'}</span>
              ${dueBadge}${suspectBadge}
            </div>
            <button class="${btnClass}"
              data-id="${esc(id)}"
              data-hw-text="${esc(n.homeworkText || '')}"
              data-student="${esc(n.student || '')}"
              data-subject="${esc(n.subject || '')}"
              data-date="${esc(n.date || '')}"
              data-lesson="${esc(String(n.lesson ?? ''))}"
              data-alert-day="${esc(n.alertDay || '')}"
              data-description="${esc((n.description || '').slice(0, 300))}"
              onclick="event.stopPropagation(); handleMarkDone(this)"
              ${done ? 'disabled' : ''}>${btnLabel}</button>
          </div>
          <div class="card-meta">${esc(meta)}</div>
          ${n.homeworkText ? `<div class="hw-text">📝 ${esc(n.homeworkText)}</div>` : ''}
          ${n.date ? `<div class="card-meta">${esc(n.date)} · תאריך יעד: ${esc(n.date)}</div>` : ''}
          <div class="card-expand-hint">לחץ לפרטים נוספים ›</div>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: התראות (איחורים / ציוד חסר / חיסורים / אי הכנה)
   ═══════════════════════════════════════════════════════════════ */
function renderAlerts(notifications) {
  const ALERT_TYPES = ['good_word', 'late', 'missing_equipment', 'absence', 'homework_not_done', 'attendance'];
  const items = notifications.filter(n => ALERT_TYPES.includes(n.type) && isValidNotification(n));
  const container = document.getElementById('alerts-list');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = '<div class="empty" data-icon="✨">אין התראות פעילות</div>';
    return;
  }

  // Group by type with Hebrew heading
  const GROUP_LABELS = {
    good_word:         '🌟 מילים טובות',
    late:              '⏰ איחורים',
    missing_equipment: '🎒 ציוד חסר',
    absence:           '🚫 חיסורים',
    homework_not_done: '⚠️ אי הכנת שיעורי בית',
    attendance:        '✅ נוכחות',
  };

  let html = '';
  for (const type of ALERT_TYPES) {
    const group = items.filter(n => n.type === type);
    if (!group.length) continue;
    html += `<h3 class="group-title">${GROUP_LABELS[type]}</h3>`;
    html += [...group].sort((a, b) => dateSortKey(b.date) - dateSortKey(a.date)).map(n => alertCard(n)).join('');
  }
  container.innerHTML = html;
}

function alertCard(n) {
  const idx   = allocCard(n);
  const label = TYPE_LABEL[n.type] || TYPE_LABEL.general;
  const meta  = fixSpacingForDisplay([
    n.alertDay || n.date,
    n.lesson   ? `שיעור ${n.lesson}` : null,
    n.student  ? `👤 ${n.student}`  : null,
  ].filter(Boolean).join(' | '));
  const preview = n.description
    ? fixSpacingForDisplay(n.description).slice(0, 100) + (n.description.length > 100 ? '...' : '')
    : '';

  const iconMap = { good_word: '❤️', late: '⏰', missing_equipment: '⚠️', absence: '🚫', homework_not_done: '⚠️', attendance: '✅' };
  const icon = iconMap[n.type] || '📋';
  return `
    <div class="card type-${n.type || 'general'} clickable-card"
         data-card-idx="${idx}" data-hw-id="">
      <div class="card-inner">
        <div class="card-icon-box">${icon}</div>
        <div class="card-content">
          <div class="card-header">
            <span class="card-title">${esc(n.subject || TYPE_LABEL[n.type] || '?')}</span>
            <span class="badge badge-${n.type || 'general'}">${label}</span>
          </div>
          <div class="card-meta">${esc(meta)}</div>
          ${preview ? `<div class="card-desc">${esc(preview)}</div>` : ''}
          <div class="card-expand-hint">לחץ לפרטים נוספים ›</div>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: ציונים
   ═══════════════════════════════════════════════════════════════ */
function renderGrades(notifications) {
  const items = notifications.filter(n => n.type === 'grade')
    .sort((a, b) => dateSortKey(b.date) - dateSortKey(a.date));
  const container = document.getElementById('grades-list');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = '<div class="empty" data-icon="🏅">אין ציונים</div>';
    return;
  }

  container.innerHTML = items.map(n => {
    const idx   = allocCard(n);
    const meta  = fixSpacingForDisplay([
      n.alertDay || n.date,
      n.lesson   ? `שיעור ${n.lesson}` : null,
      n.student  ? `👤 ${n.student}`   : null,
    ].filter(Boolean).join(' | '));

    // Extract grade number from description (e.g. "ציון 95 במבחן")
    const gradeMatch = (n.description || '').match(/ציון\s+(\d+)/);
    const gradeNum   = gradeMatch ? gradeMatch[1] : null;
    const gradeColor = gradeNum >= 90 ? '#10b981' : gradeNum >= 70 ? '#3b82f6' : '#f59e0b';

    return `
      <div class="card type-grade clickable-card"
           data-card-idx="${idx}" data-hw-id="">
        <div class="card-inner">
          <div class="card-icon-box">🎓</div>
          <div class="card-content">
            ${gradeNum ? `<span class="grade-badge" style="color:${gradeColor}">${gradeNum}/100</span>` : ''}
            <div class="card-header">
              <div class="card-title-row">
                <span class="card-title">ציון חדש - ${esc(n.subject || '?')}</span>
              </div>
            </div>
            ${n.description ? `<div class="card-desc">${esc(fixSpacingForDisplay(n.description))}</div>` : ''}
            <div class="card-meta">${esc(n.subject || '')} · ${esc(meta)}</div>
            <div class="card-expand-hint">לחץ לפרטים נוספים ›</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: אירועי שיעור
   ═══════════════════════════════════════════════════════════════ */
function renderClassEvents(classEvents) {
  const real = classEvents.filter(e => !e.includes('לא נמצאו'));
  const container = document.getElementById('events-list');
  if (!container) return;

  if (!real.length) {
    container.innerHTML = '<div class="empty" data-icon="📋">אין אירועי שיעור</div>';
    return;
  }

  container.innerHTML = real.map(raw => {
    raw = fixSpacingForDisplay(raw);
    let type = 'general';
    if      (raw.includes('חוסר ציוד'))                                type = 'missing_equipment';
    else if (raw.includes('אי הכנת שיעורי'))                           type = 'homework_not_done';
    else if (raw.includes('שיעורי-בית') || raw.includes('שיעורי בית')) type = 'homework';
    else if (raw.includes('איחור'))                                    type = 'late';
    else if (raw.includes('חיסור') || raw.includes('נעדר'))            type = 'absence';
    else if (raw.includes('ציון'))                                     type = 'grade';

    const fakeN = { type, description: raw, subject: raw.split('|')[0]?.trim() || '?' };
    const idx   = allocCard(fakeN);
    const label = TYPE_LABEL[type] || TYPE_LABEL.general;
    const preview = raw.length > 120 ? raw.slice(0, 120) + '...' : raw;

    return `
      <div class="card type-${type} clickable-card"
           data-card-idx="${idx}" data-hw-id="">
        <div class="card-header">
          <span class="badge badge-${type}">${label}</span>
        </div>
        <div class="card-desc">${esc(preview)}</div>
        <div class="card-expand-hint">לחץ לפרטים נוספים ›</div>
      </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: יומן — לוח שנה משולב
   ═══════════════════════════════════════════════════════════════ */
function renderCalendar(notifications, classEvents, specialEvents) {
  const container = document.getElementById('calendar-list');
  if (!container) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const items = [];

  // ── Homework deadlines ──────────────────────────────────────
  for (const n of notifications) {
    if (n.type !== 'homework' || !n.date || !isSubjectValid(n.student, n.subject)) continue;
    items.push({
      date:    n.date,
      sortKey: dateSortKey(n.date),
      type:    'homework',
      label:   `📚 ${n.subject || '?'}`,
      sub:     n.homeworkText || (n.alertDay || n.date) + (n.lesson ? ` · שיעור ${n.lesson}` : ''),
      n,
    });
  }

  // ── Class events (parse date from "subject | DD/MM/YYYY | שיעור N | note") ──
  for (const raw of classEvents) {
    if (raw.includes('לא נמצאו')) continue;
    if (!isEventValidForCurrentChild(raw)) continue;
    const parsed = parseClassEvent(raw);
    if (!parsed.date) continue;
    items.push({
      date:    parsed.date,
      sortKey: dateSortKey(parsed.date),
      type:    parsed.type,
      label:   parsed.title,
      sub:     parsed.note || raw,
      teacher: parsed.teacher,
      lesson:  parsed.lesson,
      raw,
      n:       null,
    });
  }

  // ── Special events (birthdays, parent meetings) ─────────────
  const yearStr = String(today.getFullYear());
  for (const ev of specialEvents) {
    if (!ev.date) continue;
    // Filter by childName if the event belongs to a specific child
    if (ev.childName && currentStudent && ev.childName !== currentStudent) continue;
    // Filter by grade if event name or details mention a specific class grade
    if (!isEventValidForCurrentChild((ev.name || '') + ' ' + (ev.details || ''))) continue;
    // Accept "DD/MM" (recurring) or "DD/MM/YYYY" (one-time)
    let dateStr = ev.date;
    if (/^\d{2}\/\d{2}$/.test(dateStr)) dateStr = `${dateStr}/${yearStr}`;

    // Compute age for birthday events from birthYear field
    let evLabel = `${ev.emoji || '📅'} ${ev.name}`;
    let evSub   = ev.details || '';
    if (ev.type === 'birthday' && ev.birthYear && ev.date) {
      const currentAge  = calcAge(ev.birthYear, ev.date);
      if (currentAge !== null) {
        const bdDaysLeft  = calcDaysLeft(dateStr);
        const isFuture    = bdDaysLeft !== null && bdDaysLeft >= 0;
        const displayAge  = isFuture ? currentAge + 1 : currentAge;
        evLabel += ` — גיל ${displayAge}`;
        evSub    = (isFuture ? `מציין/ת גיל ${displayAge}` : `ציין/ה גיל ${displayAge}`) +
                   (evSub ? ` · ${evSub}` : '');
      }
    }

    items.push({
      date:      dateStr,
      sortKey:   dateSortKey(dateStr),
      type:      ev.type || 'event',
      label:     evLabel,
      sub:       evSub,
      n:         null,
      isSpecial: true,
      evType:    ev.type,
    });
  }

  if (!items.length) {
    container.innerHTML = '<div class="empty" data-icon="📅">אין אירועים קרובים</div>';
    return;
  }

  // Sort chronologically, then group by date
  items.sort((a, b) => b.sortKey - a.sortKey);

  const byDate = {};
  for (const item of items) {
    (byDate[item.date] = byDate[item.date] || []).push(item);
  }

  let html = '';
  for (const [date, group] of Object.entries(byDate)) {
    const daysLeft = calcDaysLeft(date);
    const isPast   = daysLeft !== null && daysLeft < 0;
    const isToday  = daysLeft === 0;

    const dayLabel = isToday         ? 'היום 📍'
                   : daysLeft === 1  ? 'מחר'
                   : date;

    const dayClass = isToday ? 'cal-day-today'
                   : isPast  ? 'cal-day-past'
                   : 'cal-day-future';

    html += `<div class="cal-day-group ${dayClass}">`;
    html += `<div class="cal-date-header">${esc(dayLabel)}</div>`;

    for (const item of group) {
      const typeClass = item.isSpecial
        ? `type-${item.evType === 'birthday' ? 'grade' : 'general'}`
        : `type-${item.type === 'homework' ? 'homework' : 'general'}`;
      const idx    = allocCard(item.n || { type: item.type, description: item.sub, subject: item.label });
      const hwIdVal = item.n ? esc(homeworkId(item.n)) : '';

      const specialBadgeClass = item.evType === 'birthday'  ? 'cal-special-birthday'
                               : item.evType === 'parent_meeting' ? 'cal-special-meeting'
                               : item.isSpecial                   ? 'cal-special-event'
                               : '';
      const specialBadge = specialBadgeClass
        ? `<span class="cal-special-badge ${specialBadgeClass}">${esc(item.evType === 'birthday' ? 'יום הולדת' : item.evType === 'parent_meeting' ? 'אסיפת הורים' : 'אירוע')}</span>`
        : '';

      const teacherRow = item.teacher
        ? `<div class="card-teacher">👤 ${esc(item.teacher)}${item.lesson ? ` · שיעור ${esc(item.lesson)}` : ''}</div>`
        : (item.lesson ? `<div class="card-teacher">שיעור ${esc(item.lesson)}</div>` : '');

      html += `
        <div class="card ${typeClass} clickable-card cal-item"
             data-card-idx="${idx}" data-hw-id="${hwIdVal}">
          <div class="card-title">${specialBadge}${esc(item.label)}</div>
          ${item.sub ? `<div class="card-desc">${esc(item.sub)}</div>` : ''}
          ${teacherRow}
        </div>`;
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: אישורים
   ═══════════════════════════════════════════════════════════════ */
function renderApprovals() {
  const container = document.getElementById('approvals-list');
  if (!container) return;

  const notifications = lastData?.data?.notifications || [];
  const scrapedApprovals = lastData?.data?.approvals || [];
  const signoffs = lastData?.data?.signoffs || [];
  const approvalItems = [];

  // 1. Structured approvals from scraper (msgId, title, sender, date, status, requiredEquipment)
  for (const a of scrapedApprovals) {
    const approved = a.status === 'approved' || lastStatus[approvalId(a)]?.approved;
    approvalItems.push({
      ...a,
      label: a.title || a.label || a.details || '',
      sub: a.itinerary || a.body || '',
      date: a.date,
      type: 'scraped',
      approved,
      requiredEquipment: a.requiredEquipment || [],
      url: a.url,
    });
  }

  // 2. Fallback: signoffs (legacy format)
  for (const s of signoffs) {
    if (approvalItems.some(x => (x.details || x.sub) === (s.details || ''))) continue;
    const txt = (s.details || '').trim();
    if (txt.length > 15) {
      const id = approvalId({ msgId: s.msgId, label: txt, sub: txt, date: s.date });
      approvalItems.push({
        label: fixSpacingForDisplay(txt).slice(0, 60), sub: txt, date: s.date || '', type: 'signoff',
        approved: lastStatus[id]?.approved, requiredEquipment: [], url: s.url,
      });
    }
  }

  // 3. Special events (type event or נדרש אישור)
  for (const ev of lastEvents) {
    if (!ev.date) continue;
    if (ev.childName && currentStudent && ev.childName !== currentStudent) continue;
    if (ev.type === 'event' || /אישור/.test(ev.details || '')) {
      const id = approvalId({ label: ev.name, sub: ev.details, date: ev.date });
      approvalItems.push({
        label: `${ev.emoji || '📋'} ${ev.name}`, sub: ev.details || '', date: ev.date, type: 'event',
        approved: lastStatus[id]?.approved, requiredEquipment: [],
      });
    }
  }

  // 4. Approval-type notifications
  for (const n of notifications) {
    if (n.type !== 'approval') continue;
    if (currentStudent && n.student && n.student !== currentStudent) continue;
    approvalItems.push({
      label: n.subject || 'אישור',
      sub: n.homeworkText || n.description || '',
      date: n.date || '',
      type: 'approval',
      approved: lastStatus[approvalId({ label: n.subject, sub: n.description, date: n.date })]?.approved,
      requiredEquipment: [],
    });
  }

  if (!approvalItems.length) {
    container.innerHTML = `
      <div class="card type-general" style="text-align:center; padding:1.5rem 1rem;">
        <div style="font-size:2.2rem; margin-bottom:0.5rem;">✍️</div>
        <div style="font-weight:700; font-size:1rem; color:#e2e8f0; margin-bottom:0.4rem;">אישורי הורים</div>
        <div style="font-size:0.82rem; color:#64748b; line-height:1.6;">
          אישורים לטיולים ואירועים יוצגו כאן<br>אין אישורים פתוחים כרגע
        </div>
      </div>`;
    return;
  }

  container.innerHTML = approvalItems.map(item => {
    try {
    const id = approvalId(item);
    const approved = item.approved || lastStatus[id]?.approved;
    const statusBadge = approved
      ? '<span class="badge badge-approved">✓ אושר</span>'
      : (item.status === 'rejected' ? '<span class="badge badge-rejected">נדחה</span>' : '<span class="badge badge-general">✍️ ממתין לאישור</span>');
    const eq = Array.isArray(item.requiredEquipment) ? item.requiredEquipment : [];
    const eqHtml = eq.length ? `<div class="approval-equipment"><strong>ציוד נדרש:</strong> ${eq.map(e => esc(e)).join(' • ')}</div>` : '';

    return `
    <div class="card type-general approval-card${approved ? ' approved-card' : ''}" data-approval-id="${esc(id)}" data-approval-url="${item.url ? esc(item.url) : ''}">
      <div class="card-header approval-header">
        <label class="approval-checkbox-wrap">
          <input type="checkbox" class="approval-checkbox" ${approved ? 'checked' : ''} data-approval-id="${esc(id)}" data-approval-url="${item.url ? esc(item.url) : ''}" ${approved ? 'disabled' : ''} />
          <span class="checkmark"></span>
        </label>
        <span class="card-title">${esc(item.label)}</span>
        ${statusBadge}
      </div>
      ${item.sender ? `<div class="card-meta">✉️ מאת: ${esc(item.sender)}</div>` : ''}
      ${item.date ? `<div class="card-meta">📅 ${esc(item.date)}</div>` : ''}
      ${item.sub ? `<div class="card-desc">${esc(item.sub)}</div>` : ''}
      ${eqHtml}
      <div class="approval-actions">
        ${item.url ? `<a class="btn-open-webtop" href="${esc(item.url)}" target="_blank" rel="noopener">פתח באתר Webtop</a>` : ''}
        ${!approved ? `<button class="btn-approval-done" data-approval-id="${esc(id)}" data-approval-url="${item.url ? esc(item.url) : ''}">✓ אישרתי</button>` : ''}
      </div>
    </div>`;
    } catch (e) { console.warn('approval item error:', item, e); return ''; }
  }).join('');

  if (container) {
  container.querySelectorAll('.approval-checkbox:not([disabled])').forEach(cb => {
    cb.onclick = (e) => { e.stopPropagation(); markApprovalDone(cb.dataset.approvalId, cb.dataset.approvalUrl); };
  });
  container.querySelectorAll('.btn-approval-done').forEach(btn => {
    btn.onclick = () => markApprovalDone(btn.dataset.approvalId, btn.dataset.approvalUrl);
  });
  }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: הודעות — Messages inbox
   ═══════════════════════════════════════════════════════════════ */
function renderMessages() {
  const container = document.getElementById('messages-list');
  if (!container) return;
  _selectedMsgIds.clear();

  const messages = lastData?.data?.messages;

  if (!Array.isArray(messages)) {
    container.innerHTML = `
      <div class="card type-general" style="text-align:center; padding:1.75rem 1rem;">
        <div style="font-size:2.5rem; margin-bottom:0.6rem;">📨</div>
        <div style="font-weight:700; font-size:1rem; color:#e2e8f0; margin-bottom:0.5rem;">תיבת הודעות מהמורים</div>
        <div style="font-size:0.82rem; color:#64748b; line-height:1.75;">
          טוען הודעות… משוך לרענון אם לא מופיעות
        </div>
      </div>`;
    return;
  }

  // Empty inbox
  if (!messages.length) {
    container.innerHTML = '<div class="empty" data-icon="📭">אין הודעות</div>';
    return;
  }

  // Messages are shared for both children, for parents — no student filter
  const filtered = messages;

  const isRead = (m) => m.read || lastStatus[msgId(m)]?.read;
  const sorted = [...filtered].sort((a, b) => {
    if (!!isRead(a) !== !!isRead(b)) return isRead(a) ? 1 : -1;
    return dateSortKey(b.date) - dateSortKey(a.date);
  });

  const unread = sorted.filter(m => !isRead(m));
  const read   = sorted.filter(m =>  isRead(m));

  let html = `
    <div id="msg-bulk-toolbar" class="msg-bulk-toolbar" style="display:none;">
      <span id="msg-bulk-count">0 נבחרו</span>
      <button onclick="bulkMarkMessages(true)">✓ סמן כנקרא</button>
      <button onclick="bulkMarkMessages(false)">✕ סמן כלא נקרא</button>
      <button onclick="clearMsgSelection()">ביטול</button>
    </div>`;
  if (unread.length) {
    html += `<h3 class="group-title">📨 הודעות חדשות (${unread.length})</h3>`;
    html += unread.map(msgCard).join('');
  }
  if (read.length) {
    if (unread.length) html += `<h3 class="group-title" style="margin-top:1rem;">✓ נקראו</h3>`;
    html += read.map(msgCard).join('');
  }

  container.innerHTML = html;
}

/** Convert raw message object to card object (used by msgCard and renderFeed) */
function messageToCardObj(m) {
  const readStatus = m.read || lastStatus[msgId(m)]?.read;
  return {
    type:        'message',
    subject:     m.subject  || '(ללא נושא)',
    student:     m.student  || null,
    alertDay:    m.from     ? `${m.from}${m.fromRole ? ` · ${m.fromRole}` : ''}` : null,
    date:        m.date     || null,
    alertTime:   m.time     || null,
    category:    readStatus ? 'נקרא ✓' : 'לא נקרא',
    description: m.body     || null,
    _msgRaw:     m,
  };
}

function msgCard(m) {
  const cardObj = messageToCardObj(m);
  const readStatus = m.read || lastStatus[msgId(m)]?.read;
  const idx  = allocCard(cardObj);
  const meta = [
    m.from    ? `✉️ ${m.from}` : null,
    m.date    ? m.date          : null,
    m.time    ? m.time          : null,
    m.student ? `👤 ${m.student}` : null,
  ].filter(Boolean).join(' | ');

  const bodyPreview = m.body
    ? esc(m.body.slice(0, 120)) + (m.body.length > 120 ? '...' : '')
    : '';

  const mid = msgId(m);
  return `
    <div class="card type-message${!readStatus ? ' msg-unread-card' : ''} clickable-card"
         data-card-idx="${idx}" data-hw-id="" data-msg-id="${esc(mid)}">
      <div class="card-header">
        <label class="msg-checkbox-wrap" onclick="event.stopPropagation()">
          <input type="checkbox" class="msg-checkbox" data-msg-id="${esc(mid)}"
                 onchange="toggleMsgSelect(this)">
        </label>
        <span class="card-title">${esc(cardObj.subject)}</span>
        ${!readStatus
          ? '<span class="badge badge-message">📨 חדש</span>'
          : '<span class="badge badge-message-read">✓ נקרא</span>'}
      </div>
      <div class="card-meta">${esc(meta)}</div>
      ${bodyPreview ? `<div class="card-desc">${bodyPreview}</div>` : ''}
      <div class="card-expand-hint">לחץ לקריאה ›</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: קישורים שימושיים
   ═══════════════════════════════════════════════════════════════ */
function renderLinks() {
  const container = document.getElementById('links-list');
  if (!container) return;

  const links = lastData?.data?.usefulLinks || [];
  if (!links.length) {
    container.innerHTML = '<div class="empty" data-icon="🔗">אין קישורים להצגה</div>';
    return;
  }

  const BASE = 'https://webtop.smartschool.co.il';
  container.innerHTML = links.map(l => {
    const href = l.href && !l.href.startsWith('http') ? BASE + (l.href.startsWith('/') ? l.href : '/' + l.href) : (l.href || '');
    let txt = fixSpacingForDisplay(l.text || '');
    if (/\s*https?:\/\/\S+/.test(txt)) txt = txt.replace(/\s*https?:\/\/\S+/g, '').trim(); // הסרת URL מתוך הטקסט
    if (!txt || txt.length < 2) return '';
    return `
      <a class="card type-general link-card" href="${esc(href)}" target="_blank" rel="noopener">
        <span class="card-title">🔗 ${esc(txt)}</span>
        <span class="card-expand-hint">פתח באתר ›</span>
      </a>`;
  }).filter(Boolean).join('');
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: אתרים חיצוניים (קישורים מ-external_links.json)
   ═══════════════════════════════════════════════════════════════ */
function renderExternalLinks() {
  const container = document.getElementById('external-list');
  if (!container) return;

  const links = lastExternalLinks || [];
  if (!links.length) {
    container.innerHTML = '<div class="empty" data-icon="🔗">אין אתרים חיצוניים</div>';
    return;
  }

  container.innerHTML = links.map(l => {
    const url = l.url || l.href || '#';
    const title = l.title || l.text || 'קישור';
    const icon = l.icon || '🔗';
    return `
      <a class="card type-general link-card" href="${esc(url)}" target="_blank" rel="noopener">
        <span class="card-title">${icon} ${esc(title)}</span>
        <span class="card-expand-hint">פתח באתר ›</span>
      </a>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: מערכת שעות
   ═══════════════════════════════════════════════════════════════ */
function renderSchedule() {
  const el = document.getElementById('schedule-list');
  if (!el) return;

  const studentNames = Object.keys(lastSchedule);
  if (studentNames.length === 0) {
    el.innerHTML = '<div class="empty-state">📅 מערכת שעות אינה זמינה (הגישה לנתון זה חסומה בחשבון זה)</div>';
    return;
  }

  // Filter to current student if one is selected
  const names = currentStudent
    ? studentNames.filter(n => studentMatch(n, currentStudent))
    : studentNames;

  if (names.length === 0) {
    el.innerHTML = '<div class="empty-state">📅 אין מערכת שעות לתלמיד זה</div>';
    return;
  }

  let html = '';
  for (const name of names) {
    const rawSchedule = lastSchedule[name];
    html += renderStudentSchedule(name, rawSchedule);
  }
  el.innerHTML = html;
}

function renderStudentSchedule(studentName, rawSchedule) {
  if (!rawSchedule) return '';

  // The API returns various formats — handle both array and object
  let days = [];
  if (Array.isArray(rawSchedule)) {
    days = rawSchedule;
  } else if (rawSchedule.days) {
    days = rawSchedule.days;
  } else if (rawSchedule.schedule) {
    days = Array.isArray(rawSchedule.schedule) ? rawSchedule.schedule : Object.values(rawSchedule.schedule);
  } else {
    // Unknown format — schedule blocked or unsupported
    return `<div class="schedule-card">
      <div class="empty-state">📅 מערכת שעות אינה זמינה עבור ${esc(studentName)}</div>
    </div>`;
  }

  // Day names in Hebrew
  const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
  const today = new Date().getDay(); // 0=Sun, 1=Mon, ...

  let html = `<div class="schedule-card">
    <div class="schedule-header">
      <span class="schedule-student-name">📅 מערכת שעות — ${esc(studentName)}</span>
      <span class="schedule-week-label">השבוע הנוכחי</span>
    </div>
    <div class="schedule-grid">`;

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    if (!day) continue;

    // Day can be object with lessons array, or just an array of lessons
    const lessons = Array.isArray(day) ? day : (day.lessons || day.periods || day.items || []);
    const dayName = day.dayName || day.name || DAY_NAMES[di] || `יום ${di+1}`;
    const isToday = di === today;

    if (lessons.length === 0) continue;

    html += `<div class="schedule-day${isToday ? ' schedule-today' : ''}">
      <div class="schedule-day-header">${esc(dayName)}${isToday ? ' ★' : ''}</div>
      <div class="schedule-lessons">`;

    for (const lesson of lessons) {
      if (!lesson) continue;
      const subject = lesson.subjectName || lesson.subject || lesson.name || lesson.title || '';
      const teacher = lesson.teacherName || lesson.teacher || '';
      const room = lesson.room || lesson.roomNumber || '';
      const num = lesson.lessonNumber || lesson.period || lesson.index || '';
      const time = lesson.startTime || lesson.time || '';

      if (!subject) continue;

      html += `<div class="schedule-lesson">
        <span class="lesson-num">${esc(String(num))}</span>
        <span class="lesson-subject">${esc(subject)}</span>
        ${teacher ? `<span class="lesson-teacher">${esc(teacher)}</span>` : ''}
        ${room ? `<span class="lesson-room">כיתה ${esc(room)}</span>` : ''}
        ${time ? `<span class="lesson-time">${esc(time)}</span>` : ''}
      </div>`;
    }

    html += `</div></div>`;
  }

  html += `</div></div>`;
  return html;
}

/* ═══════════════════════════════════════════════════════════════
   SECTION: הכל (פיד מלא — כל המידע: התראות, אירועים, הודעות, אישורים)
   ═══════════════════════════════════════════════════════════════ */
function renderFeed(notifications, classEvents) {
  const container = document.getElementById('feed-list');
  if (!container) return;

  const d = lastData?.data || {};
  const schoolEvResolved = resolveSchoolEventsForStudent(
    d.schoolEventsByStudent, currentStudent, d.schoolEvents || []);
  const mergedEvents = [...lastEvents];
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
  for (const se of schoolEvResolved) {
    mergedEvents.push({ name: se.name, type: se.type || 'event', date: todayStr, details: se.details || '', emoji: '🏫' });
  }

  const items = [];

  // 1. Notifications (homework, alerts, grades, etc.)
  const filteredNotifs = notifications
    .filter(n => (n.type !== 'homework' || isSubjectValid(n.student, n.subject)) && isValidNotification(n));
  for (const n of filteredNotifs) {
    items.push({ sortKey: dateSortKey(n.date), type: 'notification', n });
  }

  // 2. Class events (אירועים בשיעור) — per-student
  for (const raw of classEvents || []) {
    if (raw.includes('לא נמצאו') || !isEventValidForCurrentChild(raw)) continue;
    const parsed = parseClassEvent(raw);
    if (!parsed.date) continue;
    items.push({ sortKey: dateSortKey(parsed.date), type: 'class_event', parsed, raw });
  }

  // 3. Messages (shared)
  for (const m of d.messages || []) {
    const datePart = (m.date || '').split(/\s+/)[0] || parseDateFromSubject(m.subject) || todayStr;
    items.push({ sortKey: dateSortKey(datePart), type: 'message', m });
  }

  // 4. Approvals (scraped + signoffs + events)
  const scrapedApprovals = d.approvals || [];
  const signoffs = d.signoffs || [];
  for (const a of scrapedApprovals) {
    items.push({ sortKey: dateSortKey(a.date), type: 'approval', a, label: a.title || a.label, sub: a.itinerary });
  }
  for (const s of signoffs) {
    if (scrapedApprovals.some(x => (x.details || '') === (s.details || ''))) continue;
    const txt = (s.details || '').trim();
    if (txt.length > 15) {
      items.push({ sortKey: dateSortKey(s.date), type: 'approval', a: s, label: txt.slice(0, 60), sub: txt });
    }
  }
  for (const ev of lastEvents) {
    if (!ev.date || (ev.childName && currentStudent && ev.childName !== currentStudent)) continue;
    if (ev.type === 'event' || /אישור/.test(ev.details || '')) {
      let dateStr = ev.date;
      if (/^\d{2}\/\d{2}$/.test(dateStr)) dateStr = `${dateStr}/${today.getFullYear()}`;
      items.push({ sortKey: dateSortKey(dateStr), type: 'approval', a: ev, label: `${ev.emoji || '📋'} ${ev.name}`, sub: ev.details || '' });
    }
  }

  // 5. Special events (birthdays, school events) — only schoolEvResolved to avoid dupes with approvals
  const yearStr = String(today.getFullYear());
  for (const ev of schoolEvResolved) {
    if (!ev.name) continue;
    let dateStr = ev.date || todayStr;
    if (/^\d{2}\/\d{2}$/.test(dateStr)) dateStr = `${dateStr}/${yearStr}`;
    items.push({ sortKey: dateSortKey(dateStr), type: 'special_event', ev });
  }
  for (const ev of lastEvents) {
    if (!ev.date || (ev.childName && currentStudent && ev.childName !== currentStudent)) continue;
    if (ev.type === 'event' && !/אישור/.test(ev.details || '')) {
      let dateStr = ev.date;
      if (/^\d{2}\/\d{2}$/.test(dateStr)) dateStr = `${dateStr}/${yearStr}`;
      items.push({ sortKey: dateSortKey(dateStr), type: 'special_event', ev });
    }
  }

  items.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

  if (!items.length) {
    container.innerHTML = '<div class="empty" data-icon="📬">אין פריטים להצגה</div>';
    return;
  }

  container.innerHTML = items.map(it => {
    if (it.type === 'notification') {
      const n = it.n;
      const idx = allocCard(n);
      const label = TYPE_LABEL[n.type] || TYPE_LABEL.general;
      const id = n.type === 'homework' ? homeworkId(n) : '';
      const done = id && lastStatus[id]?.done;
      const meta = [n.alertDay || n.date, n.lesson ? `שיעור ${n.lesson}` : null, n.student ? `👤 ${n.student}` : null].filter(Boolean).join(' | ');
      return `<div class="card type-${n.type || 'general'}${done ? ' done-card' : ''} clickable-card" data-card-idx="${idx}" data-hw-id="${esc(id)}">
        <div class="card-header"><span class="card-title">${esc(n.subject || n.student || '?')}</span><span class="badge badge-${n.type || 'general'}">${label}</span></div>
        <div class="card-meta">${esc(meta)}</div>${n.homeworkText ? `<div class="hw-text">📝 ${esc(n.homeworkText)}</div>` : ''}
        <div class="card-expand-hint">לחץ לפרטים ›</div></div>`;
    }
    if (it.type === 'class_event') {
      const p = it.parsed;
      const idx = allocCard({ type: p.type, subject: p.title, date: p.date, description: it.raw, lesson: p.lesson });
      const label = TYPE_LABEL[p.type] || TYPE_LABEL.general;
      return `<div class="card type-${p.type || 'general'} clickable-card" data-card-idx="${idx}">
        <div class="card-header"><span class="card-title">${esc(p.title)}</span><span class="badge badge-${p.type || 'general'}">${label}</span></div>
        <div class="card-meta">${esc(p.date || '')}${p.lesson ? ` · שיעור ${p.lesson}` : ''}</div>
        ${p.note ? `<div class="card-desc">${esc(p.note)}</div>` : ''}<div class="card-expand-hint">לחץ לפרטים ›</div></div>`;
    }
    if (it.type === 'message') {
      const m = it.m;
      const cardObj = messageToCardObj(m);
      const idx = allocCard({ ...cardObj, type: 'message', _msgRaw: m });
      const readStatus = !!m.read;
      const meta = [m.from, m.date, m.time].filter(Boolean).join(' | ');
      const bodyPreview = m.body && m.body.length > 0
        ? esc(m.body.slice(0, 120)) + (m.body.length > 120 ? '...' : '')
        : '';
      return `<div class="card type-message${!readStatus ? ' msg-unread-card' : ''} clickable-card" data-card-idx="${idx}" data-msg-id="${esc(msgId(m))}">
        <div class="card-header"><span class="card-title">${esc(cardObj.subject)}</span>${!readStatus ? '<span class="badge badge-message">📨 חדש</span>' : '<span class="badge badge-message-read">✓ נקרא</span>'}</div>
        <div class="card-meta">${esc(meta)}</div>${bodyPreview ? `<div class="card-desc">${bodyPreview}</div>` : ''}<div class="card-expand-hint">לחץ לקריאה ›</div></div>`;
    }
    if (it.type === 'approval') {
      const a = it.a;
      const label = it.label || a.label || '';
      const sub = it.sub || a.itinerary || a.details || '';
      const approved = a.status === 'approved' || lastStatus[approvalId(a)]?.approved;
      const idx = allocCard({ type: 'approval', subject: label, description: sub, ...a });
      return `<div class="card type-general${approved ? ' done-card' : ''}" data-card-idx="${idx}">
        <div class="card-header"><span class="card-title">${esc(label)}</span>${approved ? '<span class="badge badge-grade">✓ אושר</span>' : '<span class="badge badge-general">ממתין</span>'}</div>
        ${sub ? `<div class="card-meta">${esc(sub.slice(0, 100))}</div>` : ''}</div>`;
    }
    if (it.type === 'special_event') {
      const ev = it.ev;
      const label = `${ev.emoji || '📅'} ${ev.name}`;
      const idx = allocCard({ type: 'event', subject: ev.name, description: ev.details });
      return `<div class="card type-general" data-card-idx="${idx}"><div class="card-title">${esc(label)}</div>${ev.details ? `<div class="card-desc">${esc(ev.details)}</div>` : ''}</div>`;
    }
    return '';
  }).filter(Boolean).join('');
}

/* ═══════════════════════════════════════════════════════════════
   MODAL — פרטים מלאים בלחיצה על כרטיס
   ═══════════════════════════════════════════════════════════════ */
function openCardDetail(n, hwId, msgId) {
  const modal   = document.getElementById('detail-modal');
  const content = document.getElementById('modal-content');
  if (!modal || !content || !n) return;
  const mid = msgId || (n.type === 'message' && n._msgRaw ? msgId(n._msgRaw) : '');
  if (n.type === 'message' && mid) markMessageRead(mid);

  const label   = TYPE_LABEL[n.type] || TYPE_LABEL.general;
  const done    = hwId && lastStatus[hwId]?.done;

  // Build info rows (message-aware labels)
  const isMsg = n.type === 'message';
  const rows = [];
  if (n.student)  rows.push(['👤 תלמיד/ה', esc(n.student)]);
  if (n.subject)  rows.push([isMsg ? '📌 נושא'    : '📖 מקצוע',   esc(n.subject)]);
  if (n.alertDay) rows.push([isMsg ? '✉️ שולח/ת'  : '📅 יום',      esc(fixSpacingForDisplay(n.alertDay))]);
  // For messages: alertDay = sender, so show date separately
  if (isMsg && n.date)            rows.push(['📅 תאריך', esc(n.date)]);
  // For non-messages: show date only when alertDay is absent
  if (!isMsg && !n.alertDay && n.date) rows.push(['📅 תאריך', esc(n.date)]);
  if (n.lesson)    rows.push(['🔢 שיעור',    esc(String(n.lesson))]);
  if (n.alertTime) rows.push(['⏰ שעה',       esc(n.alertTime)]);
  if (n.category)  rows.push([isMsg ? '📋 סטטוס' : '📂 קטגוריה', esc(n.category)]);

  const detailRows = rows.map(([k, v]) =>
    `<div class="modal-row"><span class="modal-key">${k}</span><span class="modal-val">${v}</span></div>`
  ).join('');

  const hwSection = n.homeworkText ? `
    <div class="modal-box">
      <div class="modal-box-label">📝 מטלה</div>
      <div class="modal-box-text hw-text-lg">${esc(n.homeworkText)}</div>
    </div>` : '';

  const descSection = (n.description && n.description !== n.homeworkText) ? `
    <div class="modal-box modal-box-desc">
      <div class="modal-box-label">${isMsg ? '📨 תוכן ההודעה' : '📋 תיאור מלא מהמערכת'}</div>
      <div class="modal-box-text">${esc(fixSpacingForDisplay(n.description))}</div>
    </div>` : (isMsg ? `
    <div class="modal-box modal-box-desc">
      <a class="btn-open-webtop" href="https://webtop.smartschool.co.il/messages" target="_blank" rel="noopener">פתח באתר Webtop לצפייה בתוכן המלא ›</a>
    </div>` : '');

  const doneBtn = n.type === 'homework' && hwId && !done ? `
    <button class="btn-done btn-done-modal"
      data-id="${esc(hwId)}"
      data-hw-text="${esc(n.homeworkText || '')}"
      data-student="${esc(n.student || '')}"
      data-subject="${esc(n.subject || '')}"
      data-date="${esc(n.date || '')}"
      data-lesson="${esc(String(n.lesson ?? ''))}"
      data-alert-day="${esc(n.alertDay || '')}"
      data-description="${esc((n.description || '').slice(0, 300))}"
      onclick="handleMarkDone(this); closeModal()">
      ✓ סמן כהושלם
    </button>` : '';

  const doneBadge = done ? `<div class="modal-done-badge">✅ שיעורי הבית הושלמו</div>` : '';

  content.innerHTML = `
    <div class="modal-header-row">
      <span class="badge badge-${n.type || 'general'} badge-lg">${label}</span>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-title">${esc(n.subject || (n.description || '').slice(0, 60) || '?')}</div>
    ${doneBadge}
    <div class="modal-rows">${detailRows}</div>
    ${hwSection}
    ${descSection}
    ${doneBtn}
  `;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const modal = document.getElementById('detail-modal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

/* ─── Homework history modal ────────────────────────────────────────────── */
function openHomeworkHistory() {
  const all     = (lastData?.data?.notifications || []).filter(n => n.type === 'homework' && n.date);
  const visible = currentStudent ? all.filter(n => n.student === currentStudent) : all;
  const done    = visible
    .filter(n => lastStatus[homeworkId(n)]?.done)
    .sort((a, b) => {
      // Most recently completed first
      const aT = lastStatus[homeworkId(a)]?.markedAt || '';
      const bT = lastStatus[homeworkId(b)]?.markedAt || '';
      return bT.localeCompare(aT);
    });

  const modal   = document.getElementById('detail-modal');
  const content = document.getElementById('modal-content');
  if (!modal || !content) return;

  const cardsHtml = done.map(n => {
    const id       = homeworkId(n);
    const markedAt = lastStatus[id]?.markedAt
      ? new Date(lastStatus[id].markedAt).toLocaleString('he-IL', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      : '—';
    const meta = [
      n.alertDay || n.date,
      n.lesson   ? `שיעור ${n.lesson}` : null,
      n.student  ? `👤 ${n.student}`   : null,
    ].filter(Boolean).join(' | ');

    return `
      <div class="card type-homework history-done-card">
        <div class="card-header">
          <div class="card-title-row">
            <span class="card-title">${esc(n.subject || '?')}</span>
            <span class="badge" style="background:rgba(16,185,129,.15);color:#34d399;border:1px solid rgba(16,185,129,.35);font-size:0.65rem;">✅ הושלם</span>
          </div>
        </div>
        <div class="card-meta">${esc(meta)}</div>
        ${n.homeworkText ? `<div class="hw-text">📝 ${esc(n.homeworkText)}</div>` : ''}
        <div class="hw-marked-at">⏰ סומן: ${esc(markedAt)}</div>
      </div>`;
  }).join('');

  content.innerHTML = `
    <div class="modal-header-row">
      <span class="badge badge-homework badge-lg">📋 היסטוריה</span>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-title">שיעורי בית שהושלמו</div>
    <p style="font-size:0.82rem;color:#64748b;margin:0 0 1rem 0;">${done.length} פריטים</p>
    ${cardsHtml || '<div class="empty" data-icon="📭">אין היסטוריה עדיין</div>'}
  `;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/* ─── Full homework history modal (from API) ────────────────────────────── */
function openAllHomeworkHistory() {
  const allHwByStudent = lastData?.data?.homeworkByStudent || {};
  const studentItems = currentStudent ? (allHwByStudent[currentStudent] || []) : Object.values(allHwByStudent).flat();
  const items = studentItems
    .filter(h => h.source === 'history')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const modal   = document.getElementById('detail-modal');
  const content = document.getElementById('modal-content');
  if (!modal || !content) return;

  const cardsHtml = items.map(h => {
    const meta = [
      h.date,
      h.lesson ? `שיעור ${h.lesson}` : null,
      h.teacher || null,
    ].filter(Boolean).join(' | ');
    return `
      <div class="card type-homework history-done-card">
        <div class="card-header">
          <div class="card-title-row">
            <span class="card-title">${esc(h.subject || '?')}</span>
            ${currentStudent ? '' : `<span class="badge" style="font-size:0.62rem;opacity:.8;">${esc(h.student || '')}</span>`}
          </div>
        </div>
        <div class="card-meta">${esc(meta)}</div>
        ${h.text ? `<div class="hw-text">📝 ${esc(h.text)}</div>` : ''}
      </div>`;
  }).join('');

  content.innerHTML = `
    <div class="modal-header-row">
      <span class="badge badge-homework badge-lg">📋 היסטוריית שיעורי בית</span>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-title">שיעורי בית — היסטוריה מלאה</div>
    <p style="font-size:0.82rem;color:#64748b;margin:0 0 1rem 0;">${items.length} פריטים</p>
    ${cardsHtml || '<div class="empty" data-icon="📭">אין היסטוריה</div>'}
  `;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/* ─── Event delegation: card click → open modal ────────────────────────── */
document.addEventListener('click', e => {
  // Approval button
  const approvBtn = e.target.closest('.btn-approval-done');
  if (approvBtn) {
    const id = approvBtn.dataset.approvalId;
    const url = approvBtn.dataset.approvalUrl;
    if (id) markApprovalDone(id, url);
    return;
  }
  if (e.target.closest('.btn-done, .modal-close, .child-select, #btn-refresh, .btn-retry, .btn-hw-history, .msg-checkbox-wrap, .msg-bulk-toolbar')) return;

  // Close modal when clicking backdrop
  if (e.target.id === 'detail-modal') { closeModal(); return; }

  // Card click
  const card = e.target.closest('[data-card-idx]');
  if (!card) return;
  const n    = _cardStore[+card.dataset.cardIdx];
  const hwId = card.dataset.hwId || '';
  const msgId = card.dataset.msgId || '';
  if (n) openCardDetail(n, hwId, msgId);
});

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

/* ─── Mark done ─────────────────────────────────────────────────────────── */
function handleMarkDone(btn) {
  if (btn.disabled) return;
  markDone(btn.dataset.id, btn.dataset.hwText, btn.dataset.student, btn, {
    subject:     btn.dataset.subject,
    date:        btn.dataset.date,
    lesson:      btn.dataset.lesson,
    alertDay:    btn.dataset.alertDay,
    description: btn.dataset.description,
  });
}

async function markMessageRead(id) {
  if (!id) return;
  try {
    const res = await fetch('/api/messages/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const j = await res.json();
    if (j.ok) {
      lastStatus[id] = { read: true };
      // Update modal badge if it shows this message
      const modal = document.getElementById('detail-modal');
      if (modal && !modal.classList.contains('hidden')) {
        const rows = modal.querySelectorAll('.modal-row');
        for (const row of rows) {
          const key = row.querySelector('.modal-key');
          if (key && (key.textContent.includes('סטטוס') || key.textContent.includes('קטגוריה'))) {
            const val = row.querySelector('.modal-val');
            if (val && val.textContent.includes('לא נקרא')) {
              val.textContent = 'נקרא ✓';
              val.style.color = '#34d399';
              break;
            }
          }
        }
      }
      rerender();
    }
  } catch (e) { console.warn('markMessageRead:', e); }
}

/* ─── Bulk message selection ─────────────────────────────────────────────── */
const _selectedMsgIds = new Set();

function toggleMsgSelect(checkbox) {
  const id = checkbox.dataset.msgId;
  if (checkbox.checked) _selectedMsgIds.add(id);
  else _selectedMsgIds.delete(id);
  _updateBulkToolbar();
}

function _updateBulkToolbar() {
  const toolbar = document.getElementById('msg-bulk-toolbar');
  const countEl = document.getElementById('msg-bulk-count');
  if (!toolbar) return;
  if (_selectedMsgIds.size > 0) {
    toolbar.style.display = 'flex';
    if (countEl) countEl.textContent = `${_selectedMsgIds.size} נבחרו`;
  } else {
    toolbar.style.display = 'none';
  }
}

async function bulkMarkMessages(asRead) {
  const ids = [..._selectedMsgIds];
  for (const id of ids) {
    try {
      const res = await fetch('/api/messages/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, read: asRead }),
      });
      const j = await res.json();
      if (j.ok) lastStatus[id] = { read: asRead };
    } catch (e) { console.warn('bulkMarkMessages:', e); }
  }
  _selectedMsgIds.clear();
  rerender();
}

function clearMsgSelection() {
  _selectedMsgIds.clear();
  document.querySelectorAll('.msg-checkbox:checked').forEach(cb => { cb.checked = false; });
  _updateBulkToolbar();
}

async function markApprovalDone(id, webtopUrl) {
  try {
    const res = await fetch('/api/approval/done', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const j = await res.json();
    if (j.ok) {
      lastStatus[id] = { approved: true };
      rerender();
      // פתיחת דף האישור ב-Webtop — המשתמש יוכל לאשר שם והוא יישמר באתר
      if (webtopUrl && webtopUrl.startsWith('http')) {
        window.open(webtopUrl, '_blank', 'noopener');
      }
    }
  } catch (e) { console.warn('markApprovalDone:', e); }
}

async function markDone(id, homeworkText, studentName, btn, extra = {}) {
  btn.disabled    = true;
  btn.textContent = '...';
  try {
    const res = await fetch('/api/homework/done', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, homeworkText, studentName, ...extra }),
    });
    const result = await res.json();
    if (result.ok) {
      lastStatus[id] = { done: true };
      rerender();
    } else {
      throw new Error(result.error || 'שגיאה');
    }
  } catch (err) {
    console.error('markDone error:', err);
    btn.disabled    = false;
    btn.textContent = '✓ סמן כהושלם';
  }
}

/* ─── Navigate to a section programmatically ───────────────────────────── */
function navigateTo(section) {
  document.querySelectorAll('.stab').forEach(s => s.classList.remove('active'));
  const btn = document.querySelector(`.stab[data-section="${section}"]`);
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const target = document.getElementById(`section-${section}`);
  if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
  currentSection = section;
  const topH = document.querySelector('.top-bar')?.offsetHeight || 0;
  window.scrollTo({ top: topH, behavior: 'smooth' });
}

/* ─── Section tab navigation ────────────────────────────────────────────── */
document.getElementById('section-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.stab');
  if (!btn) return;
  const section = btn.dataset.section;

  document.querySelectorAll('.stab').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });

  const target = document.getElementById(`section-${section}`);
  if (target) { target.classList.remove('hidden'); target.classList.add('active'); }

  currentSection = section;
  const topH = document.querySelector('.top-bar').offsetHeight;
  window.scrollTo({ top: topH, behavior: 'smooth' });
});

/* ─── Pull-to-refresh ───────────────────────────────────────────────────── */
const ptrEl     = document.getElementById('ptr');
const ptrTextEl = document.getElementById('ptr-text');

document.addEventListener('touchstart', e => {
  if (window.scrollY === 0) { ptrStartY = e.touches[0].clientY; ptrPulling = true; }
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
    ptrTextEl.textContent = 'שולח בקשה לסריקה...';
    try {
      await fetch('/api/trigger', { method: 'POST' });
      ptrTextEl.textContent = '✉️ בקשה נשלחה — אם push_loop רץ בבית, ייעדכן תוך דקה';
      await fetchAll(true);
      // Poll for fresh data (home PC may push within 1-2 min)
      const prevAge = lastData?.cacheAge ?? 999999;
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > 8) { clearInterval(pollInterval); return; }
        try {
          const r = await fetch('/api/data');
          const j = await r.json();
          if (j.cacheAge !== undefined && (j.cacheAge < prevAge - 30 || (prevAge > 120 && j.cacheAge < 60))) {
            clearInterval(pollInterval);
            lastData = j;
            const statusRes = await fetch('/api/status');
            lastStatus = await statusRes.json();
            render(j, lastStatus);
            ptrTextEl.textContent = '✅ נתונים עודכנו!';
          }
        } catch {}
      }, 15000);
    } catch {
      ptrTextEl.textContent = '❌ שגיאה — נסה שוב';
    }
    setTimeout(() => {
      ptrEl.classList.remove('visible', 'refreshing');
      ptrTextEl.textContent = 'משוך למטה לרענון';
    }, 3500);
  } else {
    ptrEl.classList.remove('visible');
  }
}, { passive: true });

/* ═══════════════════════════════════════════════════════════════
   AGE CALCULATION — based on birthYear + "DD/MM" birthday
   ═══════════════════════════════════════════════════════════════ */
/**
 * Returns the current age for a given birthYear + birthDayMonth ("DD/MM").
 * Returns null if inputs are invalid.
 */
function calcAge(birthYear, birthDayMonth) {
  const parts = (birthDayMonth || '').split('/');
  const dd = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!dd || !mm || !birthYear) return null;
  const today       = new Date();
  let   age         = today.getFullYear() - birthYear;
  const bdThisYear  = new Date(today.getFullYear(), mm - 1, dd);
  if (today < bdThisYear) age--;
  return age >= 0 ? age : null;
}

/* ═══════════════════════════════════════════════════════════════
   SUBJECT VALIDATION — per-child curriculum check
   ═══════════════════════════════════════════════════════════════ */
/**
 * Returns false when a notification's subject is NOT in the child's
 * validSubjects list (i.e. it might be a parsing error or wrong child).
 * Returns true when the subject is valid, or when no config is available.
 */
function isSubjectValid(studentName, subject) {
  if (!lastChildren?.children?.length || !studentName || !subject) return true;
  const config = lastChildren.children.find(c => c.name === studentName);
  if (!config?.validSubjects) return true;
  return config.validSubjects.includes(subject);
}

/* ═══════════════════════════════════════════════════════════════
   CLASS EVENT PARSER — extract teacher, lesson, type from raw string
   ═══════════════════════════════════════════════════════════════ */
/**
 * Parses a raw class-event string (pipe-separated or free text).
 * Returns { type, date, lesson, teacher, title, note, raw }
 */
function parseClassEvent(raw) {
  raw = fixSpacingForDisplay(raw);
  const parts      = raw.split('|').map(s => s.trim());
  const title      = parts[0] || raw;
  const dateMatch  = raw.match(/(\d{2}\/\d{2}\/\d{4})/);
  const dateStr    = dateMatch ? dateMatch[1] : null;
  const lessonMatch = raw.match(/שיעור\s+(\d+)/);
  const lesson     = lessonMatch ? lessonMatch[1] : null;
  // Teacher name typically appears in parentheses
  const teacherMatch = raw.match(/\(([^)]+)\)/);
  const teacher    = teacherMatch ? teacherMatch[1] : null;
  // Note = remaining parts after date/lesson/teacher chunks
  const note = parts
    .slice(1)
    .filter(p => !p.match(/^\d{2}\/\d{2}\/\d{4}$/) && !p.match(/^שיעור\s+\d+$/) && !p.match(/^\([^)]+\)$/))
    .join(' ')
    .trim();

  let type = 'general';
  if      (title.includes('חוסר ציוד'))                                type = 'missing_equipment';
  else if (title.includes('אי הכנת שיעורי') || title.includes('אי הכנה')) type = 'homework_not_done';
  else if (title.includes('שיעורי-בית') || title.includes('שיעורי בית')) type = 'homework';
  else if (title.includes('איחור'))                                    type = 'late';
  else if (title.includes('חיסור') || title.includes('נעדר'))          type = 'absence';
  else if (title.includes('ציון'))                                     type = 'grade';

  return { type, date: dateStr, lesson, teacher, title, note, raw };
}

/* ═══════════════════════════════════════════════════════════════
   GRADE VALIDATION — hide class events for the wrong grade level
   ═══════════════════════════════════════════════════════════════ */
const GRADE_MAP = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8 };

/** Match student name — handles "אמי" vs "גונשרוביץ אמי" format differences */
function studentMatch(notifName, selectedName) {
  if (!notifName || !selectedName) return false;
  const a = notifName.trim();
  const b = selectedName.trim();
  if (a === b) return true;
  // "אמי" matches "גונשרוביץ אמי" — short name is last word of full name
  if (b.endsWith(' ' + a) || a.endsWith(' ' + b)) return true;
  // Also handle reverse
  if (b.includes(a) || a.includes(b)) return true;
  return false;
}

/** Generic resolver: find per-student data using fuzzy name matching */
function resolveForStudent(byStudent, currentStudent, fallback) {
  if (!byStudent) return fallback || [];
  if (!currentStudent) return fallback || [];
  if (byStudent[currentStudent]) return byStudent[currentStudent];
  const key = Object.keys(byStudent).find(k => studentMatch(k, currentStudent));
  return key ? byStudent[key] : (fallback || []);
}

/** Resolve classEvents for currentStudent — handles "אמי" vs "גונשרוביץ אמי" key mismatch */
function resolveClassEventsForStudent(byStudent, currentStudent, fallback) {
  return resolveForStudent(byStudent, currentStudent, fallback);
}

/** Resolve schoolEvents for currentStudent */
function resolveSchoolEventsForStudent(byStudent, currentStudent, fallback) {
  return resolveForStudent(byStudent, currentStudent, fallback);
}

/** Find child config — handles "אמי" vs "גונשרוביץ אמי" */
function resolveChildConfig(name) {
  if (!lastChildren?.children?.length) return null;
  const exact = lastChildren.children.find(c => c.name === name);
  if (exact) return exact;
  return lastChildren.children.find(c => c.name.endsWith(' ' + name) || c.name === name);
}

/**
 * Returns false if the raw class-event text explicitly references a grade
 * that does NOT match the currently selected child's configured grade.
 * Returns true (valid) when there is no grade conflict or no config.
 */
function isEventValidForCurrentChild(raw) {
  if (!currentStudent || !lastChildren?.children?.length) return true;
  const config = resolveChildConfig(currentStudent);
  if (!config?.grade) return true;
  const childGrade = GRADE_MAP[config.grade];
  if (!childGrade) return true;

  // Look for patterns like "כיתה ד" or "כיתות ג-ה"
  const gradePattern = /כית(?:ה|ות)\s*([א-ח])(?:\s*[-–]\s*([א-ח]))?/g;
  let match;
  while ((match = gradePattern.exec(raw)) !== null) {
    const fromGrade = GRADE_MAP[match[1]];
    const toGrade   = match[2] ? GRADE_MAP[match[2]] : fromGrade;
    if (fromGrade && toGrade) {
      const lo = Math.min(fromGrade, toGrade);
      const hi = Math.max(fromGrade, toGrade);
      if (childGrade < lo || childGrade > hi) return false;
    }
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════
   SMART INSIGHTS BAR — summary chips from /api/insights
   ═══════════════════════════════════════════════════════════════ */
function renderInsights() {
  const el = document.getElementById('insights-bar');
  if (!el) return;

  const chips = [];
  if (lastInsights?.ok) {
    const { overduePendingCount, upcoming48hCount, alertsRecentCount,
            trend, alertsThisWeek, alertsLastWeek } = lastInsights;
    if (overduePendingCount > 0)
      chips.push(`<span class="insight-chip chip-overdue chip-clickable" onclick="navigateTo('homework')" title="לחץ לשיעורי בית">⏰ ${overduePendingCount} שיעורי בית פגי תוקף ›</span>`);
    if (upcoming48hCount > 0)
      chips.push(`<span class="insight-chip chip-soon chip-clickable" onclick="navigateTo('homework')" title="לחץ לשיעורי בית">📅 ${upcoming48hCount} שיעורי בית ב-48 שעות ›</span>`);
    if (alertsRecentCount > 0)
      chips.push(`<span class="insight-chip chip-alerts chip-clickable" onclick="navigateTo('alerts')" title="לחץ להתראות">📊 ${alertsRecentCount} התראות השבוע ›</span>`);
    if (trend === 'up')
      chips.push(`<span class="insight-chip chip-trend-up">📈 עלייה בהתראות (${alertsThisWeek} vs ${alertsLastWeek} שבוע שעבר)</span>`);
    else if (trend === 'down')
      chips.push(`<span class="insight-chip chip-trend-down">📉 ירידה בהתראות (${alertsThisWeek} vs ${alertsLastWeek} שבוע שעבר)</span>`);
  }

  if (chips.length) {
    el.innerHTML = chips.join('');
  } else {
    // Figma: green status banner — "יום שישי - אין שיעורי בית!" on Friday, else "הכל תקין"
    const now = new Date();
    const isFriday = now.getDay() === 5;
    const msg = isFriday ? 'יום שישי - אין שיעורי בית! 😊' : 'הכל תקין ✓';
    el.innerHTML = `<div class="insight-banner">${msg}</div>`;
  }
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function showSpinner(show) {
  document.getElementById('spinner').classList.toggle('hidden', !show);
}
function showErrorBanner(show) {
  const el = document.getElementById('error-banner');
  if (el) el.classList.toggle('hidden', !show);
}
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function homeworkId(n) {
  return `${(n.student || '').trim()}_${(n.subject || '').trim()}_${(n.date || '').trim()}_${(n.lesson || '').toString().trim()}`;
}
function notifId(n) {
  return `notif_${(n.student||'').trim()}_${(n.type||'').trim()}_${(n.subject||'').trim()}_${(n.date||'').trim()}_${(n.lesson||'').toString().trim()}`;
}
function msgId(m) {
  const s = `${m.from || ''}|${m.date || ''}|${(m.subject || '').slice(0, 50)}`;
  return 'msg_' + s.replace(/[^a-zA-Z0-9\u0590-\u05FF|_\-\/\.]/g, '_');
}
/** Convert raw message object to card object (for feed + modal) */
function messageToCardObj(m) {
  const readStatus = m.read || lastStatus[msgId(m)]?.read;
  return {
    type:        'message',
    subject:     m.subject  || '(ללא נושא)',
    student:     m.student  || null,
    alertDay:    m.from     ? `${m.from}${m.fromRole ? ` · ${m.fromRole}` : ''}` : null,
    date:        m.date     || null,
    alertTime:   m.time     || null,
    category:    readStatus ? 'נקרא ✓' : 'לא נקרא',
    description: m.body     || null,
    _msgRaw:     m,
  };
}
function approvalId(item) {
  if (item.msgId) return 'approval_' + String(item.msgId).replace(/[^a-zA-Z0-9\-_=]/g, '_').slice(0, 100);
  const s = `${item.label || ''}|${item.sub || ''}|${item.date || ''}`;
  return 'approval_' + s.replace(/[^a-zA-Z0-9\u0590-\u05FF|_\-\/\.]/g, '_').slice(0, 80);
}
/** Parse DD/MM/YYYY from subject when date is missing (e.g. "|04/03/2026|") */
function parseDateFromSubject(subject) {
  if (!subject) return null;
  const m = String(subject).match(/(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : null;
}
function dateSortKey(dateStr) {
  if (!dateStr) return 0;
  const [d, m, y] = dateStr.split('/');
  return parseInt(`${y}${m}${d}`, 10) || 0;
}
function calcDaysLeft(dateStr) {
  if (!dateStr) return null;
  const [dd, mm, yyyy] = dateStr.split('/').map(Number);
  if (!dd || !mm || !yyyy) return null;
  const hwDate = new Date(yyyy, mm - 1, dd);
  const now    = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((hwDate - now) / (1000 * 60 * 60 * 24));
}

/* ─── Theme toggle (Light / Dark) ──────────────────────────────────────── */
const THEME_KEY = 'webtopkids_theme';
function getTheme() { return localStorage.getItem(THEME_KEY) || 'light'; }
function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.body.classList.toggle('theme-light', theme === 'light');
  document.body.classList.toggle('theme-dark',  theme === 'dark');
  const icon = document.querySelector('.theme-icon');
  if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
}
function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
}
function initTheme() {
  setTheme(getTheme());
  const btn = document.getElementById('btn-theme');
  if (btn) btn.addEventListener('click', toggleTheme);
}

/* ─── Auto-refresh every 5 min + init ─────────────────────────────────── */
setInterval(fetchAll, 5 * 60 * 1000);
initTheme();
initPhotoUpload();
fetchAll();
