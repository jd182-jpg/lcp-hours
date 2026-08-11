/* ==========================================================================
   LCP Hours — semi-monthly time tracker
   Pay periods: 1st–15th and 16th–end of month.

   CROSS-DEVICE SYNC: paste your Firebase config into sync-config.js.
   Until then the app stores everything in this browser (localStorage).
   ========================================================================== */

const LS_KEY = 'lcp-hours-v1';
const WL_KEY = 'lcp-worklog-v1';
const DEFAULTS = {
  name: '', email: '', entries: [], timer: null,
  detailMode: 'summary', updatedAt: 0
};

let state = load();
let worklog = loadWorklog();   // { 'YYYY-MM-DD': ['what I did', ...] } from Obsidian
let viewPeriod = periodOf(new Date());   // which pay period the page is showing
let tickHandle = null;

/* ---------------------------------------------------------------- storage */

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch (e) { console.warn('Could not read saved data:', e); }
  return Object.assign({}, DEFAULTS);
}

function save({ push = true } = {}) {
  state.updatedAt = Date.now();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save:', e);
    toast('Could not save to this browser');
  }
  if (push && window.LCPSync) window.LCPSync.push(state);
}

// The work log is written by worklog-sync.py, not by this app — cache it locally so
// the report still reads correctly offline.
function loadWorklog() {
  try {
    const raw = localStorage.getItem(WL_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch (e) { console.warn('Could not read cached work log:', e); }
  return {};
}

/* ------------------------------------------------------------ date helpers */

// Parse 'YYYY-MM-DD' as a LOCAL date (new Date('2026-08-11') would be UTC).
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function ymd(dt) {
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${m}-${d}`;
}
function lastDayOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function ord(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/** The pay period containing `dt`: {y, m, half, from, to} (from/to are Dates). */
function periodOf(dt) {
  const y = dt.getFullYear(), m = dt.getMonth();
  const half = dt.getDate() <= 15 ? 1 : 2;
  return buildPeriod(y, m, half);
}
function buildPeriod(y, m, half) {
  const from = new Date(y, m, half === 1 ? 1 : 16);
  const to   = new Date(y, m, half === 1 ? 15 : lastDayOfMonth(y, m));
  return { y, m, half, from, to };
}
function shiftPeriod(p, step) {
  let idx = p.y * 24 + p.m * 2 + (p.half - 1) + step;
  const y = Math.floor(idx / 24);
  const rem = idx - y * 24;
  return buildPeriod(y, Math.floor(rem / 2), (rem % 2) + 1);
}
function periodLabel(p) {
  const a = `${MON[p.from.getMonth()]} ${p.from.getDate()}`;
  const b = `${MON[p.to.getMonth()]} ${p.to.getDate()}`;
  return `${a} – ${b}, ${p.y}`;
}
function inPeriod(dateStr, p) {
  const d = parseYmd(dateStr);
  return d >= p.from && d <= p.to;
}
/* ------------------------------------------------------------- formatting */

function hhmmss(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtTime(hm) {                    // '14:30' -> '2:30 PM'
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}
function round2(n) { return Math.round(n * 100) / 100; }
function roundQuarter(n) { return Math.round(n * 4) / 4; }
function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function padL(s, n) { s = String(s); return ' '.repeat(Math.max(0, n - s.length)) + s; }

/** Push `text` onto `out`, word-wrapped to WRAP_AT, first line prefixed differently. */
const WRAP_AT = 76;
function wrapInto(out, text, firstPrefix, contPrefix) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return;
  let line = firstPrefix, started = false;
  words.forEach(w => {
    const candidate = started ? `${line} ${w}` : line + w;
    if (started && candidate.length > WRAP_AT) {
      out.push(line);
      line = contPrefix + w;
    } else {
      line = candidate;
    }
    started = true;
  });
  out.push(line);
}

/* ----------------------------------------------------------------- entries */

function entriesFor(p) {
  return state.entries
    .filter(e => inPeriod(e.date, p))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
}
function totalFor(p) {
  return round2(entriesFor(p).reduce((s, e) => s + (Number(e.hours) || 0), 0));
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/**
 * What was worked on that day. The Obsidian work log wins when it exists, since it's
 * written from the actual daily note; typed entry notes are the fallback.
 */
function descFor(date) {
  const wl = worklog[date];
  if (Array.isArray(wl) && wl.length) return wl.slice();
  const notes = state.entries
    .filter(e => e.date === date && e.note)
    .map(e => e.note.trim());
  return [...new Set(notes)];
}

function addEntry(e) {
  state.entries.push(Object.assign({ id: uid(), note: '' }, e));
  save();
  render();
}
function deleteEntry(id) {
  state.entries = state.entries.filter(e => e.id !== id);
  save();
  render();
}

/* ------------------------------------------------------------------- timer */

function startTimer() {
  state.timer = { startedAt: Date.now(), note: $('timerNote').value.trim() };
  save();
  render();
}

function stopTimer() {
  const t = state.timer;
  if (!t) return;
  const started = new Date(t.startedAt);
  const ended = new Date();
  const hours = round2((ended - started) / 3600000);

  state.timer = null;
  if (hours < 0.01) {
    save(); render();
    toast('Too short to log');
    return;
  }
  $('timerNote').value = '';
  addEntry({
    date: ymd(started),
    start: `${String(started.getHours()).padStart(2,'0')}:${String(started.getMinutes()).padStart(2,'0')}`,
    end:   `${String(ended.getHours()).padStart(2,'0')}:${String(ended.getMinutes()).padStart(2,'0')}`,
    hours,
    note: t.note || ''
  });
  // Jump the view to the period the entry landed in.
  viewPeriod = periodOf(started);
  render();
  toast(`Logged ${hours.toFixed(2)} hrs`);
}

function discardTimer() {
  state.timer = null;
  save();
  render();
  toast('Timer discarded');
}

function tick() {
  const t = state.timer;
  const clock = $('clock'), sub = $('clockSub');
  if (!t) {
    clock.textContent = '0:00:00';
    clock.classList.remove('live');
    sub.textContent = 'Timer stopped';
    return;
  }
  clock.textContent = hhmmss(Date.now() - t.startedAt);
  clock.classList.add('live');
  const st = new Date(t.startedAt);
  sub.textContent = `Running since ${fmtTime(`${String(st.getHours()).padStart(2,'0')}:${String(st.getMinutes()).padStart(2,'0')}`)}`;
}

/* ------------------------------------------------------------------ render */

const $ = id => document.getElementById(id);

function render() {
  renderTimer();
  renderPeriod();
  renderEntries();
  renderReport();
}

function renderTimer() {
  const running = !!state.timer;
  const btn = $('btnToggle');
  btn.textContent = running ? 'Stop & log' : 'Start timer';
  btn.className = 'btn ' + (running ? 'btn-stop' : 'btn-go');
  $('btnDiscard').classList.toggle('hidden', !running);
  const note = $('timerNote');
  if (running) { note.value = state.timer.note || ''; note.placeholder = 'Note for this block'; }
  tick();
  clearInterval(tickHandle);
  if (running) tickHandle = setInterval(tick, 1000);
}

function renderPeriod() {
  const p = viewPeriod;
  $('periodLabel').textContent = periodLabel(p);

  const now = periodOf(new Date());
  const isNow = now.y === p.y && now.m === p.m && now.half === p.half;
  const halfTxt = p.half === 1 ? '1st – 15th' : `16th – ${ord(lastDayOfMonth(p.y, p.m))}`;
  $('periodSub').textContent = halfTxt + (isNow ? '  ·  current period' : '');

  const total = totalFor(p);
  $('statTotal').textContent = total.toFixed(2);
  $('statDays').textContent = new Set(entriesFor(p).map(e => e.date)).size;

  // Average per week across the period's calendar length.
  const days = Math.round((p.to - p.from) / 86400000) + 1;
  $('statAvg').textContent = (total / (days / 7)).toFixed(1);
}

function renderEntries() {
  const list = $('entryList');
  const rows = entriesFor(viewPeriod);
  list.innerHTML = '';

  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">
        <strong>No hours logged this period</strong>
        Start the timer above, or use “Add entry” to log time by hand.
      </div>`;
    return;
  }

  // Group by day.
  const byDay = new Map();
  rows.forEach(e => {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  });

  byDay.forEach((items, date) => {
    const d = parseYmd(date);
    const sum = round2(items.reduce((s, e) => s + (Number(e.hours) || 0), 0));

    const grp = document.createElement('div');
    grp.className = 'day-grp';
    const head = document.createElement('div');
    head.className = 'day-head';
    head.innerHTML = `<div class="day-name"><span class="dow">${DOW[d.getDay()]}</span>
        ${MON[d.getMonth()]} ${d.getDate()}</div>
      <div class="day-sum">${sum.toFixed(2)}</div>`;
    grp.appendChild(head);

    items.forEach(e => {
      const row = document.createElement('div');
      row.className = 'row';

      const time = document.createElement('div');
      time.className = 'row-time';
      time.textContent = e.start && e.end ? `${fmtTime(e.start)} – ${fmtTime(e.end)}` : 'manual';

      const note = document.createElement('div');
      note.className = 'row-note' + (e.note ? '' : ' empty');
      note.textContent = e.note || 'No note';

      const hrs = document.createElement('div');
      hrs.className = 'row-hrs';
      hrs.textContent = (Number(e.hours) || 0).toFixed(2);

      const del = document.createElement('button');
      del.className = 'row-del';
      del.type = 'button';
      del.innerHTML = '&times;';
      del.title = 'Delete entry';
      del.addEventListener('click', () => deleteEntry(e.id));

      row.append(time, note, hrs, del);
      grp.appendChild(row);
    });

    list.appendChild(grp);
  });
}

/* ------------------------------------------------------------------ report */

function buildReport() {
  const p = viewPeriod;
  const doRound = $('roundChk').checked;
  const rows = entriesFor(p);
  const name = (state.name || '').trim() || 'Jackson Darr';

  // One line per day.
  const byDay = new Map();
  rows.forEach(e => {
    const h = Number(e.hours) || 0;
    byDay.set(e.date, (byDay.get(e.date) || 0) + h);
  });

  const mode = state.detailMode || 'summary';
  const lines = [];
  lines.push(`LCP HOURS — ${name.toUpperCase()}`);
  lines.push(`Pay period: ${periodLabel(p)}`);
  lines.push('');

  let total = 0;
  if (!byDay.size) {
    lines.push('  (no hours logged this period)');
  } else {
    byDay.forEach((h, date) => {
      const val = doRound ? roundQuarter(h) : round2(h);
      total += val;
      const d = parseYmd(date);
      const day = `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')}`;
      lines.push(`  ${pad(day, 12)}${padL(val.toFixed(2), 7)}`);
      if (mode === 'perday') {
        descFor(date).forEach(t => wrapInto(lines, t, '      - ', '        '));
      }
    });
  }

  total = round2(total);
  lines.push('  ' + '-'.repeat(19));
  lines.push(`  ${pad('TOTAL', 12)}${padL(total.toFixed(2), 7)}`);
  lines.push('');

  const days = Math.round((p.to - p.from) / 86400000) + 1;
  lines.push(`Average: ${(total / (days / 7)).toFixed(1)} hrs/week`);

  if (mode === 'summary') {
    const block = [];
    byDay.forEach((h, date) => {
      const items = descFor(date);
      if (!items.length) return;
      const d = parseYmd(date);
      block.push(`  ${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`);
      items.forEach(t => wrapInto(block, t, '    - ', '      '));
    });
    if (block.length) {
      lines.push('');
      lines.push('WORK THIS PERIOD');
      lines.push(...block);
    }
  }

  return { text: lines.join('\n'), total, period: p, name, byDay, doRound, mode };
}

function renderReport() {
  $('reportOut').textContent = buildReport().text;
  renderWorklogStatus();
}

/**
 * Feedback that the 5pm Obsidian job is actually landing data, plus a nudge about days
 * that have a work log but no hours. Those days are silently absent from the report
 * (it is built from hours entries), which on a payroll tool is worth saying out loud.
 */
function renderWorklogStatus() {
  const el = $('worklogStatus');

  if (!Object.keys(worklog).length) {
    el.textContent = 'No Obsidian work log yet — descriptions fall back to your entry notes.';
    el.classList.remove('on');
    return;
  }

  // Count against the work log itself, not against days that happen to have hours.
  const wlDays = Object.keys(worklog)
    .filter(d => inPeriod(d, viewPeriod) && (worklog[d] || []).length)
    .sort();
  const items = wlDays.reduce((n, d) => n + worklog[d].length, 0);
  const hourDays = new Set(entriesFor(viewPeriod).map(e => e.date));
  const missing = wlDays.filter(d => !hourDays.has(d));

  let msg = `Obsidian work log: ${items} item(s) across ${wlDays.length} day(s) this period.`;
  if (missing.length) {
    const names = missing.map(d => {
      const dt = parseYmd(d);
      return `${MON[dt.getMonth()]} ${dt.getDate()}`;
    });
    msg += `  ⚠ No hours logged for ${names.join(', ')} — that work won't appear in the report.`;
  }
  el.textContent = msg;
  el.classList.toggle('on', items > 0 && !missing.length);
  el.classList.toggle('warn', missing.length > 0);
}

/* ------------------------------------------------------------------ export */

function copyReport() {
  const txt = buildReport().text;
  const done = () => toast('Report copied');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
  } else fallbackCopy(txt, done);
}
function fallbackCopy(txt, done) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch (e) { toast('Copy failed — select the text manually'); }
  document.body.removeChild(ta);
}

