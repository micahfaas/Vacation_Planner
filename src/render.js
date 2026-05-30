// Calendar grid, card rendering, sidebar panels, and drag-and-drop.
import { activeTrip, ui } from './state.js';
import { TYPES, CITY_STAY_COLORS } from './constants.js';
import { el } from './dom.js';
import { isoDate, parseISO, addDays, fmtShort, fmtMin } from './dates.js';
import { getDays, getGridDays, computeStats, getConflicts, cardSpan, belongsInSpanLayer, todayInTrip } from './derived.js';
import { buildDraftPreviews, clearDraftPreviews, compactCostLabel } from './plan.js';
import { save } from './storage.js';
import { duplicateCard, removeCard, moveCard } from './cards.js';
import { openEditor } from './editor.js';
import { openCardDetail } from './cardview.js';
import { openHelp } from './help.js';
import { renderTodayView, stopTodayTimer } from './today.js';
import { renderPlacesView } from './places.js';
import { renderPlanView } from './plan.js';
import { renderResourcesView } from './resources.js';
import { renderRemindersView } from './reminders.js';
import { confirmDialog } from './dialog.js';
import { openTripCheck } from './tripcheck.js';
import { renderJournalView } from './journal.js';

const root = document.getElementById('vp-root');

// One-time: land on the Today view at boot when the trip is already underway.
let viewPicked = false;

export function render() {
  stopTodayTimer(); // drop any countdown timer before the view is rebuilt
  const t = activeTrip();
  document.getElementById('vp-trip-name').textContent = t.name;
  root.innerHTML = '';

  // At boot, open straight into day-of mode when the trip is already underway.
  if (!viewPicked) {
    viewPicked = true;
    if (todayInTrip()) ui.view = 'today';
  }

  // toolbar with the view toggle
  const tb = el('div', { class: 'vp-toolbar' });
  const toggle = el('div', { class: 'vp-view-toggle' });
  const tabs = [
    ['today', 'Day'], ['calendar', 'Calendar'], ['places', 'Places'],
    ['plan', 'Plan'], ['resources', 'Resources'], ['reminders', 'Reminders'],
    ['journal', 'Journal']
  ];
  tabs.forEach(([v, label]) => {
    toggle.appendChild(el('button', {
      class: 'vp-view-btn' + (ui.view === v ? ' vp-view-on' : ''),
      onclick: () => {
        if (v === 'today') ui.dayDate = null; // the Day tab lands on today / trip start
        ui.view = v;
        render();
      }
    }, label));
  });
  tb.appendChild(toggle);

  if (ui.view === 'calendar') {
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
    tb.appendChild(el('button', { class: 'vp-btn-ghost vp-tc-btn', onclick: openTripCheck }, 'Check trip'));
    tb.appendChild(el('button', { class: 'vp-btn-primary vp-newcard-btn', onclick: () => openEditor(null, { kind: 'lib' }) }, '+ new card'));
  }
  tb.appendChild(el('button', {
    class: 'vp-btn-ghost vp-help-btn',
    title: 'How to use this page', 'aria-label': 'How to use this page',
    onclick: () => openHelp(ui.view)
  }, [el('i', { class: 'ti ti-help-circle', 'aria-hidden': 'true' }), ' How to use']));
  root.appendChild(tb);

  if (ui.view === 'today') {
    root.appendChild(renderTodayView());
    return;
  }

  if (ui.view === 'places') {
    root.appendChild(renderPlacesView());
    return;
  }

  if (ui.view === 'plan') {
    root.appendChild(renderPlanView());
    return;
  }

  if (ui.view === 'resources') {
    root.appendChild(renderResourcesView());
    return;
  }

  if (ui.view === 'reminders') {
    root.appendChild(renderRemindersView());
    return;
  }

  if (ui.view === 'journal') {
    root.appendChild(renderJournalView());
    return;
  }

  if (!t.startDate || !t.endDate || t.endDate < t.startDate) {
    root.appendChild(el('div', { class: 'vp-empty-cal' }, 'Pick a start and end date to begin.'));
    return;
  }

  // Preview bar: drafts overlaid on the calendar as a non-destructive
  // comparison. Offers a quick path to commit (Use this route) or dismiss.
  const previewIds = ui.previewDraftIds || [];
  if (previewIds.length) {
    root.appendChild(renderPreviewBar());
  }

  // Multi-draft comparison: each draft gets its own compact, trip-card-free
  // calendar so the city-order differences read instantly. Single-draft
  // preview keeps the overlay-on-real-trip behavior (handled below).
  if (previewIds.length >= 2) {
    root.appendChild(renderComparisonView(previewIds));
    return;
  }

  const layout = el('div', { class: 'vp-layout' });

  const calCol = el('div', {});
  calCol.appendChild(isNarrow() ? agendaList() : calendarGrid());
  layout.appendChild(calCol);

  // sidebar
  const side = el('div', { class: 'vp-side' });
  side.appendChild(libraryPanel());
  side.appendChild(statsPanel());
  const budget = budgetPanel();
  if (budget) side.appendChild(budget);
  layout.appendChild(side);

  root.appendChild(layout);
}

