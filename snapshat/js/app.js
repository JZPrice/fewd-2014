// snapshat - private gut-health tracker
// All data lives in localStorage. Photos are never persisted.

const STORAGE_KEY = 'snapshat.entries.v1';

const TYPES = [
  {
    n: 1,
    name: 'Separate hard lumps',
    desc: 'Like nuts. Hard to pass.',
    color: '#d9b58a',
    tag: { label: 'constipated', cls: 'alert' },
  },
  {
    n: 2,
    name: 'Lumpy sausage',
    desc: 'Sausage-shaped but lumpy.',
    color: '#c89765',
    tag: { label: 'slightly constipated', cls: 'warn' },
  },
  {
    n: 3,
    name: 'Cracked sausage',
    desc: 'Sausage with cracks on the surface.',
    color: '#a87a4a',
    tag: { label: 'normal', cls: 'ideal' },
  },
  {
    n: 4,
    name: 'Smooth sausage',
    desc: 'Like a soft, smooth snake. The ideal.',
    color: '#8a5e36',
    tag: { label: 'ideal', cls: 'ideal' },
  },
  {
    n: 5,
    name: 'Soft blobs',
    desc: 'Clear-cut edges. Passes easily.',
    color: '#a87a52',
    tag: { label: 'lacking fiber', cls: 'warn' },
  },
  {
    n: 6,
    name: 'Mushy & ragged',
    desc: 'Fluffy pieces, ragged edges.',
    color: '#bf8758',
    tag: { label: 'mild diarrhea', cls: 'warn' },
  },
  {
    n: 7,
    name: 'Watery',
    desc: 'No solid pieces. Entirely liquid.',
    color: '#cf9870',
    tag: { label: 'diarrhea', cls: 'alert' },
  },
];

// ---------- inline SVG illustrations (abstract, friendly) ----------

