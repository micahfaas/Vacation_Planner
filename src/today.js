// Today / day-of mode: a day's scheduled cards in time order, with quick
// tap-through to map directions and to attachments / notes. On the real
// current date it adds a live "next up" countdown; the date stepper lets
// you scrub to any other trip day to preview it (countdown-free).
// Shown only while the current date falls inside the active trip.
import { activeTrip, ui } from './state.js';
import { TYPES } from './constants.js';
import { el } from './dom.js';
import { isoDate, parseISO, addDays, timeToMin } from './dates.js';
import { cardSpan, todayInTrip } from './derived.js';
import { wallClockToUTC } from './timezone.js';
import { openEditor } from './editor.js';
import { openAttachment } from './attachments.js';
import { render } from './render.js';
import { weatherSummary } from './weather.js';
import { placeCity } from './places.js';

// The day currently being shown (YYYY-MM-DD), set at the top of each render.
let viewISO = '';

function isLive() {
  return viewISO === isoDate(new Date());
}

// The day the view should land on: a still-valid scrub target if one is set,
// otherwise today while the trip is underway, otherwise the trip's first day.
function defaultDayISO(t) {
  const realToday = isoDate(new Date());
  if (ui.dayDate && ui.dayDate >= t.startDate && ui.dayDate <= t.endDate) return ui.dayDate;
  if (realToday >= t.startDate && realToday <= t.endDate) return realToday;
  return t.startDate;
}

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

// Build a day-entry: { id, c, anchor, startMs, endMs, state }.
// state is 'upcoming' | 'enroute' | 'done' | 'allday' (only used live).
function buildEntry(id, anchorISO) {
  const c = activeTrip().cards[id];
  const now = Date.now();
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
    startMs = parseISO(viewISO).getTime() + timeToMin(c.time) * 60000;
    state = now < startMs ? 'upcoming' : 'done';
  }
  return { id, c, anchor: anchorISO, startMs, endMs, state };
}