// Below this width the calendar swaps its 7-column grid for an agenda list.
const NARROW = window.matchMedia('(max-width: 640px)');
function isNarrow() { return NARROW.matches; }
NARROW.addEventListener('change', () => {
  if (activeTrip() && ui.view === 'calendar') render();
});

// The month grid: weeks of 7 day cells with a multi-day span layer.
function calendarGrid() {
  const t = activeTrip();
  const wrap = el('div', {});
  const calHead = el('div', { class: 'vp-cal-head' });
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(d => calHead.appendChild(el('div', {}, d)));
  wrap.appendChild(calHead);

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

    // collect cards that render in the span layer (multi-day cards + every
    // city stay regardless of length), sorted so city stays always claim
    // lane 0 (the top "you are in <city>" banner), then by start date then
    // by duration desc.
    const spansInWeek = [];
    const seenIds = new Set();
    Object.keys(t.schedule).forEach(anchor => {
      t.schedule[anchor].forEach(id => {
        if (seenIds.has(id)) return;
        const c = t.cards[id]; if (!c) return;
        if (!belongsInSpanLayer(c)) return;
        const span = cardSpan(c);
        const anchorDate = parseISO(anchor);
        const spanEnd = addDays(anchorDate, span - 1);
        if (spanEnd < weekStart || anchorDate > weekEnd) return;
        seenIds.add(id);
        spansInWeek.push({ id, anchorDate, spanEnd, isCityStay: c.type === 'cityStay' });
      });
    });

    // Preview overlays: each draft contributes its own row of synthetic
    // city-stay banners, slotted in below the real ones (lane 1+).
    const previews = buildDraftPreviews(ui.previewDraftIds || []);
    previews.forEach((preview, draftIdx) => {
      preview.stops.forEach(stop => {
        const anchorDate = parseISO(stop.dateISO);
        const spanEnd = addDays(anchorDate, Math.max(1, stop.nights) - 1);
        if (spanEnd < weekStart || anchorDate > weekEnd) return;
        spansInWeek.push({
          isPreview: true,
          previewStop: stop,
          previewDraft: preview.draft,
          previewIdx: draftIdx,
          anchorDate,
          spanEnd,
          isCityStay: false
        });
      });
    });

    spansInWeek.sort((a, b) => {
      // 1. real city-stays first (lane 0)
      if (a.isCityStay !== b.isCityStay) return a.isCityStay ? -1 : 1;
      // 2. preview banners next, grouped by draft so each draft gets a row
      if (a.isPreview !== b.isPreview) return a.isPreview ? -1 : 1;
      if (a.isPreview && b.isPreview && a.previewIdx !== b.previewIdx) {
        return a.previewIdx - b.previewIdx;
      }
      // 3. everything else by start date / duration
      return a.anchorDate - b.anchorDate || (b.spanEnd - b.anchorDate) - (a.spanEnd - a.anchorDate);
    });

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
        // Always reserve the top strip for the (absolutely-positioned) date
        // number, plus extra room below it for the multi-day banner layer.
        style: { paddingTop: (28 + spanLayerHeight) + 'px' }
      });
      const headRow = el('div', { class: 'vp-day-num' });
      const lbl = d.getDate() === 1 || iso === t.startDate ? fmtShort(d) : String(d.getDate());
      if (out) {
        headRow.appendChild(el('span', {}, lbl));
      } else {
        headRow.appendChild(el('button', {
          class: 'vp-day-open', title: 'Open this day in the Day view',
          onclick: () => { ui.dayDate = iso; ui.view = 'today'; render(); }
        }, lbl));
      }
      if (conflicts[iso] && !out) {
        headRow.appendChild(el('i', { class: 'ti ti-alert-triangle vp-conflict-ico', title: 'Time overlap on this day' }));
      }
      day.appendChild(headRow);

      if (!out) {
        attachDropZone(day, { kind: 'day', date: iso });
        (t.schedule[iso] || []).forEach(id => {
          const card = t.cards[id]; if (!card) return;
          if (!belongsInSpanLayer(card)) day.appendChild(renderCard(id));
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
        const card = s.isPreview
          ? renderPreviewSpanCard(s.previewStop, s.previewDraft, colStart, colSpan, continuesLeft, continuesRight)
          : renderSpanCard(s.id, colStart, colSpan, continuesLeft, continuesRight);
        card.style.gridRow = (s.lane + 1);
        spanLayer.appendChild(card);
      });
      weekRow.appendChild(spanLayer);
    }

    cal.appendChild(weekRow);
  });
  wrap.appendChild(cal);
  return wrap;
}

