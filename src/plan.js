// Itinerary planner: build and compare whole-trip drafts side by side.
// A draft is a sequence of stops (city + nights), each with a transport
// and lodging pick, a cost, and a 1-5 star rating.
import { activeTrip, ui } from './state.js';
import { el } from './dom.js';
import { save } from './storage.js';
import { render } from './render.js';
import { addCard } from './cards.js';
import { isoDate, parseISO, addDays, fmtShort } from './dates.js';

function plan() {
  const t = activeTrip();
  if (!t.plan) t.plan = { drafts: [] };
  return t.plan;
}

function emptyStop() {
  return {
    id: crypto.randomUUID(),
    city: '', nights: 1,
    transport: { label: '', cost: 0, costUnit: 'usd', stars: 0 },
    lodging: { label: '', cost: 0, costUnit: 'usd', stars: 0, url: '' }
  };
}

// ---------- draft / stop operations ----------
function addDraft() {
  const p = plan();
  p.drafts.push({
    id: crypto.randomUUID(),
    name: 'Draft ' + (p.drafts.length + 1),
    stars: 0, notes: '', startDate: '',
    stops: [emptyStop()]
  });
  save(); render();
}

function updateDraft(id, patch) {
  const d = plan().drafts.find(x => x.id === id);
  if (d) { Object.assign(d, patch); save(); render(); }
}

function removeDraft(id) {
  const p = plan();
  p.drafts = p.drafts.filter(x => x.id !== id);
  save(); render();
}

function duplicateDraft(id) {
  const p = plan();
  const src = p.drafts.find(x => x.id === id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = crypto.randomUUID();
  copy.name = src.name + ' copy';
  copy.stops.forEach(s => { s.id = crypto.randomUUID(); });
  p.drafts.push(copy);
  save(); render();
}

function addStop(draftId) {
  const d = plan().drafts.find(x => x.id === draftId);
  if (d) { d.stops.push(emptyStop()); save(); render(); }
}

function updateStop(draftId, stopId, patch) {
  const d = plan().drafts.find(x => x.id === draftId);
  const s = d && d.stops.find(x => x.id === stopId);
  if (s) { Object.assign(s, patch); save(); render(); }
}

function removeStop(draftId, stopId) {
  const d = plan().drafts.find(x => x.id === draftId);
  if (d) { d.stops = d.stops.filter(x => x.id !== stopId); save(); render(); }
}

// ---------- derived ----------
function draftTotals(d) {
  let usd = 0, points = 0, nights = 0;
  (d.stops || []).forEach(s => {
    nights += parseInt(s.nights, 10) || 0;
    [s.transport, s.lodging].forEach(x => {
      const c = x && parseFloat(x.cost);
      if (!c || c < 0) return;
      if (x.costUnit === 'points') points += c;
      else usd += c;
    });
  });
  return { usd, points, nights };
}

function tripWindowDays() {
  const t = activeTrip();
  if (!t.startDate || !t.endDate) return 0;
  return Math.round((parseISO(t.endDate) - parseISO(t.startDate)) / 86400000) + 1;
}

function fmtCost(usd, points) {
  const bits = [];
  if (usd) bits.push('$' + Math.round(usd).toLocaleString());
  if (points) bits.push(Math.round(points).toLocaleString() + ' pts');
  return bits.length ? bits.join('  +  ') : '—';
}

// ---------- star widgets ----------
function starInput(initial, onChange) {
  const wrap = el('div', { class: 'vp-stars vp-stars-input' });
  let val = initial || 0;
  function draw() {
    wrap.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      wrap.appendChild(el('button', {
        type: 'button',
        class: 'vp-star' + (i <= val ? ' vp-star-on' : ''),
        onclick: () => { val = (i === val) ? 0 : i; draw(); onChange(val); }
      }, '★'));
    }
  }
  draw();
  return wrap;
}

function starsView(val) {
  const w = el('span', { class: 'vp-stars' });
  for (let i = 1; i <= 5; i++) {
    w.appendChild(el('span', { class: 'vp-star' + (i <= (val || 0) ? ' vp-star-on' : '') }, '★'));
  }
  return w;
}

