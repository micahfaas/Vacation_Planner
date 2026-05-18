// Calendar grid, card rendering, sidebar panels, and drag-and-drop.
import { activeTrip } from './state.js';
import { TYPES } from './constants.js';
import { el } from './dom.js';
import { isoDate, parseISO, addDays, fmtShort, fmtMin } from './dates.js';
import { getGridDays, computeStats, getConflicts } from './derived.js';
import { save } from './storage.js';
import { duplicateCard, removeCard, moveCard } from './cards.js';
import { openEditor } from './editor.js';

const root = document.getElementById('vp-root');

export function render() {
  const t = activeTrip();
  document.getElementById('vp-trip-name').textContent = t.name;
  root.innerHTML = '';

  // toolbar
  const tb = el('div', { class: 'vp-toolbar' });
  tb.appendChild(el('label', {}, 'Trip dates'));
  const sd = el('input', { type: 'date', value: t.startDate || '' });
  sd.addEventListener('change', e => {
    t.startDate = e.target.value;
    if (t.endDate < t.startDate) t.endDate = t.startDate;
    save(); render();
  });
  tb.appendChild(sd);
  tb.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--text-2)' } }, 'to'));
  const ed = el('input', { type: 'date', value: t.endDate || '' });
  ed.addEventListener('change', e => { t.endDate = e.target.value; save(); render(); });
  tb.appendChild(ed);
  tb.appendChild(el('button', { class: 'vp-btn-primary', onclick: () => openEditor(null, { kind: 'lib' }) }, '+ new card'));
  root.appendChild(tb);

  if (!t.startDate || !t.endDate || t.endDate < t.startDate) {
    root.appendChild(el('div', { class: 'vp-empty-cal' }, 'Pick a start and end date to begin.'));
    return;
  }

  const layout = el('div', { class: 'vp-layout' });

  // calendar
  const calCol = el('div', {});
  const calHead = el('div', { class: 'vp-cal-head' });
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(d => calHead.appendChild(el('div', {}, d)));
  calCol.appendChild(calHead);

  const cal = el('div', { class: 'vp-cal' });
  const conflicts = getConflicts();
  const gridDays = getGridDays();
  // chunk into week rows (always 7 days each, since getGridDays pads)
  const weeks = [];
  for (let i = 0; i < gridDays.length; i += 7) weeks.push(gridDays.slice(i, i + 7));

  weeks.forEach(week => {
    const weekRow = el('div', { class: 'vp-week-row' });
    const weekStart = week[0].d;
    const weekEnd = week[6].d;

    // collect multi-day cards that intersect this week, sorted by start date then duration desc
    const spansInWeek = [];
    const seenIds = new Set();
    Object.keys(t.schedule).forEach(anchor => {
      t.schedule[anchor].forEach(id => {
        if (seenIds.has(id)) return;
        const c = t.cards[id]; if (!c) return;
        const span = cardSpan(c);
        if (span <= 1) return;
        const anchorDate = parseISO(anchor);
        const spanEnd = addDays(anchorDate, span - 1);
        if (spanEnd < weekStart || anchorDate > weekEnd) return;
        seenIds.add(id);
        spansInWeek.push({ id, anchorDate, spanEnd });
      });
    });
    spansInWeek.sort((a, b) =>
      a.anchorDate - b.anchorDate || (b.spanEnd - b.anchorDate) - (a.spanEnd - a.anchorDate)
    );

    // assign each span to a vertical lane (first lane that doesn't conflict)
    const lanes = []; // each lane is an array of {start, end} occupied ranges
    spansInWeek.forEach(s => {
      const visStart = s.anchorDate < weekStart ? weekStart : s.anchorDate;
      const visEnd = s.spanEnd > weekEnd ? weekEnd : s.spanEnd;
      let laneIdx = 0;
      while (true) {
        const lane = lanes[laneIdx];
        if (!lane) { lanes[laneIdx] = []; }
        const conflict = (lanes[laneIdx] || []).some(r => !(visEnd < r.start || visStart > r.end));
        if (!conflict) {
          lanes[laneIdx].push({ start: visStart, end: visEnd });
          s.lane = laneIdx;
          s.visStart = visStart;
          s.visEnd = visEnd;
          break;
        }
        laneIdx++;
      }
    });
    const numLanes = lanes.length;
    const laneHeight = 44; // px per lane (matches min-height + gap)
    const spanLayerHeight = numLanes * laneHeight;

    // day cells
    const daysGrid = el('div', { class: 'vp-week-days' });
    week.forEach(({ d, out }) => {
      const iso = isoDate(d);
      const day = el('div', {
        class: 'vp-day' + (out ? ' vp-out' : '') + (conflicts[iso] && !out ? ' vp-conflict' : ''),
        'data-date': iso,
        style: spanLayerHeight ? { paddingTop: (8 + spanLayerHeight) + 'px' } : {}
      });
      const headRow = el('div', { class: 'vp-day-num' });
      const lbl = d.getDate() === 1 || iso === t.startDate ? fmtShort(d) : String(d.getDate());
      headRow.appendChild(el('span', {}, lbl));
      if (conflicts[iso] && !out) {
        headRow.appendChild(el('i', { class: 'ti ti-alert-triangle vp-conflict-ico', title: 'Time overlap on this day' }));
      }
      day.appendChild(headRow);

      if (!out) {
        attachDropZone(day, { kind: 'day', date: iso });
        (t.schedule[iso] || []).forEach(id => {
          const card = t.cards[id]; if (!card) return;
          if (cardSpan(card) === 1) day.appendChild(renderCard(id));
        });
        day.appendChild(el('button', { class: 'vp-add-btn', onclick: () => openEditor(null, { kind: 'day', date: iso }) }, '+'));
      }
      daysGrid.appendChild(day);
    });
    weekRow.appendChild(daysGrid);

    // multi-day span layer with assigned lanes
    if (spansInWeek.length) {
      const spanLayer = el('div', {
        class: 'vp-span-layer',
        style: { height: spanLayerHeight + 'px' }
      });
      spansInWeek.forEach(s => {
        const colStart = Math.round((s.visStart - weekStart) / 86400000);
        const colSpan = Math.round((s.visEnd - s.visStart) / 86400000) + 1;
        const continuesLeft = s.anchorDate < weekStart;
        const continuesRight = s.spanEnd > weekEnd;
        const card = renderSpanCard(s.id, colStart, colSpan, continuesLeft, continuesRight);
        card.style.gridRow = (s.lane + 1);
        spanLayer.appendChild(card);
      });
      weekRow.appendChild(spanLayer);
    }

    cal.appendChild(weekRow);
  });
  calCol.appendChild(cal);
  layout.appendChild(calCol);

  // sidebar
  const side = el('div', { class: 'vp-side' });
  side.appendChild(libraryPanel());
  side.appendChild(statsPanel());
  layout.appendChild(side);

  root.appendChild(layout);
}