// The mobile agenda: one stacked card per trip day, fully interactive.
function agendaList() {
  const t = activeTrip();
  const conflicts = getConflicts();
  const wrap = el('div', { class: 'vp-agenda' });
  getDays().forEach(d => {
    const iso = isoDate(d);
    const day = el('div', {
      class: 'vp-agenda-day' + (conflicts[iso] ? ' vp-conflict' : ''),
      'data-date': iso
    });
    const head = el('div', { class: 'vp-agenda-day-head' });
    head.appendChild(el('button', {
      class: 'vp-day-open', title: 'Open this day in the Day view',
      onclick: () => { ui.dayDate = iso; ui.view = 'today'; render(); }
    }, d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })));
    if (conflicts[iso]) {
      head.appendChild(el('i', {
        class: 'ti ti-alert-triangle vp-conflict-ico', title: 'Time overlap on this day'
      }));
    }
    day.appendChild(head);

    // City-stay banners go at the top of every day they span (not just the
    // anchor day), so the user always sees "you're in <city>" in agenda mode.
    activeCityStaysOn(iso).forEach(id => day.appendChild(renderCityBanner(id)));

    attachDropZone(day, { kind: 'day', date: iso });
    const ids = t.schedule[iso] || [];
    // Skip city stays in the regular card list — they render as banners above.
    ids.forEach(id => {
      const c = t.cards[id];
      if (!c || c.type === 'cityStay') return;
      day.appendChild(renderCard(id));
    });
    const hasContent = ids.some(id => t.cards[id] && t.cards[id].type !== 'cityStay');
    if (!hasContent) day.appendChild(el('div', { class: 'vp-agenda-empty' }, 'Nothing planned'));
    day.appendChild(el('button', {
      class: 'vp-add-btn', onclick: () => openEditor(null, { kind: 'day', date: iso })
    }, '+ add card'));
    wrap.appendChild(day);
  });
  return wrap;
}

// Find every city-stay card whose anchor + nights covers the given ISO date.
// Returns an array of card ids (usually 0 or 1; rarely overlapping stays).
function activeCityStaysOn(iso) {
  const t = activeTrip();
  const target = parseISO(iso);
  const hits = [];
  Object.keys(t.schedule).forEach(anchor => {
    t.schedule[anchor].forEach(id => {
      const c = t.cards[id];
      if (!c || c.type !== 'cityStay') return;
      const start = parseISO(anchor);
      const end = addDays(start, Math.max(1, parseInt(c.nights) || 1) - 1);
      if (target >= start && target <= end) hits.push(id);
    });
  });
  return hits;
}

// A pill-style banner used by the agenda + Day views to mark "you're in <city>"
// at the top of every day a city-stay covers.
function renderCityBanner(id) {
  const t = activeTrip();
  const c = t.cards[id]; if (!c) return el('span');
  const palette = c.color && CITY_STAY_COLORS[c.color]
    ? CITY_STAY_COLORS[c.color]
    : TYPES.cityStay;
  const banner = el('div', {
    class: 'vp-city-banner',
    style: { background: palette.bg, color: palette.text, borderLeftColor: palette.color },
    onclick: () => openCardDetail(id)
  });
  banner.appendChild(el('i', { class: 'ti ti-map-pin' }));
  banner.appendChild(el('span', { class: 'vp-city-banner-name' }, c.title || c.city || 'City'));
  if (c.nights) {
    banner.appendChild(el('span', { class: 'vp-city-banner-nights' },
      c.nights + (c.nights == 1 ? ' night' : ' nights')));
  }
  return banner;
}