// Every card relevant to the viewed day: anchored on it, plus multi-day
// cards (hotels, overnight flights) anchored earlier that still cover it.
function collectEntries() {
  const t = activeTrip();
  const dayMid = parseISO(viewISO);
  const entries = [];
  const seen = new Set();

  (t.schedule[viewISO] || []).forEach(id => {
    if (seen.has(id) || !t.cards[id]) return;
    seen.add(id);
    entries.push(buildEntry(id, viewISO));
  });

  Object.keys(t.schedule).forEach(anchor => {
    if (anchor >= viewISO) return;
    (t.schedule[anchor] || []).forEach(id => {
      if (seen.has(id)) return;
      const c = t.cards[id];
      if (!c) return;
      const span = cardSpan(c);
      if (span <= 1) return;
      if (addDays(parseISO(anchor), span - 1) >= dayMid) {
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
  return entries;
}

// ---------- per-item rendering ----------
function timeLabel(entry) {
  const c = entry.c;
  if (c.type === 'flight' || c.type === 'transit') {
    if (c.depart && c.depart.slice(0, 10) === viewISO) return fmtHM(c.depart.slice(11, 16));
    if (c.arrive && c.arrive.slice(0, 10) === viewISO) return fmtHM(c.arrive.slice(11, 16));
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
  const which = Math.round((parseISO(viewISO) - parseISO(entry.anchor)) / 86400000) + 1;
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
  // Past styling only on the live day — a previewed day is not "done".
  const past = isLive() && entry.state === 'done';
  const row = el('div', {
    class: 'vp-today-item'
      + (past ? ' vp-today-past' : '')
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

  // Quick tap-through (notes carry confirmation numbers / addresses) —
  // dropped only for items already done on the live day, to stay tidy.
  if (!past) {
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

// ---------- header / date stepper ----------
function stepDay(delta) {
  const t = activeTrip();
  let d = isoDate(addDays(parseISO(viewISO), delta));
  if (d < t.startDate) d = t.startDate;
  if (d > t.endDate) d = t.endDate;
  // Landing back on the real today reverts to live mode (dayDate = null).
  ui.dayDate = (d === isoDate(new Date())) ? null : d;
  render();
}

function backToToday() {
  ui.dayDate = null;
  render();
}

function tripContext(t, entries) {
  const dayNum = Math.round((parseISO(viewISO) - parseISO(t.startDate)) / 86400000) + 1;
  const totalDays = Math.round((parseISO(t.endDate) - parseISO(t.startDate)) / 86400000) + 1;
  const bits = ['Day ' + dayNum + ' of ' + totalDays];
  const hotel = entries.find(e => e.c.type === 'hotel' && e.c.city);
  if (hotel) bits.push(hotel.c.city);
  return bits.join(' · ');
}

// Pick the city most relevant to this day's plan: any hotel's city, else
// any card's city, else any flight/transit destination, else '' (no weather).
function dayCity(entries) {
  const hotel = entries.find(e => e.c.type === 'hotel' && e.c.city);
  if (hotel) return hotel.c.city;
  const withCity = entries.find(e => e.c.city);
  if (withCity) return withCity.c.city;
  const movement = entries.find(e =>
    (e.c.type === 'flight' || e.c.type === 'transit') && e.c.destCity);
  return movement ? movement.c.destCity : '';
}

// Look up lat/lng for a city by matching against the trip's saved places.
function coordsForCity(t, city) {
  const target = (city || '').trim().toLowerCase();
  if (!target) return null;
  const match = (t.places || []).find(p =>
    typeof p.lat === 'number' && typeof p.lng === 'number' &&
    (placeCity(p) || '').toLowerCase() === target);
  return match ? { lat: match.lat, lng: match.lng } : null;
}

// Append a one-line weather chip for `iso` if we can find coords for the
// day's primary city. Silent no-op when nothing is resolvable.
function attachWeatherChip(parent, t, entries) {
  const city = dayCity(entries);
  const coords = coordsForCity(t, city);
  if (!coords) return;
  const wx = el('div', { class: 'vp-today-weather' });
  parent.appendChild(wx);
  weatherSummary(coords.lat, coords.lng, viewISO, viewISO).then(s => {
    if (!s) { wx.remove(); return; }
    const kind = s.kind === 'forecast' ? 'forecast'
      : s.kind === 'recorded' ? 'recorded' : 'typical · last yr';
    wx.appendChild(el('i', { class: 'ti ' + s.icon }));
    wx.appendChild(el('span', {},
      city + ' · ' + s.hi + '° / ' + s.lo + '°F · ' + kind));
  });
}

function buildHeader(t, entries, live) {
  const head = el('div', { class: 'vp-today-head' });
  const nav = el('div', { class: 'vp-today-nav' });

  const steps = el('div', { class: 'vp-today-steps' });
  steps.appendChild(el('button', {
    class: 'vp-today-step', 'aria-label': 'Previous day', title: 'Previous day',
    disabled: viewISO <= t.startDate,
    onclick: () => stepDay(-1)
  }, el('i', { class: 'ti ti-chevron-left' })));
  steps.appendChild(el('button', {
    class: 'vp-today-step', 'aria-label': 'Next day', title: 'Next day',
    disabled: viewISO >= t.endDate,
    onclick: () => stepDay(1)
  }, el('i', { class: 'ti ti-chevron-right' })));
  nav.appendChild(steps);

  const dateWrap = el('div', { class: 'vp-today-datewrap' });
  dateWrap.appendChild(el('div', { class: 'vp-today-date' },
    parseISO(viewISO).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })));
  dateWrap.appendChild(el('div', { class: 'vp-today-sub' }, tripContext(t, entries)));
  attachWeatherChip(dateWrap, t, entries);
  nav.appendChild(dateWrap);

  // Offered only when there is a real "today" inside the trip to snap back to.
  if (!live && todayInTrip()) {
    nav.appendChild(el('button', {
      class: 'vp-today-todaybtn', onclick: backToToday
    }, 'Today'));
  }

  head.appendChild(nav);
  return head;
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
  const t = activeTrip();
  if (!t.startDate || !t.endDate || t.endDate < t.startDate) {
    const panel = el('div', { class: 'vp-today' });
    panel.appendChild(el('div', { class: 'vp-today-empty' },
      'Set the trip’s start and end dates on the Calendar to use the Day view.'));
    return panel;
  }
  viewISO = defaultDayISO(t);
  const live = isLive();

  const entries = collectEntries();
  const panel = el('div', { class: 'vp-today' });
  panel.appendChild(buildHeader(t, entries, live));

  if (!entries.length) {
    const empty = el('div', { class: 'vp-today-empty' });
    empty.appendChild(el('div', {},
      live ? 'Nothing scheduled for today.' : 'Nothing scheduled for this day.'));
    empty.appendChild(el('button', {
      class: 'vp-btn-primary',
      onclick: () => openEditor(null, { kind: 'day', date: viewISO })
    }, live ? '+ Add something to today' : '+ Add something to this day'));
    panel.appendChild(empty);
    if (live) startTodayTimer();
    return panel;
  }

  const hero = live
    ? (entries.find(e => e.state === 'enroute') || entries.find(e => e.state === 'upcoming') || null)
    : null;
  if (hero) panel.appendChild(heroBlock(hero));

  panel.appendChild(el('div', { class: 'vp-today-section' }, live ? 'Today’s schedule' : 'Schedule'));
  const timeline = el('div', { class: 'vp-today-timeline' });
  let nowMarked = false;
  entries.forEach(e => {
    if (live && !nowMarked && (e.state === 'upcoming' || e.state === 'enroute')) {
      timeline.appendChild(el('div', { class: 'vp-today-now' }, 'now'));
      nowMarked = true;
    }
    const chip = !live ? null
      : (e.state === 'enroute' ? 'enroute' : (e === hero ? 'next' : null));
    timeline.appendChild(itemEl(e, { chip }));
  });
  panel.appendChild(timeline);

  if (live && !hero && entries.some(e => e.startMs != null)) {
    panel.appendChild(el('div', { class: 'vp-today-done' }, 'Nothing left on today’s schedule.'));
  }

  if (live) startTodayTimer();
  return panel;
}