function libraryPanel() {
  const t = activeTrip();
  const panel = el('div', { class: 'vp-panel' });
  panel.appendChild(el('h3', {}, 'Card library'));

  const filterRow = el('div', { class: 'vp-lib-filter' });
  const filters = [['all', 'all']].concat(Object.entries(TYPES).map(([k, v]) => [k, v.label.toLowerCase()]));
  filters.forEach(([k, label]) => {
    filterRow.appendChild(el('button', {
      class: 'vp-chip' + (t.libFilter === k ? ' vp-chip-on' : ''),
      onclick: () => { t.libFilter = k; save(); render(); }
    }, label));
  });
  panel.appendChild(filterRow);

  const lib = el('div', { class: 'vp-lib' });
  attachDropZone(lib, { kind: 'lib' });
  const visible = t.library.filter(id => t.cards[id] && (t.libFilter === 'all' || t.cards[id].type === t.libFilter));
  if (visible.length === 0) {
    lib.appendChild(el('div', { class: 'vp-lib-empty' },
      t.library.length ? 'No cards in this category.' : 'Drag cards here to stash them, or click + new card to start.'));
  } else {
    visible.forEach(id => lib.appendChild(renderCard(id)));
  }
  panel.appendChild(lib);
  return panel;
}

function statsPanel() {
  const panel = el('div', { class: 'vp-panel vp-stats' });
  panel.appendChild(el('h3', {}, 'Trip math'));
  const s = computeStats();
  panel.appendChild(statRow('Total days', String(s.totalDays)));
  panel.appendChild(statRow('Days planned', String(s.filled)));
  panel.appendChild(statRow('Open days', String(s.unaccounted)));
  if (s.totalCards > 0) {
    const r = el('div', { class: 'vp-stat-row' });
    r.appendChild(el('span', {}, 'Booked'));
    const val = el('strong', {}, s.bookedCards + ' / ' + s.totalCards);
    if (s.bookedCards === s.totalCards) val.style.color = 'var(--booked)';
    r.appendChild(val);
    panel.appendChild(r);
  }
  if (Object.keys(s.cityNights).length) {
    panel.appendChild(el('div', { style: { marginTop: '10px', fontSize: '11px', color: 'var(--text-2)' } }, 'Nights per city'));
    Object.entries(s.cityNights).forEach(([city, n]) => {
      const r = el('div', { class: 'vp-stat-sub' });
      r.appendChild(el('span', {}, city));
      r.appendChild(el('span', {}, n + (n === 1 ? ' night' : ' nights')));
      panel.appendChild(r);
    });
  }
  if (s.totalFlightMin > 0) panel.appendChild(statRow('Flight time', fmtMin(s.totalFlightMin)));
  if (s.totalTransitMin > 0) panel.appendChild(statRow('Transit time', fmtMin(s.totalTransitMin)));
  return panel;
}