function emailReport() {
  const r = buildReport();
  const to = (state.email || '').trim();
  const subject = `Hours — ${r.name}, ${periodLabel(r.period)}`;
  const body = `Hi Ashley,\n\nHere are my hours for the ${periodLabel(r.period)} pay period.\n\n`
             + r.text + `\n\nLet me know if you need anything else.\n\nThanks,\n${r.name}\n`;
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}`
            + `&body=${encodeURIComponent(body)}`;
  window.location.href = url;
  if (!to) toast('Tip: add Ashley’s email below to prefill it');
}

function downloadCsv() {
  const r = buildReport();
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  const withWork = r.mode !== 'none';
  const out = [(withWork ? ['Date', 'Day', 'Hours', 'Work'] : ['Date', 'Day', 'Hours']).join(',')];

  // One row per day, rounded the same way as the on-screen report, so the
  // rows always add up to the TOTAL Ashley sees.
  r.byDay.forEach((raw, date) => {
    const d = parseYmd(date);
    const h = r.doRound ? roundQuarter(raw) : round2(raw);
    const row = [date, DOW[d.getDay()], h.toFixed(2)];
    if (withWork) row.push(esc(descFor(date).join('; ')));
    out.push(row.join(','));
  });
  out.push('');
  out.push((withWork ? ['', 'TOTAL', r.total.toFixed(2), ''] : ['', 'TOTAL', r.total.toFixed(2)]).join(','));

  const fn = `LCP-Hours_${r.name.replace(/\s+/g, '-')}_${ymd(r.period.from)}_to_${ymd(r.period.to)}.csv`;
  const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fn;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('CSV downloaded');
}

/* ------------------------------------------------------------------- toast */

let toastHandle = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => t.classList.remove('show'), 2400);
}

/* -------------------------------------------------------------------- wire */

function wire() {
  $('btnToggle').addEventListener('click', () => state.timer ? stopTimer() : startTimer());
  $('btnDiscard').addEventListener('click', discardTimer);
  $('timerNote').addEventListener('change', () => {
    if (state.timer) { state.timer.note = $('timerNote').value.trim(); save(); }
  });

  $('prevPeriod').addEventListener('click', () => { viewPeriod = shiftPeriod(viewPeriod, -1); render(); });
  $('nextPeriod').addEventListener('click', () => { viewPeriod = shiftPeriod(viewPeriod, 1); render(); });

  // Add-entry form
  $('btnAdd').addEventListener('click', () => {
    const f = $('addForm');
    const opening = f.classList.contains('hidden');
    f.classList.toggle('hidden');
    if (opening) {
      $('fDate').value = ymd(new Date());
      $('fStart').value = $('fEnd').value = $('fHours').value = $('fNote').value = '';
      $('fDate').focus();
    }
  });
  $('fCancel').addEventListener('click', () => $('addForm').classList.add('hidden'));

  // Auto-compute hours from start/end.
  const autoHours = () => {
    const s = $('fStart').value, e = $('fEnd').value;
    if (!s || !e) return;
    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 1440;                 // crossed midnight
    $('fHours').value = round2(mins / 60).toFixed(2);
  };
  $('fStart').addEventListener('change', autoHours);
  $('fEnd').addEventListener('change', autoHours);

  $('addForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const date = $('fDate').value;
    const hours = round2(parseFloat($('fHours').value));
    if (!date) return toast('Pick a date');
    if (!hours || hours <= 0) return toast('Enter hours, or a start and end time');
    addEntry({ date, start: $('fStart').value || '', end: $('fEnd').value || '', hours, note: $('fNote').value.trim() });
    viewPeriod = periodOf(parseYmd(date));
    $('addForm').classList.add('hidden');
    render();
    toast(`Added ${hours.toFixed(2)} hrs`);
  });

  // Report
  $('detailMode').value = state.detailMode || 'summary';
  $('detailMode').addEventListener('change', () => {
    state.detailMode = $('detailMode').value;
    save();
    renderReport();
  });
  $('roundChk').addEventListener('change', renderReport);
  $('btnCopy').addEventListener('click', copyReport);
  $('btnEmail').addEventListener('click', emailReport);
  $('btnCsv').addEventListener('click', downloadCsv);

  // Settings
  const bind = (id, key, num) => {
    const el = $(id);
    el.value = state[key] ?? '';
    el.addEventListener('input', () => {
      state[key] = num ? (parseFloat(el.value) || 0) : el.value;
      save();
      renderPeriod();
      renderReport();
    });
  };
  bind('sName', 'name', false);
  bind('sEmail', 'email', false);

  $('btnWipe').addEventListener('click', () => {
    if (!confirm('Delete all logged hours and settings? This cannot be undone.')) return;
    state = Object.assign({}, DEFAULTS);
    viewPeriod = periodOf(new Date());
    save();
    $('sName').value = ''; $('sEmail').value = '';
    render();
    toast('All data cleared');
  });
}

/** Set an input's value only if the element exists, so HTML/JS version skew degrades. */
function setVal(id, v) { const el = $(id); if (el) el.value = v; }

/** Called by sync-config.js when a newer copy arrives from the cloud. */
window.LCPApplyRemote = function (remote) {
  if (!remote || (remote.updatedAt || 0) <= (state.updatedAt || 0)) return;
  state = Object.assign({}, DEFAULTS, remote);
  setVal('sName', state.name || '');
  setVal('sEmail', state.email || '');
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  render();
};
/** Called by sync-config.js with the work log written by worklog-sync.py. */
window.LCPApplyWorklog = function (days) {
  if (!days || typeof days !== 'object') return;
  worklog = days;
  try { localStorage.setItem(WL_KEY, JSON.stringify(worklog)); } catch (e) {}
  renderReport();
};
window.LCPGetState = () => state;
window.LCPSetSyncBadge = function (label, on) {
  $('syncTxt').textContent = label;
  $('syncBadge').classList.toggle('on', !!on);
};

wire();

// Sync and the service worker are started BEFORE the first render on purpose: if
// rendering ever throws, cloud sync and offline support should still come up rather
// than the whole page going dark.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(e => console.warn('Service worker not registered:', e));
  });
}

// The sync layer is optional; the app works with or without it.
(function () {
  const s = document.createElement('script');
  s.src = 'sync-config.js?v=5';
  s.onerror = () => {};
  document.body.appendChild(s);
})();

render();