export { activeCityStaysOn, renderCityBanner };

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

// Estimated-spend panel — only shown once at least one card has a cost.
function budgetPanel() {
  const s = computeStats();
  if (!(s.totalCost > 0)) return null;
  const panel = el('div', { class: 'vp-panel vp-budget' });
  panel.appendChild(el('h3', {}, 'Budget'));
  panel.appendChild(el('div', { class: 'vp-budget-total' },
    '$' + Math.round(s.totalCost).toLocaleString()));
  panel.appendChild(el('div', { class: 'vp-budget-sub' }, 'estimated total'));

  Object.entries(s.costByType).sort((a, b) => b[1] - a[1]).forEach(([type, amt]) => {
    const tp = TYPES[type] || TYPES.note;
    const row = el('div', { class: 'vp-budget-row' });
    const head = el('div', { class: 'vp-budget-row-head' });
    const left = el('span', { class: 'vp-budget-label' },
      el('i', { class: 'ti ' + tp.icon }), ' ' + tp.label);
    head.appendChild(left);
    head.appendChild(el('strong', {}, '$' + Math.round(amt).toLocaleString()));
    row.appendChild(head);
    const bar = el('div', { class: 'vp-budget-bar' });
    bar.appendChild(el('div', {
      class: 'vp-budget-fill',
      style: { width: (amt / s.totalCost * 100).toFixed(1) + '%', background: tp.color }
    }));
    row.appendChild(bar);
    panel.appendChild(row);
  });
  return panel;
}