// ---------- send a draft to the calendar ----------
// Schedules each stop's transport + lodging onto real calendar dates, walking
// a cursor from the draft's start date (or the trip start) by each stop's
// nights. The trip window is widened so every placed card stays visible.
function sendDraftToCalendar(d) {
  const t = activeTrip();
  const startISO = d.startDate || t.startDate;
  if (!startISO) {
    alert('Set a start date on this draft (Edit draft) so its stops can be placed on the calendar.');
    return;
  }
  const stops = d.stops || [];
  if (!stops.length) return;
  if (!confirm('Add this draft’s stops to the calendar? Your existing cards are kept.')) return;

  ui.view = 'calendar';
  let cursor = parseISO(startISO);
  const firstISO = isoDate(cursor);
  let prevCity = '';

  stops.forEach(s => {
    const iso = isoDate(cursor);
    const nights = parseInt(s.nights, 10) || 0;
    if (s.transport && s.transport.label) {
      const cost = costLabel(s.transport);
      addCard({
        type: 'transit',
        title: s.transport.label,
        originCity: prevCity,
        destCity: s.city || '',
        notes: cost ? 'Est. cost: ' + cost : ''
      }, { kind: 'day', date: iso });
    }
    if (s.lodging && s.lodging.label) {
      const cost = costLabel(s.lodging);
      addCard({
        type: 'hotel',
        title: s.lodging.label,
        city: s.city || '',
        nights: nights || 1,
        notes: [s.lodging.url, cost ? 'Est. cost: ' + cost : '']
          .filter(Boolean).join('\n')
      }, { kind: 'day', date: iso });
    }
    prevCity = s.city || prevCity;
    cursor = addDays(cursor, nights);
  });

  // Widen the trip window so every placed card is on a visible day.
  if (!t.startDate || firstISO < t.startDate) t.startDate = firstISO;
  const lastISO = isoDate(cursor);
  if (!t.endDate || lastISO > t.endDate) t.endDate = lastISO;
  save();
  render();
}

// ---------- editors ----------
function costRow(initialCost, initialUnit) {
  const cost = el('input', { type: 'number', min: '0', value: initialCost || '', placeholder: '0' });
  const unit = el('select', {});
  [['usd', '$ USD'], ['points', 'points']].forEach(([k, label]) => {
    const o = el('option', { value: k }, label);
    if ((initialUnit || 'usd') === k) o.selected = true;
    unit.appendChild(o);
  });
  const row = el('div', { class: 'vp-cost-row' }, cost, unit);
  return { row, cost, unit };
}

function openDraftEditor(id) {
  const d = plan().drafts.find(x => x.id === id);
  if (!d) return;
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, 'Edit draft'));

  const nameIn = el('input', { type: 'text', value: d.name || '' });
  let stars = d.stars || 0;
  const startIn = el('input', { type: 'date', value: d.startDate || '' });
  const notesIn = el('textarea', { placeholder: 'What this draft is about, trade-offs…' });
  notesIn.value = d.notes || '';

  m.appendChild(el('label', {}, 'Draft name'));
  m.appendChild(nameIn);
  m.appendChild(el('label', {}, 'Overall rating'));
  m.appendChild(starInput(stars, v => { stars = v; }));
  m.appendChild(el('label', {}, 'Start date (optional — dates each stop)'));
  m.appendChild(startIn);
  m.appendChild(el('label', {}, 'Notes'));
  m.appendChild(notesIn);

  const actions = el('div', { class: 'vp-modal-actions' });
  const left = el('div', { style: { display: 'flex', gap: '8px' } });
  left.appendChild(el('button', {
    class: 'vp-delete',
    onclick: () => { if (confirm('Delete this draft?')) { removeDraft(id); bg.remove(); } }
  }, 'Delete'));
  actions.appendChild(left);
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  right.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      updateDraft(id, {
        name: nameIn.value.trim() || 'Untitled draft',
        stars,
        startDate: startIn.value,
        notes: notesIn.value.trim()
      });
      bg.remove();
    }
  }, 'Save'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => nameIn.focus(), 30);
}

