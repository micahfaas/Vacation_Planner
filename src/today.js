// Today / day-of mode: the day's scheduled cards in time order, a live
// "next up" countdown, and quick tap-through to maps and attachments.
// Shown only while the current date falls inside the active trip.
import { activeTrip } from './state.js';
import { TYPES } from './constants.js';
import { el } from './dom.js';
import { isoDate, parseISO, addDays, timeToMin } from './dates.js';
import { cardSpan } from './derived.js';
import { wallClockToUTC } from './timezone.js';
import { openEditor } from './editor.js';
import { openAttachment } from './attachments.js';
import { render } from './render.js';

// ---------- formatting ----------
function fmtHM(hm) {
  if (!hm) return '';
  const parts = hm.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;
  if (Number.isNaN(h)) return hm;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtCountdown(ms) {
  if (ms <= 0) return 'now';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return 'in ' + min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return 'in ' + h + 'h' + (m ? ' ' + m + 'm' : '');
}

function attachIcon(type) {
  if (/pdf/i.test(type || '')) return 'ti-file-type-pdf';
  if (/^image\//i.test(type || '')) return 'ti-photo';
  return 'ti-file';
}

function shorten(s, n) {
  s = s || '';
  n = n || 24;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- card timing ----------
// Real UTC instant of a flight/transit wall-clock string, using its zone
// when available and falling back to a device-local reading otherwise.
function instant(wall, tz) {
  if (tz) {
    const ms = wallClockToUTC(wall, tz);
    if (!Number.isNaN(ms)) return ms;
  }
  const ms = new Date(wall).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Build a today-entry: { id, c, anchor, startMs, endMs, state }.
// state is 'upcoming' | 'enroute' | 'done' | 'allday'.
function buildEntry(id, anchorISO) {
  const c = activeTrip().cards[id];
  const now = Date.now();
  const todayISO = isoDate(new Date());
  let startMs = null, endMs = null, state = 'allday';

  if (c.type === 'flight' || c.type === 'transit') {
    if (c.depart) startMs = instant(c.depart, c.originTz);
    if (c.arrive) endMs = instant(c.arrive, c.destTz);
    if (startMs != null) {
      if (now < startMs) state = 'upcoming';
      else if (endMs != null && now < endMs) state = 'enroute';
      else state = 'done';
    }
  } else if ((c.type === 'activity' || c.type === 'meal') && c.time) {
    startMs = parseISO(todayISO).getTime() + timeToMin(c.time) * 60000;
    state = now < startMs ? 'upcoming' : 'done';
  }
  return { id, c, anchor: anchorISO, startMs, endMs, state };
}

// Every card relevant to today: anchored on today, plus multi-day cards
// (hotels, overnight flights) anchored earlier that still cover today.
function collectEntries() {
  const t = activeTrip();
  const todayISO = isoDate(new Date());
  const todayMid = parseISO(todayISO);
  const entries = [];
  const seen = new Set();

  (t.schedule[todayISO] || []).forEach(id => {
    if (seen.has(id) || !t.cards[id]) return;
    seen.add(id);
    entries.push(buildEntry(id, todayISO));
  });

  Object.keys(t.schedule).forEach(anchor => {
    if (anchor >= todayISO) return;
    (t.schedule[anchor] || []).forEach(id => {
      if (seen.has(id)) return;
      const c = t.cards[id];
      if (!c) return;
      const span = cardSpan(c);
      if (span <= 1) return;
      if (addDays(parseISO(anchor), span - 1) >= todayMid) {
        seen.add(id);
        entries.push(buildEntry(id, anchor));
      }
    });
  });

  // Timed cards in chronological order; untimed (hotels, notes) trail after.
  entries.sort((a, b) => {
    if (a.startMs == null && b.startMs == null) return 0;
    if (a.startMs == null) return 1;
    if (b.startMs == null) return -1;
    return a.startMs - b.startMs;
  });
  return { entries, todayISO };
}

// ---------- per-item rendering ----------
function timeLabel(entry) {
  const c = entry.c;
  const todayISO = isoDate(new Date());
  if (c.type === 'flight' || c.type === 'transit') {
    if (c.depart && c.depart.slice(0, 10) === todayISO) return fmtHM(c.depart.slice(11, 16));
    if (c.arrive && c.arrive.slice(0, 10) === todayISO) return fmtHM(c.arrive.slice(11, 16));
    if (c.depart) return fmtHM(c.depart.slice(11, 16));
    return 'all day';
  }
  if ((c.type === 'activity' || c.type === 'meal') && c.time) return fmtHM(c.time);
  if (c.type === 'hotel') return 'tonight';
  return 'all day';
}

function nightLabel(entry) {
  const n = parseInt(entry.c.nights, 10) || 1;
  if (n <= 1) return '1 night';
  const which = Math.round((parseISO(isoDate(new Date())) - parseISO(entry.anchor)) / 86400000) + 1;
  return (which >= 1 && which <= n) ? 'night ' + which + ' of ' + n : n + ' nights';
}

function itemMeta(entry) {
  const c = entry.c;
  const bits = [];
  if (c.type === 'flight' || c.type === 'transit') {
    if (c.type === 'flight' && c.flightNo) bits.push(c.flightNo);
    if (c.originCity || c.destCity) bits.push((c.originCity || '?') + ' → ' + (c.destCity || '?'));
    if (c.depart && c.arrive) {
      bits.push(fmtHM(c.depart.slice(11, 16)) + ' – ' + fmtHM(c.arrive.slice(11, 16)));
    }
  } else if (c.type === 'hotel') {
    if (c.city) bits.push(c.city);
    bits.push(nightLabel(entry));
  } else if (c.city) {
    bits.push(c.city);
  }
  return bits.filter(Boolean).join(' · ');
}

// Google Maps directions to a venue card. Flights/transit are skipped —
// a city centroid is not a useful "take me there" target for an airport.
function mapsQuery(c) {
  if (c.type === 'flight' || c.type === 'transit') return '';
  const bits = [c.title, c.city].filter(Boolean);
  return bits.length ? bits.join(' ') : '';
}

function buildActions(c) {
  const wrap = el('div', { class: 'vp-today-item-actions' });
  let any = false;

  const q = mapsQuery(c);
  if (q) {
    any = true;
    wrap.appendChild(el('a', {
      class: 'vp-today-act',
      href: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q),
      target: '_blank', rel: 'noopener',
      title: 'Open directions in Google Maps'
    }, el('i', { class: 'ti ti-navigation' }), 'Directions'));
  }

  (c.attachments || []).forEach(a => {
    any = true;
    wrap.appendChild(el('button', {
      type: 'button', class: 'vp-today-act',
      onclick: e => { e.stopPropagation(); openAttachment(a.path); },
      title: 'Open ' + a.name
    }, el('i', { class: 'ti ' + attachIcon(a.type) }), shorten(a.name)));
  });

  return any ? wrap : null;
}

// opts: { hero, chip } — chip is 'next' | 'enroute' | null.
function itemEl(entry, opts) {
  opts = opts || {};
  const c = entry.c;
  const tp = TYPES[c.type] || TYPES.note;
  const row = el('div', {
    class: 'vp-today-item'
      + (entry.state === 'done' ? ' vp-today-past' : '')
      + (opts.hero ? ' vp-today-hero' : ''),
    style: { borderLeftColor: tp.color },
    onclick: e => {
      if (e.target.closest('a') || e.target.closest('button')) return;
      openEditor(entry.id);
    }
  });

  row.appendChild(el('div', { class: 'vp-today-item-time' }, timeLabel(entry)));

  const body = el('div', { class: 'vp-today-item-body' });
  const title = el('div', { class: 'vp-today-item-title' });
  title.appendChild(el('i', { class: 'ti ' + tp.icon, style: { color: tp.color }, 'aria-hidden': 'true' }));
  title.appendChild(el('span', {}, c.title || tp.label));
  if (c.booked) title.appendChild(el('span', { class: 'vp-booked-badge', title: 'Booked' }, '✓'));
  if (opts.chip === 'next') title.appendChild(el('span', { class: 'vp-today-chip vp-today-chip-next' }, 'next'));
  else if (opts.chip === 'enroute') title.appendChild(el('span', { class: 'vp-today-chip vp-today-chip-enroute' }, 'en route'));
  body.appendChild(title);

  const meta = itemMeta(entry);
  if (meta) body.appendChild(el('div', { class: 'vp-today-item-meta' }, meta));

  // Quick tap-through (notes carry confirmation numbers / addresses) — past
  // items drop it to stay tidy.
  if (entry.state !== 'done') {
    if (c.notes) body.appendChild(el('div', { class: 'vp-today-item-notes' }, c.notes));
    const actions = buildActions(c);
    if (actions) body.appendChild(actions);
  }

  row.appendChild(body);
  return row;
}

function heroBlock(hero) {
  const block = el('div', { class: 'vp-today-next' });
  const enroute = hero.state === 'enroute';
  const deadline = enroute ? hero.endMs : hero.startMs;

  const headRow = el('div', { class: 'vp-today-next-head' });
  headRow.appendChild(el('span', { class: 'vp-today-next-tag' }, enroute ? 'Landing' : 'Next up'));
  headRow.appendChild(el('span', {
    class: 'vp-today-next-time',
    'data-vp-deadline': String(deadline)
  }, fmtCountdown(deadline - Date.now())));
  block.appendChild(headRow);
  block.appendChild(itemEl(hero, { hero: true }));
  return block;
}

function tripContext(entries, todayISO) {
  const t = activeTrip();
  const dayNum = Math.round((parseISO(todayISO) - parseISO(t.startDate)) / 86400000) + 1;
  const totalDays = Math.round((parseISO(t.endDate) - parseISO(t.startDate)) / 86400000) + 1;
  const bits = ['Day ' + dayNum + ' of ' + totalDays];
  const hotel = entries.find(e => e.c.type === 'hotel' && e.c.city);
  if (hotel) bits.push(hotel.c.city);
  return bits.join(' · ');
}

// ---------- live countdown timer ----------
let timerId = 0;
let timerDay = '';

function onVisible() {
  if (!document.hidden) tick();
}

export function stopTodayTimer() {
  if (timerId) { clearInterval(timerId); timerId = 0; }
  document.removeEventListener('visibilitychange', onVisible);
}

function startTodayTimer() {
  stopTodayTimer();
  timerDay = isoDate(new Date());
  timerId = setInterval(tick, 30000);
  document.addEventListener('visibilitychange', onVisible);
}

// Refresh the countdown in place; re-render fully when the next-up item
// passes (so the hero advances) or the calendar day rolls over.
function tick() {
  if (isoDate(new Date()) !== timerDay) { render(); return; }
  const node = document.querySelector('.vp-today [data-vp-deadline]');
  if (!node) return;
  const diff = Number(node.dataset.vpDeadline) - Date.now();
  if (diff <= 0) { render(); return; }
  node.textContent = fmtCountdown(diff);
}

// ---------- view ----------
// Built by render() when the Today view is active.
export function renderTodayView() {
  const { entries, todayISO } = collectEntries();
  const panel = el('div', { class: 'vp-today' });

  const head = el('div', { class: 'vp-today-head' });
  head.appendChild(el('div', { class: 'vp-today-date' },
    new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })));
  head.appendChild(el('div', { class: 'vp-today-sub' }, tripContext(entries, todayISO)));
  panel.appendChild(head);

  if (!entries.length) {
    const empty = el('div', { class: 'vp-today-empty' });
    empty.appendChild(el('div', {}, 'Nothing scheduled for today.'));
    empty.appendChild(el('button', {
      class: 'vp-btn-primary',
      onclick: () => openEditor(null, { kind: 'day', date: todayISO })
    }, '+ Add something to today'));
    panel.appendChild(empty);
    startTodayTimer();
    return panel;
  }

  const hero = entries.find(e => e.state === 'enroute') || entries.find(e => e.state === 'upcoming') || null;
  if (hero) panel.appendChild(heroBlock(hero));

  panel.appendChild(el('div', { class: 'vp-today-section' }, 'Today’s schedule'));
  const timeline = el('div', { class: 'vp-today-timeline' });
  let nowMarked = false;
  entries.forEach(e => {
    if (!nowMarked && (e.state === 'upcoming' || e.state === 'enroute')) {
      timeline.appendChild(el('div', { class: 'vp-today-now' }, 'now'));
      nowMarked = true;
    }
    const chip = e.state === 'enroute' ? 'enroute' : (e === hero ? 'next' : null);
    timeline.appendChild(itemEl(e, { chip }));
  });
  panel.appendChild(timeline);

  if (!hero && entries.some(e => e.startMs != null)) {
    panel.appendChild(el('div', { class: 'vp-today-done' }, 'Nothing left on today’s schedule.'));
  }

  startTodayTimer();
  return panel;
}