// Render a card that spans multiple day columns within a single week row.
// colStart: 0-6, colSpan: how many columns it occupies in THIS week
function renderSpanCard(id, colStart, colSpan, continuesLeft, continuesRight) {
  const t = activeTrip();
  const c = t.cards[id]; if (!c) return el('span');
  const tp = TYPES[c.type] || TYPES.note;
  const isCityStay = c.type === 'cityStay';
  // Per-card color override for city stays: looks up the named palette so
  // Madrid/Sevilla/Granada each get their own bar tint.
  const palette = isCityStay && c.color && CITY_STAY_COLORS[c.color]
    ? CITY_STAY_COLORS[c.color]
    : tp;
  const bg = palette.bg;
  const fg = palette.text;
  const accent = palette.color;
  const card = el('div', {
    class: 'vp-span-card' + (isCityStay ? ' vp-span-city' : '') + (c.booked ? ' vp-booked' : ''),
    draggable: 'true',
    'data-id': id,
    style: {
      gridColumnStart: (colStart + 1),
      gridColumnEnd: (colStart + 1 + colSpan),
      background: bg,
      borderLeftColor: continuesLeft ? 'transparent' : accent,
      color: fg,
      borderTopLeftRadius: continuesLeft ? 0 : '',
      borderBottomLeftRadius: continuesLeft ? 0 : '',
      borderTopRightRadius: continuesRight ? 0 : '',
      borderBottomRightRadius: continuesRight ? 0 : ''
    },
    onclick: e => { if (e.target.closest('.vp-card-actions')) return; openCardDetail(id); }
  });
  const title = el('div', { class: 'vp-card-title' });
  if (!continuesLeft) {
    title.appendChild(el('i', { class: 'ti ' + tp.icon, style: { fontSize: '13px' }, 'aria-hidden': 'true' }));
  }
  title.appendChild(el('span', {}, (continuesLeft ? '… ' : '') + (c.title || tp.label) + (continuesRight ? ' …' : '')));
  if (c.booked && !continuesLeft) {
    title.appendChild(el('span', { class: 'vp-booked-badge', title: 'Booked' }, '✓'));
  }
  if (c.attachments && c.attachments.length && !continuesLeft) {
    title.appendChild(el('i', { class: 'ti ti-paperclip vp-attach-badge', title: c.attachments.length + ' file(s) attached' }));
  }
  card.appendChild(title);
  const meta = cardMeta(c);
  if (meta && !continuesLeft) card.appendChild(el('div', { class: 'vp-card-meta' }, meta));

  const actions = el('div', { class: 'vp-card-actions' });
  actions.appendChild(el('button', { title: 'Duplicate', 'aria-label': 'Duplicate card', onclick: e => { e.stopPropagation(); duplicateCard(id); } }, '⧉'));
  actions.appendChild(el('button', { title: 'Delete', 'aria-label': 'Delete card', onclick: e => { e.stopPropagation(); confirmDialog('Delete this card?', { danger: true, confirmText: 'Delete' }).then(ok => { if (ok) removeCard(id); }); } }, '×'));
  card.appendChild(actions);

  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('vp-dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('vp-dragging'));
  return card;
}

// Top-of-calendar bar shown while one or more Plan drafts are being
// previewed. Lists the drafts, offers Use this route (commit) for a single
// preview and a Back-to-Plan dismiss for any selection.
function renderPreviewBar() {
  const ids = ui.previewDraftIds || [];
  const previews = buildDraftPreviews(ids);
  const bar = el('div', { class: 'vp-preview-bar' });
  if (previews.length === 1) {
    bar.appendChild(el('span', { class: 'vp-preview-bar-label' },
      'Previewing: ' + (previews[0].draft.name || 'draft')));
  } else if (previews.length > 1) {
    bar.appendChild(el('span', { class: 'vp-preview-bar-label' },
      'Comparing ' + previews.length + ' drafts'));
    bar.appendChild(el('span', { class: 'vp-preview-bar-list' },
      previews.map(p => p.draft.name || 'draft').join(' · ')));
  }
  const actions = el('div', { class: 'vp-preview-bar-actions' });
  if (previews.length === 1) {
    actions.appendChild(el('button', {
      class: 'vp-preview-use',
      onclick: () => {
        const draftId = ids[0];
        clearDraftPreviews();
        // jump back to the Plan tab so the user lands on the draft and
        // can click Use this route through the normal commit flow.
        ui.view = 'plan';
        ui.planSelectedDraftId = draftId;
        render();
      }
    }, 'Open in Plan tab'));
  }
  actions.appendChild(el('button', {
    class: 'vp-preview-back',
    onclick: () => { clearDraftPreviews(); }
  }, 'Back to Plan'));
  bar.appendChild(actions);
  return bar;
}

// Multi-draft comparison view: every draft shares one Sun→Sat date axis,
// and within each week's block each draft gets its own labeled row. So
// week 1 stacks "Route A | Sun..Sat" above "Route B | Sun..Sat", with a
// gap before week 2's block. Each row shows the draft's city-stay bars
// and the flight chips that arrive at each city (plus the return leg).
function renderComparisonView(draftIds) {
  const previews = buildDraftPreviews(draftIds);
  if (!previews.length) {
    return el('div', { class: 'vp-empty-cal' }, 'No drafts to compare.');
  }

  // Date-range union, extended one day past the last stop so the return
  // transport chip has a cell to live in.
  let earliest = null, latest = null;
  previews.forEach(p => {
    p.stops.forEach(s => {
      const start = parseISO(s.dateISO);
      const end = addDays(start, Math.max(1, s.nights) - 1);
      if (!earliest || start < earliest) earliest = start;
      if (!latest || end > latest) latest = end;
    });
    if (p.returnTransport) {
      const ret = parseISO(p.endISO);
      if (!latest || ret > latest) latest = ret;
    }
  });
  if (!earliest) {
    return el('div', { class: 'vp-empty-cal' },
      'These drafts have no stops yet — add stops on the Plan tab.');
  }

  const padBefore = earliest.getDay();
  const padAfter = 6 - latest.getDay();
  const gridStart = addDays(earliest, -padBefore);
  const gridEnd = addDays(latest, padAfter);
  const weeks = [];
  for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 7)) {
    const week = [];
    for (let i = 0; i < 7; i++) week.push(addDays(d, i));
    weeks.push(week);
  }

  const wrap = el('div', { class: 'vp-compare' });

  // One shared Sun → Sat header at the top.
  const headRow = el('div', { class: 'vp-compare-head' });
  headRow.appendChild(el('div', { class: 'vp-compare-corner' }));
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(d =>
    headRow.appendChild(el('div', { class: 'vp-compare-weekday' }, d)));
  wrap.appendChild(headRow);

  weeks.forEach(week => {
    const weekStart = week[0];
    const weekEnd = week[6];
    const weekBlock = el('div', { class: 'vp-compare-week-block' });
    previews.forEach(preview => {
      weekBlock.appendChild(renderCompareWeekRow(preview, week, weekStart, weekEnd, earliest, latest));
    });
    wrap.appendChild(weekBlock);
  });

  return wrap;
}