function illoFor(type, color) {
  const c = color;
  switch (type) {
    case 1: // separate hard lumps
      return `<svg viewBox="0 0 70 50" xmlns="http://www.w3.org/2000/svg">
        <circle cx="18" cy="26" r="7" fill="${c}"/>
        <circle cx="33" cy="22" r="8" fill="${c}"/>
        <circle cx="49" cy="28" r="7" fill="${c}"/>
        <circle cx="25" cy="36" r="5" fill="${c}"/>
        <circle cx="42" cy="36" r="5" fill="${c}"/>
      </svg>`;
    case 2: // lumpy sausage
      return `<svg viewBox="0 0 70 50" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 28 Q14 18 22 24 Q30 14 38 22 Q46 14 54 24 Q62 18 64 28 Q62 38 54 32 Q46 40 38 32 Q30 40 22 32 Q14 38 8 28 Z" fill="${c}"/>
      </svg>`;
    case 3: // cracked sausage
      return `<svg viewBox="0 0 70 50" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="20" width="54" height="14" rx="7" fill="${c}"/>
        <line x1="18" y1="27" x2="22" y2="27" stroke="rgba(0,0,0,0.25)" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="28" y1="25" x2="32" y2="29" stroke="rgba(0,0,0,0.25)" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="38" y1="29" x2="44" y2="25" stroke="rgba(0,0,0,0.25)" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="48" y1="27" x2="54" y2="27" stroke="rgba(0,0,0,0.25)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    case 4: // smooth sausage
      return `<svg viewBox="0 0 70 50" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 28 Q20 14 35 25 Q50 36 64 22" stroke="${c}" stroke-width="14" stroke-linecap="round" fill="none"/>
      </svg>`;
    case 5: // soft blobs
      return `<svg viewBox="0 0 70 50" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="18" cy="26" rx="10" ry="8" fill="${c}"/>
        <ellipse cx="36" cy="28" rx="11" ry="9" fill="${c}"/>
        <ellipse cx="55" cy="25" rx="9" ry="7" fill="${c}"/>
      </svg>`;
    case 6: // mushy ragged
      return `<svg viewBox="0 0 70 50" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 32 Q10 22 16 26 Q22 18 28 26 Q34 16 40 26 Q46 18 52 26 Q58 22 64 32 Q60 40 50 36 Q40 42 30 36 Q20 42 12 38 Q6 36 6 32 Z" fill="${c}"/>
      </svg>`;
    case 7: // watery
      return `<svg viewBox="0 0 70 50" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="35" cy="32" rx="28" ry="8" fill="${c}" opacity="0.85"/>
        <ellipse cx="35" cy="30" rx="22" ry="4" fill="${c}" opacity="0.5"/>
      </svg>`;
  }
  return '';
}

// ---------- storage ----------

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function addEntry(entry) {
  const entries = loadEntries();
  entries.push(entry);
  entries.sort((a, b) => b.t - a.t);
  saveEntries(entries);
}

function deleteEntry(id) {
  const entries = loadEntries().filter(e => e.id !== id);
  saveEntries(entries);
}

// ---------- view routing ----------

const views = {};
document.querySelectorAll('.view').forEach(v => {
  views[v.dataset.view] = v;
});

let currentView = 'home';

function go(view) {
  if (view === currentView && view !== 'capture') return;
  views[currentView]?.classList.add('hidden');
  views[view]?.classList.remove('hidden');
  currentView = view;

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.go === view);
  });

  // entry hooks
  if (view === 'home') renderHome();
  if (view === 'history') renderHistory();
  if (view === 'insights') renderInsights();
  if (view === 'capture') startCamera();
  if (view === 'classify') renderClassify();

  if (view !== 'capture') stopCamera();

  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-go]');
  if (t) {
    e.preventDefault();
    go(t.dataset.go);
  }
});

// ---------- home ----------

function todayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function computeStats(entries) {
  const todayK = todayKey();
  const todayCount = entries.filter(e => todayKey(e.t) === todayK).length;

  // streak: consecutive days with at least one entry, ending today or yesterday
  const days = new Set(entries.map(e => todayKey(e.t)));
  let streak = 0;
  let d = new Date();
  if (!days.has(todayKey(d.getTime()))) {
    d.setDate(d.getDate() - 1);
    if (!days.has(todayKey(d.getTime()))) {
      return { todayCount, streak: 0, weekType: null };
    }
  }
  while (days.has(todayKey(d.getTime()))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  // most common type this week
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = entries.filter(e => e.t >= weekAgo);
  let weekType = null;
  if (recent.length) {
    const counts = {};
    for (const e of recent) counts[e.type] = (counts[e.type] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    weekType = top[0];
  }
  return { todayCount, streak, weekType };
}

function renderHome() {
  const entries = loadEntries();
  const stats = computeStats(entries);
  document.getElementById('stat-today').textContent = stats.todayCount;
  document.getElementById('stat-streak').textContent = stats.streak;
  document.getElementById('stat-week-type').textContent = stats.weekType ? `T${stats.weekType}` : '—';

  const list = document.getElementById('recent-list');
  if (!entries.length) {
    list.innerHTML = '<li class="empty">no snaps yet — tap <em>New snap</em> to start.</li>';
    return;
  }
  list.innerHTML = entries.slice(0, 5).map(renderEntryItem).join('');
}

function renderEntryItem(e) {
  const t = TYPES[e.type - 1];
  const when = new Date(e.t);
  const timeStr = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateStr = when.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const flags = (e.flags || []).map(f => `<span class="flag-pill">${f}</span>`).join('');
  const notes = e.notes ? `<div class="entry-notes">${escapeHtml(e.notes)}</div>` : '';
  return `<li class="entry-item" data-id="${e.id}">
    <div class="entry-type-pill" style="background:${t.color}">${t.n}</div>
    <div class="entry-meta">
      <span class="entry-name">${t.name}</span>
      <span class="entry-sub">${dateStr} · ${timeStr}</span>
      ${notes}
    </div>
    <div class="entry-flags">${flags}</div>
  </li>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

document.getElementById('btn-new-snap').addEventListener('click', () => go('capture'));

// ---------- camera ----------

let mediaStream = null;
let capturedDataUrl = null;
const video = document.getElementById('camera-video');
const canvas = document.getElementById('camera-canvas');
const preview = document.getElementById('captured-preview');
const fallback = document.getElementById('camera-fallback');
const shutterBtn = document.getElementById('shutter-btn');
const skipBtn = document.getElementById('skip-photo-btn');
const fileInput = document.getElementById('file-input');
const retakeBtn = document.getElementById('retake-btn');
const confirmBtn = document.getElementById('confirm-photo-btn');
const captureControls = document.querySelector('#capture-controls, .capture-controls');
const postControls = document.getElementById('post-capture-controls');
const preControls = document.querySelector('section[data-view="capture"] .capture-controls:not(#post-capture-controls)');

async function startCamera() {
  stopCamera();
  resetCaptureView();
  if (!navigator.mediaDevices?.getUserMedia) {
    showFallback();
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = mediaStream;
    fallback.classList.add('hidden');
    video.classList.remove('hidden');
  } catch (err) {
    console.warn('Camera unavailable:', err);
    showFallback();
  }
}

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  video.srcObject = null;
}

function showFallback() {
  fallback.classList.remove('hidden');
  video.classList.add('hidden');
}

function resetCaptureView() {
  capturedDataUrl = null;
  preview.classList.add('hidden');
  preview.src = '';
  video.classList.remove('hidden');
  postControls.classList.add('hidden');
  preControls.classList.remove('hidden');
}

shutterBtn.addEventListener('click', () => {
  if (!mediaStream || !video.videoWidth) {
    toast('No camera available — try upload.');
    return;
  }
  const w = video.videoWidth;
  const h = video.videoHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  capturedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
  showCaptured();
});

fileInput.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    capturedDataUrl = ev.target.result;
    showCaptured();
  };
  reader.readAsDataURL(file);
});