function openStopEditor(draftId, stopId) {
  const d = plan().drafts.find(x => x.id === draftId);
  const s = d && d.stops.find(x => x.id === stopId);
  if (!s) return;
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, 'Edit stop'));

  const cityIn = el('input', { type: 'text', value: s.city || '', placeholder: 'e.g. Buenos Aires' });
  const nightsIn = el('input', { type: 'number', min: '0', value: s.nights || 1 });

  const trLabel = el('input', { type: 'text', value: s.transport.label || '', placeholder: 'e.g. LATAM direct flight' });
  const trCost = costRow(s.transport.cost, s.transport.costUnit);
  let trStars = s.transport.stars || 0;

  const lgLabel = el('input', { type: 'text', value: s.lodging.label || '', placeholder: 'e.g. Hotel B&B / Airbnb' });
  const lgCost = costRow(s.lodging.cost, s.lodging.costUnit);
  const lgUrl = el('input', { type: 'text', value: s.lodging.url || '', placeholder: 'Booking link (optional)' });
  let lgStars = s.lodging.stars || 0;

  m.appendChild(el('label', {}, 'City'));
  m.appendChild(cityIn);
  m.appendChild(el('label', {}, 'Nights'));
  m.appendChild(nightsIn);

  m.appendChild(el('div', { class: 'vp-plan-section' }, 'Getting there'));
  m.appendChild(el('label', {}, 'Transport'));
  m.appendChild(trLabel);
  m.appendChild(el('label', {}, 'Cost'));
  m.appendChild(trCost.row);
  m.appendChild(el('label', {}, 'Rating'));
  m.appendChild(starInput(trStars, v => { trStars = v; }));

  m.appendChild(el('div', { class: 'vp-plan-section' }, 'Lodging'));
  m.appendChild(el('label', {}, 'Place'));
  m.appendChild(lgLabel);
  m.appendChild(el('label', {}, 'Cost'));
  m.appendChild(lgCost.row);
  m.appendChild(el('label', {}, 'Booking link'));
  m.appendChild(lgUrl);
  m.appendChild(el('label', {}, 'Rating'));
  m.appendChild(starInput(lgStars, v => { lgStars = v; }));

  const actions = el('div', { class: 'vp-modal-actions' });
  const left = el('div', { style: { display: 'flex', gap: '8px' } });
  left.appendChild(el('button', {
    class: 'vp-delete',
    onclick: () => { if (confirm('Delete this stop?')) { removeStop(draftId, stopId); bg.remove(); } }
  }, 'Delete'));
  actions.appendChild(left);
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  right.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      updateStop(draftId, stopId, {
        city: cityIn.value.trim(),
        nights: parseInt(nightsIn.value, 10) || 0,
        transport: {
          label: trLabel.value.trim(),
          cost: parseFloat(trCost.cost.value) || 0,
          costUnit: trCost.unit.value,
          stars: trStars
        },
        lodging: {
          label: lgLabel.value.trim(),
          cost: parseFloat(lgCost.cost.value) || 0,
          costUnit: lgCost.unit.value,
          url: lgUrl.value.trim(),
          stars: lgStars
        }
      });
      bg.remove();
    }
  }, 'Save'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => cityIn.focus(), 30);
}

// ---------- rendering ----------
function costLabel(x) {
  const c = x && parseFloat(x.cost);
  if (!c || c < 0) return '';
  return x.costUnit === 'points'
    ? Math.round(c).toLocaleString() + ' pts'
    : '$' + Math.round(c).toLocaleString();
}

function renderStopBlock(draft, stop, dayCursor) {
  const block = el('div', {
    class: 'vp-stop',
    onclick: e => { if (e.target.closest('.vp-stop-rm')) return; openStopEditor(draft.id, stop.id); }
  });

  const head = el('div', { class: 'vp-stop-head' });
  head.appendChild(el('span', { class: 'vp-stop-city' }, stop.city || 'Untitled stop'));
  const n = parseInt(stop.nights, 10) || 0;
  head.appendChild(el('span', { class: 'vp-stop-nights' }, n + (n === 1 ? ' night' : ' nights')));
  block.appendChild(head);

  if (dayCursor) {
    const end = addDays(dayCursor, Math.max(0, n));
    block.appendChild(el('div', { class: 'vp-stop-dates' },
      fmtShort(dayCursor) + ' – ' + fmtShort(end)));
  }

  if (stop.transport && stop.transport.label) {
    const row = el('div', { class: 'vp-stop-line' });
    row.appendChild(el('i', { class: 'ti ti-arrow-right vp-stop-ico' }));
    row.appendChild(el('span', { class: 'vp-stop-line-label' }, stop.transport.label));
    const cl = costLabel(stop.transport);
    if (cl) row.appendChild(el('span', { class: 'vp-stop-cost' }, cl));
    if (stop.transport.stars) row.appendChild(starsView(stop.transport.stars));
    block.appendChild(row);
  }
  if (stop.lodging && stop.lodging.label) {
    const row = el('div', { class: 'vp-stop-line' });
    row.appendChild(el('i', { class: 'ti ti-bed vp-stop-ico' }));
    row.appendChild(el('span', { class: 'vp-stop-line-label' }, stop.lodging.label));
    const cl = costLabel(stop.lodging);
    if (cl) row.appendChild(el('span', { class: 'vp-stop-cost' }, cl));
    if (stop.lodging.stars) row.appendChild(starsView(stop.lodging.stars));
    block.appendChild(row);
  }

  block.appendChild(el('button', {
    class: 'vp-stop-rm', title: 'Remove stop',
    onclick: e => { e.stopPropagation(); if (confirm('Remove this stop?')) removeStop(draft.id, stop.id); }
  }, '×'));
  return block;
}