function statRow(label, val) {
  const r = el('div', { class: 'vp-stat-row' });
  r.appendChild(el('span', {}, label));
  r.appendChild(el('strong', {}, val));
  return r;
}

// How many calendar days does a card occupy?
function cardSpan(c) {
  if (!c) return 1;
  if (c.type === 'hotel') {
    const n = parseInt(c.nights) || 1;
    return Math.max(1, n);
  }
  if ((c.type === 'flight' || c.type === 'transit') && c.depart && c.arrive) {
    const d = c.depart.slice(0, 10), a = c.arrive.slice(0, 10);
    if (d && a) {
      const days = Math.round((parseISO(a) - parseISO(d)) / 86400000) + 1;
      return Math.max(1, days);
    }
  }
  return 1;
}

// Render a card that spans multiple day columns within a single week row.
// colStart: 0-6, colSpan: how many columns it occupies in THIS week
function renderSpanCard(id, colStart, colSpan, continuesLeft, continuesRight) {
  const t = activeTrip();
  const c = t.cards[id]; if (!c) return el('span');
  const tp = TYPES[c.type] || TYPES.note;
  const bg = tp.bg;
  const fg = tp.text;
  const card = el('div', {
    class: 'vp-span-card' + (c.booked ? ' vp-booked' : ''),
    draggable: 'true',
    'data-id': id,
    style: {
      gridColumnStart: (colStart + 1),
      gridColumnEnd: (colStart + 1 + colSpan),
      background: bg,
      borderLeftColor: continuesLeft ? 'transparent' : tp.color,
      color: fg,
      borderTopLeftRadius: continuesLeft ? 0 : '',
      borderBottomLeftRadius: continuesLeft ? 0 : '',
      borderTopRightRadius: continuesRight ? 0 : '',
      borderBottomRightRadius: continuesRight ? 0 : ''
    },
    onclick: e => { if (e.target.closest('.vp-card-actions')) return; openEditor(id); }
  });
  const title = el('div', { class: 'vp-card-title' });
  if (!continuesLeft) {
    title.appendChild(el('i', { class: 'ti ' + tp.icon, style: { fontSize: '13px' }, 'aria-hidden': 'true' }));
  }
  title.appendChild(el('span', {}, (continuesLeft ? '… ' : '') + (c.title || tp.label) + (continuesRight ? ' …' : '')));
  if (c.booked && !continuesLeft) {
    title.appendChild(el('span', { class: 'vp-booked-badge', title: 'Booked' }, '✓'));
  }
  card.appendChild(title);
  const meta = cardMeta(c);
  if (meta && !continuesLeft) card.appendChild(el('div', { class: 'vp-card-meta' }, meta));

  const actions = el('div', { class: 'vp-card-actions' });
  actions.appendChild(el('button', { title: 'Duplicate', onclick: e => { e.stopPropagation(); duplicateCard(id); } }, '⧉'));
  actions.appendChild(el('button', { title: 'Delete', onclick: e => { e.stopPropagation(); if (confirm('Delete this card?')) removeCard(id); } }, '×'));
  card.appendChild(actions);

  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('vp-dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('vp-dragging'));
  return card;
}

function renderCard(id) {
  const t = activeTrip();
  const c = t.cards[id]; if (!c) return el('span');
  const tp = TYPES[c.type] || TYPES.note;
  const bg = tp.bg;
  const fg = tp.text;
  const card = el('div', {
    class: 'vp-card' + (c.booked ? ' vp-booked' : ''),
    draggable: 'true',
    'data-id': id,
    style: { background: bg, borderLeftColor: tp.color, color: fg },
    onclick: e => { if (e.target.closest('.vp-card-actions')) return; openEditor(id); }
  });
  const title = el('div', { class: 'vp-card-title' });
  title.appendChild(el('i', { class: 'ti ' + tp.icon, style: { fontSize: '13px' }, 'aria-hidden': 'true' }));
  title.appendChild(el('span', {}, c.title || tp.label));
  if (c.booked) {
    title.appendChild(el('span', { class: 'vp-booked-badge', title: 'Booked' }, '✓'));
  }
  card.appendChild(title);
  const meta = cardMeta(c);
  if (meta) card.appendChild(el('div', { class: 'vp-card-meta' }, meta));

  const actions = el('div', { class: 'vp-card-actions' });
  actions.appendChild(el('button', { title: 'Duplicate', onclick: e => { e.stopPropagation(); duplicateCard(id); } }, '⧉'));
  actions.appendChild(el('button', { title: 'Delete', onclick: e => { e.stopPropagation(); if (confirm('Delete this card?')) removeCard(id); } }, '×'));
  card.appendChild(actions);

  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('vp-dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('vp-dragging'));
  return card;
}

function cardMeta(c) {
  const bits = [];
  if (c.type === 'flight' || c.type === 'transit') {
    if (c.type === 'flight' && c.flightNo) bits.push(c.flightNo);
    if (c.depart && c.arrive) {
      const dt = c.depart.slice(11, 16), at = c.arrive.slice(11, 16);
      const dDate = c.depart.slice(0, 10), aDate = c.arrive.slice(0, 10);
      const from = c.originCity ? c.originCity + ' ' : '';
      const to = c.destCity ? c.destCity + ' ' : '';
      let leg = from + dt + ' → ' + to + at;
      if (dDate && aDate && aDate > dDate) {
        leg += ' +' + Math.round((parseISO(aDate) - parseISO(dDate)) / 86400000);
      }
      bits.push(leg);
    } else if (c.originCity || c.destCity) {
      bits.push((c.originCity || '?') + ' → ' + (c.destCity || '?'));
    }
  } else {
    if (c.city) bits.push(c.city);
    if (c.time) bits.push(c.time);
    if (c.type === 'hotel' && c.nights) bits.push(c.nights + (c.nights == 1 ? ' night' : ' nights'));
  }
  return bits.join(' · ');
}

function attachDropZone(zone, target) {
  zone.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('vp-drop');
  });
  zone.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('vp-drop');
  });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('vp-drop');
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveCard(id, target);
  });
}