function showCaptured() {
  preview.src = capturedDataUrl;
  preview.classList.remove('hidden');
  video.classList.add('hidden');
  preControls.classList.add('hidden');
  postControls.classList.remove('hidden');
}

retakeBtn.addEventListener('click', () => {
  capturedDataUrl = null;
  resetCaptureView();
  if (!mediaStream) startCamera();
});

confirmBtn.addEventListener('click', () => go('classify'));

skipBtn.addEventListener('click', () => {
  capturedDataUrl = null;
  go('classify');
});

// ---------- classify ----------

let selectedType = null;

function renderClassify() {
  selectedType = null;
  document.getElementById('notes-input').value = '';
  document.querySelectorAll('.flag-row input[type="checkbox"]').forEach(c => c.checked = false);
  document.getElementById('save-entry-btn').disabled = true;

  const photoEl = document.getElementById('classify-photo');
  if (capturedDataUrl) {
    photoEl.src = capturedDataUrl;
    photoEl.classList.remove('hidden');
  } else {
    photoEl.classList.add('hidden');
    photoEl.src = '';
  }

  const list = document.getElementById('type-list');
  list.innerHTML = TYPES.map(t => `
    <li class="type-card" data-type="${t.n}">
      <div class="type-illo">${illoFor(t.n, t.color)}</div>
      <div class="type-meta">
        <div class="type-num">TYPE ${t.n}</div>
        <div class="type-name">${t.name}</div>
        <div class="type-desc">${t.desc}</div>
      </div>
      <span class="type-tag ${t.tag.cls}">${t.tag.label}</span>
    </li>
  `).join('');

  list.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => {
      list.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedType = parseInt(card.dataset.type, 10);
      document.getElementById('save-entry-btn').disabled = false;
    });
  });
}

document.getElementById('classify-back').addEventListener('click', () => go('capture'));

document.getElementById('save-entry-btn').addEventListener('click', () => {
  if (!selectedType) return;
  const notes = document.getElementById('notes-input').value.trim();
  const flags = [];
  if (document.getElementById('flag-blood').checked) flags.push('blood');
  if (document.getElementById('flag-pain').checked) flags.push('pain');
  if (document.getElementById('flag-urgent').checked) flags.push('urgent');

  addEntry({
    id: 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    t: Date.now(),
    type: selectedType,
    notes,
    flags,
  });

  // photos are intentionally never persisted
  capturedDataUrl = null;

  if (flags.includes('blood')) {
    toast('Blood logged. Please consider talking to a clinician.', 4000);
  } else {
    toast('Snap saved.');
  }
  go('home');
});

// ---------- history ----------