function renderDraftColumn(draft) {
  const col = el('div', { class: 'vp-draft' });

  const head = el('div', { class: 'vp-draft-head' });
  const titleBtn = el('button', {
    class: 'vp-draft-title', title: 'Edit draft',
    onclick: () => openDraftEditor(draft.id)
  }, draft.name || 'Untitled draft');
  head.appendChild(titleBtn);
  const headActions = el('div', { class: 'vp-draft-actions' });
  headActions.appendChild(el('button', {
    title: 'Duplicate', onclick: () => duplicateDraft(draft.id)
  }, '⧉'));
  headActions.appendChild(el('button', {
    title: 'Delete', onclick: () => { if (confirm('Delete this draft?')) removeDraft(draft.id); }
  }, '×'));
  head.appendChild(headActions);
  col.appendChild(head);

  col.appendChild(starsView(draft.stars));
  if (draft.notes) col.appendChild(el('div', { class: 'vp-draft-notes' }, draft.notes));

  const stopsWrap = el('div', { class: 'vp-draft-stops' });
  let cursor = draft.startDate ? parseISO(draft.startDate) : null;
  (draft.stops || []).forEach(s => {
    stopsWrap.appendChild(renderStopBlock(draft, s, cursor));
    if (cursor) cursor = addDays(cursor, parseInt(s.nights, 10) || 0);
  });
  col.appendChild(stopsWrap);

  col.appendChild(el('button', {
    class: 'vp-stop-add', onclick: () => addStop(draft.id)
  }, '+ add stop'));

  const totals = draftTotals(draft);
  const foot = el('div', { class: 'vp-draft-foot' });
  foot.appendChild(el('div', { class: 'vp-draft-total' }, fmtCost(totals.usd, totals.points)));
  foot.appendChild(el('div', { class: 'vp-draft-nights' },
    totals.nights + (totals.nights === 1 ? ' night total' : ' nights total')));

  const win = tripWindowDays();
  if (win && totals.nights && Math.abs(totals.nights - win) > 1) {
    foot.appendChild(el('div', { class: 'vp-draft-warn' },
      '⚠ ' + totals.nights + ' nights vs a ' + win + '-day trip window'));
  }
  foot.appendChild(el('button', {
    class: 'vp-draft-send', onclick: () => sendDraftToCalendar(draft)
  }, 'Send to calendar'));
  col.appendChild(foot);

  return col;
}

// Built by render() when the Plan view is active.
export function renderPlanView() {
  const p = plan();
  const panel = el('div', { class: 'vp-plan' });

  const head = el('div', { class: 'vp-places-head' });
  head.appendChild(el('h3', {}, 'Plan — itinerary drafts'));
  head.appendChild(el('button', { class: 'vp-btn-primary', onclick: addDraft }, '+ new draft'));
  panel.appendChild(head);

  if (!p.drafts.length) {
    panel.appendChild(el('div', { class: 'vp-places-empty' },
      'No drafts yet. Add a draft to sketch a candidate itinerary, then compare.'));
    return panel;
  }

  const row = el('div', { class: 'vp-draft-row' });
  p.drafts.forEach(d => row.appendChild(renderDraftColumn(d)));
  panel.appendChild(row);
  return panel;
}