// One labeled route row for one week. The row contains 7 cells (one per
// weekday) with faint day numbers, overlaid by city-stay bars + flight
// chips that span / land on the relevant cells.
function renderCompareWeekRow(preview, week, weekStart, weekEnd, rangeStart, rangeEnd) {
  const row = el('div', { class: 'vp-compare-row' });
  row.appendChild(el('div', { class: 'vp-compare-label' },
    preview.draft.name || 'Route'));

  const cellsWrap = el('div', { class: 'vp-compare-cells-wrap' });

  // Day cells with faint date numbers.
  const cellsGrid = el('div', { class: 'vp-compare-cells' });
  week.forEach(d => {
    const inRange = d >= rangeStart && d <= rangeEnd;
    const cell = el('div', { class: 'vp-compare-cell' + (inRange ? '' : ' vp-out') });
    cell.appendChild(el('span', { class: 'vp-compare-day-num' }, String(d.getDate())));
    cellsGrid.appendChild(cell);
  });
  cellsWrap.appendChild(cellsGrid);

  // Overlay layer: banner per stop spanning the right cells, prefixed with
  // the inbound transport info on the leftmost cell of each stop.
  const overlay = el('div', { class: 'vp-compare-overlay' });
  preview.stops.forEach(stop => {
    const start = parseISO(stop.dateISO);
    const end = addDays(start, Math.max(1, stop.nights) - 1);
    if (end < weekStart || start > weekEnd) return;
    const visStart = start < weekStart ? weekStart : start;
    const visEnd = end > weekEnd ? weekEnd : end;
    const colStart = Math.round((visStart - weekStart) / 86400000) + 1;
    const colSpan = Math.round((visEnd - visStart) / 86400000) + 1;
    overlay.appendChild(renderCompareBanner(stop, preview.draft,
      colStart, colSpan, start < weekStart, end > weekEnd));
  });
  // Return-home leg, drawn as a thin chip on its single landing cell.
  if (preview.returnTransport) {
    const retDate = parseISO(preview.endISO);
    if (retDate >= weekStart && retDate <= weekEnd) {
      const col = Math.round((retDate - weekStart) / 86400000) + 1;
      overlay.appendChild(renderReturnChip(preview.returnTransport, col));
    }
  }
  cellsWrap.appendChild(overlay);

  row.appendChild(cellsWrap);
  return row;
}

// City-stay banner used in the comparison view. Includes the inbound
// transport (label + cost) at the top when this is the stop's start cell.
function renderCompareBanner(stop, draft, colStart, colSpan, continuesLeft, continuesRight) {
  const palette = stop.color && CITY_STAY_COLORS[stop.color]
    ? CITY_STAY_COLORS[stop.color]
    : TYPES.cityStay;
  const banner = el('div', {
    class: 'vp-compare-banner',
    style: {
      gridColumnStart: colStart,
      gridColumnEnd: colStart + colSpan,
      background: palette.bg,
      borderLeftColor: continuesLeft ? 'transparent' : palette.color,
      color: palette.text,
      borderTopLeftRadius: continuesLeft ? 0 : '',
      borderBottomLeftRadius: continuesLeft ? 0 : '',
      borderTopRightRadius: continuesRight ? 0 : '',
      borderBottomRightRadius: continuesRight ? 0 : ''
    },
    title: (draft && draft.name ? draft.name + ' · ' : '') +
      (stop.city || 'Stay') + ' · ' + stop.nights +
      (stop.nights === 1 ? ' night' : ' nights')
  });
  if (!continuesLeft && stop.transport) {
    const cost = compactCostLabel(stop.transport);
    banner.appendChild(el('div', { class: 'vp-compare-leg' },
      el('i', { class: 'ti ti-plane-tilt' }),
      el('span', { class: 'vp-compare-leg-label' }, stop.transport.label || ''),
      cost ? el('span', { class: 'vp-compare-leg-cost' }, cost) : null));
  }
  const title = el('div', { class: 'vp-compare-banner-title' });
  title.appendChild(el('i', { class: 'ti ti-map-pin' }));
  title.appendChild(el('span', {},
    (continuesLeft ? '… ' : '') + (stop.city || 'Stay') + (continuesRight ? ' …' : '')));
  if (!continuesLeft && stop.nights) {
    title.appendChild(el('span', { class: 'vp-compare-banner-nights' },
      stop.nights + (stop.nights === 1 ? 'n' : 'n')));
  }
  banner.appendChild(title);
  return banner;
}