function renderHistory() {
  const entries = loadEntries();
  const root = document.getElementById('history-content');
  if (!entries.length) {
    root.innerHTML = '<li class="empty" style="list-style:none;">no entries yet.</li>';
    return;
  }
  // group by day
  const groups = new Map();
  for (const e of entries) {
    const k = todayKey(e.t);
    if (!groups.has(k)) groups.set(k, { label: dayLabel(e.t), items: [] });
    groups.get(k).items.push(e);
  }
  root.innerHTML = [...groups.values()].map(g => `
    <div class="history-day">
      <div class="history-day-label">${g.label}</div>
      <ul class="entry-list">${g.items.map(renderEntryItem).join('')}</ul>
    </div>
  `).join('');

  root.querySelectorAll('.entry-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (confirm('Delete this entry?')) {
        deleteEntry(id);
        renderHistory();
      }
    });
  });
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = startOfDay(Date.now());
  const dayStart = startOfDay(d);
  const diff = Math.round((today - dayStart) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- insights ----------

function renderInsights() {
  const root = document.getElementById('insights-content');
  const entries = loadEntries();
  if (entries.length < 1) {
    root.innerHTML = `
      <div class="insight-card">
        <h3>No data yet</h3>
        <p>Log a few snaps and you'll see your distribution, streaks, and personalised observations here.</p>
      </div>`;
    return;
  }

  // last 30 days
  const cutoff = Date.now() - 30 * 86400000;
  const recent = entries.filter(e => e.t >= cutoff);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const e of recent) counts[e.type - 1]++;
  const max = Math.max(1, ...counts);

  const bars = counts.map((c, i) => `
    <div class="chart-bar" title="Type ${i + 1}: ${c}">
      <div class="bar-fill" style="height:${(c / max) * 100}%; background:${TYPES[i].color};">
        <span class="bar-count">${c || ''}</span>
      </div>
    </div>
  `).join('');
  const labels = TYPES.map(t => `<span>T${t.n}</span>`).join('');

  let html = `
    <div class="insight-card">
      <h3>Last 30 days · ${recent.length} snap${recent.length === 1 ? '' : 's'}</h3>
      <div class="chart-bars">${bars}</div>
      <div class="chart-labels">${labels}</div>
    </div>
  `;

  // pattern observations
  const total = recent.length || 1;
  const idealPct = ((counts[2] + counts[3]) / total) * 100; // T3, T4
  const constipationPct = ((counts[0] + counts[1]) / total) * 100; // T1, T2
  const diarrheaPct = ((counts[5] + counts[6]) / total) * 100; // T6, T7

  if (idealPct >= 60 && recent.length >= 5) {
    html += card('good', 'Healthy range', `~${Math.round(idealPct)}% of your recent snaps are Type 3–4, the ideal range. Keep doing what you're doing.`);
  }

  if (constipationPct >= 40 && recent.length >= 5) {
    html += card('warn', 'Constipation pattern',
      `${Math.round(constipationPct)}% of recent snaps are Type 1–2. Try more water, fibre (fruits, oats, beans, prunes), regular movement, and don't suppress the urge.`);
  }

  if (diarrheaPct >= 40 && recent.length >= 5) {
    html += card('warn', 'Loose-stool pattern',
      `${Math.round(diarrheaPct)}% of recent snaps are Type 6–7. Stay hydrated, consider triggers (coffee, alcohol, dairy, spicy food, stress). If it lasts more than a few days, check in with a clinician.`);
  }

  // red flags
  const bloodCount = recent.filter(e => (e.flags || []).includes('blood')).length;
  const painCount = recent.filter(e => (e.flags || []).includes('pain')).length;
  if (bloodCount > 0) {
    html += card('alert', 'Blood was logged',
      `You flagged blood on ${bloodCount} recent snap${bloodCount === 1 ? '' : 's'}. Bright red blood often comes from hemorrhoids or fissures, but it should always be evaluated — especially if persistent, painless, or mixed in the stool. Please book an appointment.`);
  }
  if (painCount >= 3) {
    html += card('warn', 'Recurring pain',
      `Pain was flagged on ${painCount} recent snaps. Chronic pain with bowel movements warrants a clinical assessment.`);
  }

  // sudden change
  if (recent.length >= 6) {
    const half = Math.floor(recent.length / 2);
    const olderAvg = avg(recent.slice(half).map(e => e.type));
    const newerAvg = avg(recent.slice(0, half).map(e => e.type));
    if (Math.abs(newerAvg - olderAvg) >= 1.5) {
      const dir = newerAvg > olderAvg ? 'looser' : 'firmer';
      html += card('warn', 'Trend shift',
        `Your recent snaps trend ${dir} than earlier in the month. Sustained changes in bowel habits are worth tracking — and worth mentioning if they last more than two weeks.`);
    }
  }

  // frequency
  const daysSpanned = Math.max(1, (Date.now() - recent[recent.length - 1].t) / 86400000);
  const perWeek = (recent.length / daysSpanned) * 7;
  if (recent.length >= 5) {
    if (perWeek < 3) {
      html += card('warn', 'Low frequency',
        `You're averaging ~${perWeek.toFixed(1)} bowel movements per week. Fewer than 3 per week is the clinical threshold for constipation.`);
    } else if (perWeek > 21) {
      html += card('warn', 'High frequency',
        `You're averaging ~${perWeek.toFixed(1)} bowel movements per week. More than 3 per day on most days warrants a check-in if it's new.`);
    }
  }

  // screening nudge - non-pushy
  html += card('', 'Worth knowing',
    `Colorectal cancer is highly treatable when caught early. The current US guideline is routine screening starting at age 45 (earlier with family history). Tools like the FIT test and colonoscopy save lives — snapshat doesn't replace them.`);

  root.innerHTML = html;
}

function card(cls, title, body) {
  return `<div class="insight-card ${cls}"><h3>${title}</h3><p>${body}</p></div>`;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ---------- about: export / clear ----------

document.getElementById('export-btn').addEventListener('click', () => {
  const data = loadEntries();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `snapshat-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported.');
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (confirm('Delete ALL snapshat data on this device? This cannot be undone.')) {
    localStorage.removeItem(STORAGE_KEY);
    toast('All data cleared.');
    go('home');
  }
});

// ---------- toast ----------

let toastTimer = null;
function toast(msg, dur = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), dur);
}

// ---------- visibility & init ----------

document.addEventListener('visibilitychange', () => {
  if (document.hidden && mediaStream) stopCamera();
});

// stop camera if user navigates away from capture by browser back, etc.
window.addEventListener('pagehide', stopCamera);

renderHome();