// Return-home transport chip — sits on its landing cell in the route's row
// (the day after the last stop).
function renderReturnChip(transport, col) {
  const cost = compactCostLabel(transport);
  const chip = el('div', {
    class: 'vp-compare-return',
    style: { gridColumnStart: col, gridColumnEnd: col + 1 },
    title: 'Return home · ' + (transport.label || '')
  });
  chip.appendChild(el('i', { class: 'ti ti-home' }));
  chip.appendChild(el('span', { class: 'vp-compare-leg-label' },
    transport.label || 'Return home'));
  if (cost) chip.appendChild(el('span', { class: 'vp-compare-leg-cost' }, cost));
  return chip;
}

// A non-interactive city-stay banner used to overlay a Plan draft on the
// real calendar. Dashed + italic so it reads as "not committed yet".
function renderPreviewSpanCard(stop, draft, colStart, colSpan, continuesLeft, continuesRight) {
  const palette = stop.color && CITY_STAY_COLORS[stop.color]
    ? CITY_STAY_COLORS[stop.color]
    : TYPES.cityStay;
  const card = el('div', {
    class: 'vp-span-card vp-span-city vp-span-preview',
    style: {
      gridColumnStart: (colStart + 1),
      gridColumnEnd: (colStart + 1 + colSpan),
      background: palette.bg,
      borderLeftColor: continuesLeft ? 'transparent' : palette.color,
      color: palette.text,
      borderTopLeftRadius: continuesLeft ? 0 : '',
      borderBottomLeftRadius: continuesLeft ? 0 : '',
      borderTopRightRadius: continuesRight ? 0 : '',
      borderBottomRightRadius: continuesRight ? 0 : ''
    },
    title: (draft && draft.name ? draft.name + ' · ' : '') +
      (stop.city || 'Stay') + ' · ' + stop.nights + (stop.nights === 1 ? ' night' : ' nights')
  });
  const title = el('div', { class: 'vp-card-title' });
  if (!continuesLeft) {
    title.appendChild(el('i', { class: 'ti ti-map-pin', style: { fontSize: '13px' }, 'aria-hidden': 'true' }));
  }
  title.appendChild(el('span', {},
    (continuesLeft ? '… ' : '') + (stop.city || 'Stay') + (continuesRight ? ' …' : '')));
  card.appendChild(title);
  if (!continuesLeft && stop.nights) {
    card.appendChild(el('div', { class: 'vp-card-meta' },
      stop.nights + (stop.nights === 1 ? ' night' : ' nights')));
  }
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
    onclick: e => { if (e.target.closest('.vp-card-actions')) return; openCardDetail(id); }
  });
  const title = el('div', { class: 'vp-card-title' });
  title.appendChild(el('i', { class: 'ti ' + tp.icon, style: { fontSize: '13px' }, 'aria-hidden': 'true' }));
  title.appendChild(el('span', {}, c.title || tp.label));
  if (c.booked) {
    title.appendChild(el('span', { class: 'vp-booked-badge', title: 'Booked' }, '✓'));
  }
  if (c.attachments && c.attachments.length) {
    title.appendChild(el('i', { class: 'ti ti-paperclip vp-attach-badge', title: c.attachments.length + ' file(s) attached' }));
  }
  card.appendChild(title);
  const meta = cardMeta(c);
  if (meta) card.appendChild(el('div', { class: 'vp-card-meta' }, meta));

  const actions = el('div', { class: 'vp-card-actions' });
  actions.appendChild(el('button', { title: 'Duplicate', 'aria-label': 'Duplicate card', onclick: e => { e.stopPropagation(); duplicateCard(id); } }, '⧉'));
  actions.appendChild(el('button', { title: 'Delete', 'aria-label': 'Delete card', onclick: e => { e.stopPropagation(); confirmDialog('Delete this card?', { danger: true, confirmText: 'Delete' }).then(ok => { if (ok) removeCard(id); }); } }, '×'));
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
    // City stays use the city as their title; meta only carries the nights.
    if (c.type !== 'cityStay' && c.city) bits.push(c.city);
    if (c.time) bits.push(c.time);
    if ((c.type === 'hotel' || c.type === 'cityStay') && c.nights) {
      bits.push(c.nights + (c.nights == 1 ? ' night' : ' nights'));
    }
  }
  if (c.cost > 0) bits.push('$' + Math.round(c.cost).toLocaleString());
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
