// Itinerary planner: build and compare whole-trip drafts side by side.
// A draft is a sequence of stops (city + nights), each with a transport
// and lodging pick, a cost, and a 1-5 star rating.
import { activeTrip, ui } from './state.js';
import { el, collapsible } from './dom.js';
import { save } from './storage.js';
import { render } from './render.js';
import { addCard } from './cards.js';
import { isoDate, parseISO, addDays, fmtShort } from './dates.js';
import { confirmDialog, alertDialog } from './dialog.js';
import { weatherSummary } from './weather.js';
import { placeCity } from './places.js';
import { getPointsBalances, setPointsBalances } from './profile.js';
import { transferAdvisorLocked } from './entitlements.js';
import { requireUpgrade } from './upgrade.js';
import { CITY_STAY_COLORS } from './constants.js';
import {
  matchCurrency, matchProgram, transfersInto, reachableFrom,
  ratioLabel, LAST_VERIFIED
} from './transfers.js';

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

// Move a stop within its draft so it lands at the target stop's position.
function reorderStops(draftId, draggedId, targetId) {
  if (draggedId === targetId) return;
  const d = plan().drafts.find(x => x.id === draftId);
  if (!d) return;
  const from = d.stops.findIndex(s => s.id === draggedId);
  const to = d.stops.findIndex(s => s.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = d.stops.splice(from, 1);
  d.stops.splice(to, 0, moved);
  save(); render();
}

// Move a draft column so it lands at the target draft's position.
function reorderDrafts(draggedId, targetId) {
  if (draggedId === targetId) return;
  const p = plan();
  const from = p.drafts.findIndex(x => x.id === draggedId);
  const to = p.drafts.findIndex(x => x.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = p.drafts.splice(from, 1);
  p.drafts.splice(to, 0, moved);
  save(); render();
}

// ---------- derived ----------
// A cost slot can hold:
//   - cash:     cost > 0 and costUnit === 'usd'   → usd
//   - points:   cost > 0 and costUnit === 'points' → goes to pointsByProgram[pointsProgram || 'Points']
//   - taxes:    cashTaxes > 0 → usd (always; real-world award redemptions carry cash taxes)
function addCost(x, totals) {
  if (!x) return;
  const c = parseFloat(x.cost);
  if (c > 0) {
    if (x.costUnit === 'points') {
      const prog = (x.pointsProgram || 'Points').trim() || 'Points';
      totals.pointsByProgram[prog] = (totals.pointsByProgram[prog] || 0) + c;
    } else {
      totals.usd += c;
    }
  }
  const tax = parseFloat(x.cashTaxes);
  if (tax > 0) totals.usd += tax;
}
function draftTotals(d) {
  const totals = { usd: 0, pointsByProgram: {}, nights: 0 };
  (d.stops || []).forEach(s => {
    totals.nights += parseInt(s.nights, 10) || 0;
    addCost(s.transport, totals);
    addCost(s.lodging, totals);
  });
  if (d.returnTransport) addCost(d.returnTransport, totals);
  return totals;
}

// Abbreviate large point counts: 240000 → "240k", 1500 → "1,500".
function fmtPoints(n) {
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  return Math.round(n).toLocaleString();
}

// Find lat/lng for a city by matching against the trip's saved places.
function coordsForCity(city) {
  const target = (city || '').trim().toLowerCase();
  if (!target) return null;
  const places = (activeTrip().places || [])
    .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');
  const match = places.find(p => (placeCity(p) || '').toLowerCase() === target);
  return match ? { lat: match.lat, lng: match.lng } : null;
}

function fmtWeather(s) {
  const kind = s.kind === 'forecast' ? 'forecast'
    : s.kind === 'recorded' ? 'recorded' : 'typical · last yr';
  return s.hi + '° / ' + s.lo + '°F · ' +
    s.rainDays + (s.rainDays === 1 ? ' rainy day' : ' rainy days') + ' · ' + kind;
}

function tripWindowDays() {
  const t = activeTrip();
  if (!t.startDate || !t.endDate) return 0;
  return Math.round((parseISO(t.endDate) - parseISO(t.startDate)) / 86400000) + 1;
}

function fmtCost(usd, pointsByProgram) {
  const bits = [];
  if (usd) bits.push('$' + Math.round(usd).toLocaleString());
  Object.keys(pointsByProgram || {}).sort().forEach(prog => {
    const n = pointsByProgram[prog];
    if (n > 0) bits.push(fmtPoints(n) + ' ' + prog);
  });
  return bits.length ? bits.join('  +  ') : '—';
}

// ---------- balances sidebar ----------
// Persist a balances array to the profile and re-render so the sidebar +
// running deltas pick up the change. Errors are surfaced via alertDialog
// (the profile.saveProfile path can fail if Supabase rejects the upsert).
async function persistBalances(arr) {
  try {
    await setPointsBalances(arr);
  } catch (e) {
    alertDialog('Could not save balances — ' + (e.message || e));
  }
  render();
}

// Given a draft, return a Map<program, { start, used, after }>. Programs the
// draft consumes that have no matching balance still show up so the user
// sees the spend; balances the draft doesn't touch are also included so they
// stay visible while one draft is selected.
function balancesAfterDraft(d, balances) {
  const totals = draftTotals(d);
  const out = new Map();
  balances.forEach(b => {
    const start = parseFloat(b.balance) || 0;
    const used = totals.pointsByProgram[b.name] || 0;
    out.set(b.name, { start, used, after: start - used });
  });
  Object.entries(totals.pointsByProgram).forEach(([prog, used]) => {
    if (!out.has(prog)) out.set(prog, { start: 0, used, after: -used });
  });
  return out;
}

// Balances the user holds that map onto a flexible bank currency in the
// transfer graph — the only balances a transfer can *originate* from.
function heldCurrencies(balances) {
  const out = [];
  balances.forEach(b => {
    if (!b.name) return;
    const currency = matchCurrency(b.name);
    if (currency) out.push({ balance: b, currency });
  });
  return out;
}

// Transfers move in 1,000-point blocks; round needed amounts up to match.
function roundTransfer(n) {
  return Math.ceil(n / 1000) * 1000;
}

// Hook A: given an award program a draft burns and how many points are
// missing, suggest held flexible currencies that transfer into it.
function transferSuggestions(programText, needed, held) {
  // The personalized transfer advisor is a Plus feature; on Free the per-draft
  // suggestions are replaced by a single upgrade nudge shown lower in the panel.
  if (transferAdvisorLocked()) return null;
  const prog = matchProgram(programText);
  if (!prog) return null;
  const options = transfersInto(prog.id, held);
  if (!options.length) return null;
  const wrap = el('div', { class: 'vp-transfer-suggest' });
  options.forEach(o => {
    const pts = roundTransfer(Math.ceil(needed / o.ratio));
    const have = parseFloat(o.balance.balance) || 0;
    const covers = have >= pts;
    const line = el('div', { class: 'vp-transfer-opt' + (covers ? '' : ' vp-transfer-opt-short') });
    line.appendChild(el('span', { class: 'vp-transfer-bulb' }, '↻'));
    line.appendChild(el('span', {},
      'Transfer ' + fmtPoints(pts) + ' from ' + o.currency.name +
      ' (' + ratioLabel(o.ratio) + ', ' + o.speed + ')'));
    if (!covers) {
      line.appendChild(el('span', { class: 'vp-transfer-short' },
        ' · only have ' + fmtPoints(have)));
    }
    wrap.appendChild(line);
  });
  return wrap;
}

function balanceRow(b, onChange, onRemove) {
  const row = el('div', { class: 'vp-balance-row' });
  const name = el('input', {
    type: 'text', value: b.name || '', placeholder: 'Program (e.g. Avios)'
  });
  const amount = el('input', {
    type: 'number', min: '0', step: '1',
    value: b.balance != null ? b.balance : '', placeholder: '0'
  });
  name.addEventListener('change', () => onChange({ name: name.value.trim(), balance: parseFloat(amount.value) || 0 }));
  amount.addEventListener('change', () => onChange({ name: name.value.trim(), balance: parseFloat(amount.value) || 0 }));
  const rm = el('button', {
    type: 'button', class: 'vp-balance-rm', title: 'Remove balance',
    onclick: onRemove
  }, '×');
  row.appendChild(name);
  row.appendChild(amount);
  row.appendChild(rm);
  return row;
}

function renderBalancesPanel() {
  const balances = getPointsBalances().slice();
  const selectedDraft = ui.planSelectedDraftId
    ? plan().drafts.find(d => d.id === ui.planSelectedDraftId)
    : null;
  const deltas = selectedDraft ? balancesAfterDraft(selectedDraft, balances) : null;
  const held = heldCurrencies(balances);

  const panel = el('aside', { class: 'vp-plan-side' });
  panel.appendChild(el('h4', { class: 'vp-plan-side-h' }, 'Points & miles'));
  panel.appendChild(el('div', { class: 'vp-plan-side-sub' },
    selectedDraft ? 'After: ' + (selectedDraft.name || 'selected draft') : 'Free-text — name them whatever you want.'));

  const list = el('div', { class: 'vp-balance-list' });
  balances.forEach((b, idx) => {
    list.appendChild(balanceRow(b,
      patch => {
        const next = balances.slice();
        next[idx] = patch;
        persistBalances(next);
      },
      () => {
        const next = balances.filter((_, i) => i !== idx);
        persistBalances(next);
      }
    ));
    if (deltas) {
      const d = deltas.get(b.name);
      if (d && d.used > 0) {
        list.appendChild(renderDeltaLine(d));
        if (d.after < 0) {
          const sug = transferSuggestions(b.name, Math.abs(d.after), held);
          if (sug) list.appendChild(sug);
        }
      }
    }
  });

  // Programs the selected draft burns but the user hasn't added a balance for.
  if (deltas) {
    deltas.forEach((d, prog) => {
      const known = balances.some(b => b.name === prog);
      if (!known && d.used > 0) {
        list.appendChild(el('div', { class: 'vp-balance-orphan' },
          el('strong', {}, prog),
          el('span', {}, ' uses ' + fmtPoints(d.used) + ' · no balance set')));
        const sug = transferSuggestions(prog, d.used, held);
        if (sug) list.appendChild(sug);
      }
    });
  }

  panel.appendChild(list);

  panel.appendChild(el('button', {
    class: 'vp-balance-add',
    onclick: () => persistBalances(balances.concat({ name: '', balance: 0 }))
  }, '+ add balance'));

  // Hook B: explore what each held flexible currency can become.
  if (transferAdvisorLocked()) {
    // Free plan: one nudge instead of the personalized "what can my points
    // become?" explorer and the per-draft transfer suggestions above.
    const up = el('button', {
      class: 'vp-transfer-toggle',
      onclick: () => requireUpgrade(
        'See exactly which of your points transfer to cover an award — and what your balances can become.', 'plus')
    }, '🔒 Points transfer advisor — Plus');
    panel.appendChild(up);
  } else if (held.length) {
    const open = !!ui.planShowTransfers;
    panel.appendChild(el('button', {
      class: 'vp-transfer-toggle',
      onclick: () => { ui.planShowTransfers = !open; render(); }
    }, (open ? '▾ ' : '▸ ') + 'What can my points become?'));
    if (open) {
      const sec = el('div', { class: 'vp-transfer-explore' });
      held.forEach(({ balance, currency }) => {
        sec.appendChild(el('div', { class: 'vp-transfer-cur' },
          currency.name + ' · ' + fmtPoints(parseFloat(balance.balance) || 0)));
        reachableFrom(currency, balance.balance)
          .sort((a, b) => b.miles - a.miles)
          .forEach(r => {
            const row = el('div', { class: 'vp-transfer-reach' });
            row.appendChild(el('span', { class: 'vp-transfer-reach-name' }, r.name));
            row.appendChild(el('span', { class: 'vp-transfer-reach-miles' },
              fmtPoints(r.miles) + (r.ratio !== 1 ? ' · ' + ratioLabel(r.ratio) : '')));
            sec.appendChild(row);
          });
      });
      sec.appendChild(el('div', { class: 'vp-transfer-foot' },
        'Partners as of ' + LAST_VERIFIED + ' · verify before booking'));
      panel.appendChild(sec);
    }
  }

  if (selectedDraft) {
    panel.appendChild(el('button', {
      class: 'vp-plan-clear-sel',
      onclick: () => { ui.planSelectedDraftId = null; render(); }
    }, 'Clear selection'));
  }

  return panel;
}

function renderDeltaLine(d) {
  const after = d.after;
  const short = after < 0 ? Math.abs(after) : 0;
  const cls = 'vp-balance-delta' + (after < 0 ? ' vp-balance-delta-bad' : '');
  const row = el('div', { class: cls });
  row.appendChild(el('span', { class: 'vp-balance-delta-arrow' }, '→'));
  row.appendChild(el('span', { class: 'vp-balance-delta-after' }, fmtPoints(after)));
  row.appendChild(el('span', { class: 'vp-balance-delta-used' }, '(−' + fmtPoints(d.used) + ')'));
  if (short > 0) {
    row.appendChild(el('span', { class: 'vp-balance-short' }, '⚠ short by ' + fmtPoints(short)));
  } else if (d.used > 0) {
    row.appendChild(el('span', { class: 'vp-balance-ok' }, '✓'));
  }
  return row;
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

// ---------- commit / preview a draft on the calendar ----------
// Pull cash/points/program off a draft's transport or lodging slot. Cash
// taxes always flow into the cash bucket because that's where real-world
// award redemptions levy them.
function paymentFromSlot(slot) {
  if (!slot) return { cost: 0, pointsCost: 0, pointsProgram: '' };
  const c = parseFloat(slot.cost) || 0;
  const tax = parseFloat(slot.cashTaxes) || 0;
  if (slot.costUnit === 'points') {
    return {
      cost: tax,
      pointsCost: c,
      pointsProgram: (slot.pointsProgram || '').trim()
    };
  }
  return { cost: c + tax, pointsCost: 0, pointsProgram: '' };
}

// Hash a city name to one of the named city-stay palettes so committed
// stays look distinct without making the user pick a color each time.
const CITY_STAY_PALETTE_ORDER = ['slate', 'amber', 'sage', 'rose', 'lavender'];
function autoCityColor(name) {
  const palette = Object.keys(CITY_STAY_COLORS).length
    ? CITY_STAY_PALETTE_ORDER.filter(k => CITY_STAY_COLORS[k])
    : ['slate'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

// Commit a draft to the live calendar: city-stay banner + hotel + transit
// per stop, plus the return-transport card. Cards inherit payment data
// (cash/points/program) so the Plan sidebar deltas keep matching reality
// after the commit.
async function useThisRoute(d) {
  const t = activeTrip();
  const startISO = d.startDate || t.startDate;
  if (!startISO) {
    alertDialog('Set a start date on this draft (Edit draft) so its stops can be placed on the calendar.');
    return;
  }
  const stops = d.stops || [];
  if (!stops.length) return;
  const go = await confirmDialog('Use this route? Its stops will be added to the calendar (your existing cards stay).',
    { confirmText: 'Use this route' });
  if (!go) return;

  ui.view = 'calendar';
  ui.previewDraftIds = []; // clear any preview overlay
  let cursor = parseISO(startISO);
  const firstISO = isoDate(cursor);
  let prevCity = '';

  stops.forEach(s => {
    const iso = isoDate(cursor);
    const nights = parseInt(s.nights, 10) || 0;
    if (s.transport && s.transport.label) {
      const pay = paymentFromSlot(s.transport);
      const card = {
        type: 'transit',
        title: s.transport.label,
        originCity: prevCity,
        destCity: s.city || '',
        notes: ''
      };
      if (pay.cost > 0) card.cost = pay.cost;
      if (pay.pointsCost > 0) {
        card.pointsCost = pay.pointsCost;
        card.pointsProgram = pay.pointsProgram;
      }
      addCard(card, { kind: 'day', date: iso });
    }
    if (s.city && nights > 0) {
      addCard({
        type: 'cityStay',
        title: s.city,
        city: s.city,
        nights,
        color: autoCityColor(s.city)
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

  if (d.returnTransport && d.returnTransport.label) {
    const iso = isoDate(cursor);
    const pay = paymentFromSlot(d.returnTransport);
    const card = {
      type: 'transit',
      title: d.returnTransport.label,
      originCity: prevCity,
      destCity: 'Home',
      notes: ''
    };
    if (pay.cost > 0) card.cost = pay.cost;
    if (pay.pointsCost > 0) {
      card.pointsCost = pay.pointsCost;
      card.pointsProgram = pay.pointsProgram;
    }
    addCard(card, { kind: 'day', date: iso });
  }

  // Widen the trip window so every placed card is on a visible day.
  if (!t.startDate || firstISO < t.startDate) t.startDate = firstISO;
  const lastISO = isoDate(cursor);
  if (!t.endDate || lastISO > t.endDate) t.endDate = lastISO;
  save();
  render();
}

// Non-destructive: switch to the Calendar with the draft overlaid as a
// preview. No trip cards are touched; the user can hit "Use this route" to
// commit, or "Back to Plan" to drop the overlay.
function previewDraftOnCalendar(draftId) {
  const d = plan().drafts.find(x => x.id === draftId);
  if (!d) return;
  if (!(d.startDate || activeTrip().startDate)) {
    alertDialog('Set a start date on this draft (Edit draft) so its stops can be placed on the calendar.');
    return;
  }
  ui.previewDraftIds = [draftId];
  ui.view = 'calendar';
  render();
}

// Multi-draft side-by-side comparison: every checked draft renders as its
// own stacked row of city-stay banners on the same calendar.
function compareDraftsOnCalendar(ids) {
  ui.previewDraftIds = ids.slice();
  ui.view = 'calendar';
  render();
}

// Build a synthetic "preview card set" for one or more drafts, anchored on
// the draft's startDate (or trip start). Returns
// [{ draft, stops: [{ city, nights, dateISO, color, transport }], endISO,
//   returnTransport }] which the Calendar renderer uses to lay banners on
// top of the live trip schedule. Transport is carried through verbatim so
// the comparison view can show "flight path · cost" per leg.
export function buildDraftPreviews(draftIds) {
  const t = activeTrip();
  const previews = [];
  (draftIds || []).forEach(id => {
    const d = plan().drafts.find(x => x.id === id);
    if (!d) return;
    const startISO = d.startDate || t.startDate;
    if (!startISO) return;
    let cursor = parseISO(startISO);
    const stops = (d.stops || []).map(s => {
      const dateISO = isoDate(cursor);
      const nights = parseInt(s.nights, 10) || 0;
      const out = {
        city: s.city || '',
        nights,
        dateISO,
        color: autoCityColor(s.city || 'stay'),
        transport: s.transport && s.transport.label ? s.transport : null
      };
      cursor = addDays(cursor, nights);
      return out;
    });
    previews.push({
      draft: d,
      stops,
      endISO: isoDate(cursor),
      returnTransport: d.returnTransport && d.returnTransport.label
        ? d.returnTransport : null
    });
  });
  return previews;
}

// Compact cost string for the Plan-tab comparison view: "$1,200", "68k Avios",
// or a mixed "68k Avios + $420" if the transport carries both points and cash
// taxes. Empty string when nothing is set.
export function compactCostLabel(slot) {
  if (!slot) return '';
  const c = parseFloat(slot.cost);
  const tax = parseFloat(slot.cashTaxes);
  const parts = [];
  if (c > 0) {
    if (slot.costUnit === 'points') {
      const pretty = c >= 10000 ? Math.round(c / 1000) + 'k' : Math.round(c).toLocaleString();
      const prog = (slot.pointsProgram || '').trim();
      parts.push(pretty + (prog ? ' ' + prog : ' pts'));
    } else {
      parts.push('$' + Math.round(c).toLocaleString());
    }
  }
  if (tax > 0) parts.push('+ $' + Math.round(tax).toLocaleString());
  return parts.join(' ');
}

// Called from the Calendar preview bar's "Back to Plan" button. Drops the
// overlay and bounces back to the Plan tab so the user can pick another
// route or edit the one they were previewing.
export function clearDraftPreviews() {
  ui.previewDraftIds = [];
  ui.view = 'plan';
  render();
}

// ---------- editors ----------
function costRow(initialCost, initialUnit, initialProgram, initialTaxes) {
  const cost = el('input', { type: 'number', min: '0', value: initialCost || '', placeholder: '0' });
  const unit = el('select', {});
  [['usd', '$ USD'], ['points', 'points']].forEach(([k, label]) => {
    const o = el('option', { value: k }, label);
    if ((initialUnit || 'usd') === k) o.selected = true;
    unit.appendChild(o);
  });
  // Which program the points come from (e.g. Avios) — only relevant when the
  // unit is "points". Autocompletes from the user's saved balances so the spend
  // matches a named balance + the transfer advisor.
  const program = el('input', {
    type: 'text', class: 'vp-cost-program', list: 'vp-balance-programs',
    value: initialProgram || '', placeholder: 'Program (e.g. Avios)'
  });
  // Cash taxes/fees paid alongside a points redemption (award flights almost
  // always carry some cash). Only shown for points; counts toward the USD total.
  const taxes = el('input', {
    type: 'number', min: '0', class: 'vp-cost-taxes',
    value: initialTaxes || '', placeholder: '+ cash taxes / fees ($)'
  });
  function sync() {
    const isPoints = unit.value === 'points';
    program.style.display = isPoints ? '' : 'none';
    taxes.style.display = isPoints ? '' : 'none';
  }
  unit.addEventListener('change', sync);
  sync();
  const row = el('div', { class: 'vp-cost-row' }, cost, unit, program, taxes);
  return { row, cost, unit, program, taxes };
}

// Datalist of saved balance names, so the program field autocompletes.
function balanceDatalist() {
  const dl = el('datalist', { id: 'vp-balance-programs' });
  getPointsBalances().forEach(b => { if (b && b.name) dl.appendChild(el('option', { value: b.name })); });
  return dl;
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
    onclick: () => {
      confirmDialog('Delete this draft?', { danger: true, confirmText: 'Delete' })
        .then(ok => { if (ok) { removeDraft(id); bg.remove(); } });
    }
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
  const trCost = costRow(s.transport.cost, s.transport.costUnit, s.transport.pointsProgram, s.transport.cashTaxes);
  let trStars = s.transport.stars || 0;

  const lgLabel = el('input', { type: 'text', value: s.lodging.label || '', placeholder: 'e.g. Hotel B&B / Airbnb' });
  const lgCost = costRow(s.lodging.cost, s.lodging.costUnit, s.lodging.pointsProgram, s.lodging.cashTaxes);
  const lgUrl = el('input', { type: 'text', value: s.lodging.url || '', placeholder: 'Booking link (optional)' });
  let lgStars = s.lodging.stars || 0;

  m.appendChild(el('label', {}, 'City'));
  m.appendChild(cityIn);
  m.appendChild(el('label', {}, 'Nights'));
  m.appendChild(nightsIn);

  // Getting there + Lodging are collapsible — open when the slot already has
  // a label or cost, so a fresh stop stays tidy (just City + Nights + two
  // section toggles) while an existing one shows its filled-in details.
  const trSec = collapsible('Getting there', !!(s.transport.label || s.transport.cost));
  trSec.body.appendChild(el('label', {}, 'Transport'));
  trSec.body.appendChild(trLabel);
  trSec.body.appendChild(el('label', {}, 'Cost'));
  trSec.body.appendChild(trCost.row);
  trSec.body.appendChild(el('label', {}, 'Rating'));
  trSec.body.appendChild(starInput(trStars, v => { trStars = v; }));
  m.appendChild(trSec.el);

  const lgSec = collapsible('Lodging', !!(s.lodging.label || s.lodging.cost));
  lgSec.body.appendChild(el('label', {}, 'Place'));
  lgSec.body.appendChild(lgLabel);
  lgSec.body.appendChild(el('label', {}, 'Cost'));
  lgSec.body.appendChild(lgCost.row);
  lgSec.body.appendChild(el('label', {}, 'Booking link'));
  lgSec.body.appendChild(lgUrl);
  lgSec.body.appendChild(el('label', {}, 'Rating'));
  lgSec.body.appendChild(starInput(lgStars, v => { lgStars = v; }));
  m.appendChild(lgSec.el);

  m.appendChild(balanceDatalist());

  const actions = el('div', { class: 'vp-modal-actions' });
  const left = el('div', { style: { display: 'flex', gap: '8px' } });
  left.appendChild(el('button', {
    class: 'vp-delete',
    onclick: () => {
      confirmDialog('Delete this stop?', { danger: true, confirmText: 'Delete' })
        .then(ok => { if (ok) { removeStop(draftId, stopId); bg.remove(); } });
    }
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
          pointsProgram: trCost.unit.value === 'points' ? trCost.program.value.trim() : '',
          cashTaxes: trCost.unit.value === 'points' ? (parseFloat(trCost.taxes.value) || 0) : 0,
          stars: trStars
        },
        lodging: {
          label: lgLabel.value.trim(),
          cost: parseFloat(lgCost.cost.value) || 0,
          costUnit: lgCost.unit.value,
          pointsProgram: lgCost.unit.value === 'points' ? lgCost.program.value.trim() : '',
          cashTaxes: lgCost.unit.value === 'points' ? (parseFloat(lgCost.taxes.value) || 0) : 0,
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
  if (!x) return '';
  const c = parseFloat(x.cost);
  const tax = parseFloat(x.cashTaxes);
  const parts = [];
  if (c > 0) {
    if (x.costUnit === 'points') {
      const prog = (x.pointsProgram || '').trim();
      parts.push(Math.round(c).toLocaleString() + (prog ? ' ' + prog : ' pts'));
    } else {
      parts.push('$' + Math.round(c).toLocaleString());
    }
  }
  if (tax > 0) parts.push('+ $' + Math.round(tax).toLocaleString());
  return parts.join(' ');
}

// Tracks the in-progress drag so dragover/drop don't have to read dataTransfer
// (Safari/WebKit hides custom data types during dragover, which silently breaks
// the drop). { kind: 'stop'|'draft', draftId, stopId? }
let planDrag = null;

function renderStopBlock(draft, stop, dayCursor) {
  const block = el('div', {
    class: 'vp-stop',
    draggable: 'true',
    'data-stop-id': stop.id,
    onclick: e => {
      if (e.target.closest('.vp-stop-rm') || e.target.closest('.vp-stop-grip')) return;
      openStopEditor(draft.id, stop.id);
    }
  });

  // Drag to reorder within this draft. A stop can only drop on another stop in
  // the same column (planDrag carries the source draft id).
  block.addEventListener('dragstart', e => {
    e.stopPropagation();
    planDrag = { kind: 'stop', draftId: draft.id, stopId: stop.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', stop.id); // required to start a drag in some browsers
    block.classList.add('vp-dragging');
  });
  block.addEventListener('dragend', () => { planDrag = null; block.classList.remove('vp-dragging'); });
  block.addEventListener('dragover', e => {
    if (!planDrag || planDrag.kind !== 'stop' || planDrag.draftId !== draft.id) return;
    e.preventDefault();
    block.classList.add('vp-drag-over');
  });
  block.addEventListener('dragleave', () => block.classList.remove('vp-drag-over'));
  block.addEventListener('drop', e => {
    if (!planDrag || planDrag.kind !== 'stop' || planDrag.draftId !== draft.id) return;
    e.preventDefault();
    block.classList.remove('vp-drag-over');
    reorderStops(draft.id, planDrag.stopId, stop.id);
  });

  const head = el('div', { class: 'vp-stop-head' });
  head.appendChild(el('span', { class: 'vp-stop-grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, '⠿'));
  head.appendChild(el('span', { class: 'vp-stop-city' }, stop.city || 'Untitled stop'));
  const n = parseInt(stop.nights, 10) || 0;
  head.appendChild(el('span', { class: 'vp-stop-nights' }, n + (n === 1 ? ' night' : ' nights')));
  block.appendChild(head);

  if (dayCursor) {
    const end = addDays(dayCursor, Math.max(0, n));
    block.appendChild(el('div', { class: 'vp-stop-dates' },
      fmtShort(dayCursor) + ' – ' + fmtShort(end)));

    // Weather outlook for this stop's date window — filled in asynchronously.
    const coords = coordsForCity(stop.city);
    if (coords) {
      const wx = el('div', { class: 'vp-stop-weather' });
      block.appendChild(wx);
      const endISO = isoDate(addDays(dayCursor, Math.max(0, n - 1)));
      weatherSummary(coords.lat, coords.lng, isoDate(dayCursor), endISO).then(s => {
        if (!s) { wx.remove(); return; }
        wx.appendChild(el('i', { class: 'ti ' + s.icon }));
        wx.appendChild(el('span', {}, fmtWeather(s)));
      });
    }
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
    class: 'vp-stop-rm', title: 'Remove stop', 'aria-label': 'Remove stop',
    onclick: e => {
      e.stopPropagation();
      confirmDialog('Remove this stop?', { danger: true, confirmText: 'Remove' })
        .then(ok => { if (ok) removeStop(draft.id, stop.id); });
    }
  }, '×'));
  return block;
}

function renderDraftColumn(draft) {
  const selected = ui.planSelectedDraftId === draft.id;
  const inCompare = (ui.planComparedDraftIds || []).includes(draft.id);
  const col = el('div', {
    class: 'vp-draft' + (selected ? ' vp-draft-selected' : '') + (inCompare ? ' vp-draft-comparing' : ''),
    'data-draft-id': draft.id,
    // Click anywhere on the card body (outside buttons/inputs/links) to
    // make this draft the "focus" of the balances sidebar.
    onclick: e => {
      if (e.target.closest('button, a, input, textarea, select, label')) return;
      ui.planSelectedDraftId = selected ? null : draft.id;
      render();
    }
  });

  // Drag-reorder draft columns left/right. Only reacts to the draft drag type,
  // so stop drags bubbling up from inside the column are ignored.
  col.addEventListener('dragover', e => {
    if (!planDrag || planDrag.kind !== 'draft') return;
    e.preventDefault();
    col.classList.add('vp-drag-over');
  });
  col.addEventListener('dragleave', e => {
    if (!col.contains(e.relatedTarget)) col.classList.remove('vp-drag-over');
  });
  col.addEventListener('drop', e => {
    if (!planDrag || planDrag.kind !== 'draft') return;
    e.preventDefault();
    col.classList.remove('vp-drag-over');
    reorderDrafts(planDrag.draftId, draft.id);
  });

  const head = el('div', { class: 'vp-draft-head' });
  // Drag handle — only the grip starts a column drag, so it doesn't fight with
  // the title button, compare checkbox, or click-to-focus inside the column.
  // A span (not a button) — browsers drag spans reliably, but are finicky
  // about native-dragging <button> elements.
  const grip = el('span', {
    class: 'vp-draft-grip', title: 'Drag to reorder', 'aria-label': 'Reorder draft',
    role: 'button', draggable: 'true', onclick: e => e.stopPropagation()
  }, '⠿');
  grip.addEventListener('dragstart', e => {
    planDrag = { kind: 'draft', draftId: draft.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draft.id); // required to start a drag in some browsers
    if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(col, 20, 20);
    col.classList.add('vp-dragging');
  });
  grip.addEventListener('dragend', () => { planDrag = null; col.classList.remove('vp-dragging'); });
  head.appendChild(grip);
  // Comparison toggle — a checkbox that pulls this draft into the multi-draft
  // calendar overlay. Independent from "selected" (single-focus for deltas).
  const compareToggle = el('input', {
    type: 'checkbox',
    class: 'vp-draft-compare',
    checked: inCompare ? '' : null,
    title: 'Add to side-by-side comparison',
    'aria-label': 'Compare on calendar'
  });
  if (inCompare) compareToggle.checked = true;
  compareToggle.addEventListener('change', () => {
    const set = new Set(ui.planComparedDraftIds || []);
    if (compareToggle.checked) set.add(draft.id);
    else set.delete(draft.id);
    ui.planComparedDraftIds = Array.from(set);
    render();
  });
  head.appendChild(compareToggle);
  const titleBtn = el('button', {
    class: 'vp-draft-title', title: 'Edit draft',
    onclick: e => { e.stopPropagation(); openDraftEditor(draft.id); }
  }, draft.name || 'Untitled draft');
  head.appendChild(titleBtn);
  const headActions = el('div', { class: 'vp-draft-actions' });
  headActions.appendChild(el('button', {
    title: 'Duplicate', 'aria-label': 'Duplicate draft',
    onclick: e => { e.stopPropagation(); duplicateDraft(draft.id); }
  }, '⧉'));
  headActions.appendChild(el('button', {
    title: 'Delete', 'aria-label': 'Delete draft',
    onclick: e => {
      e.stopPropagation();
      confirmDialog('Delete this draft?', { danger: true, confirmText: 'Delete' })
        .then(ok => { if (ok) removeDraft(draft.id); });
    }
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

  // Optional return leg — a single transport line shown after the last stop.
  if (draft.returnTransport && draft.returnTransport.label) {
    const ret = el('div', { class: 'vp-stop vp-stop-return' });
    ret.appendChild(el('div', { class: 'vp-stop-head' },
      el('span', { class: 'vp-stop-city' }, 'Return home')));
    if (cursor) {
      ret.appendChild(el('div', { class: 'vp-stop-dates' }, fmtShort(cursor)));
    }
    const row = el('div', { class: 'vp-stop-line' });
    row.appendChild(el('i', { class: 'ti ti-home vp-stop-ico' }));
    row.appendChild(el('span', { class: 'vp-stop-line-label' }, draft.returnTransport.label));
    const cl = costLabel(draft.returnTransport);
    if (cl) row.appendChild(el('span', { class: 'vp-stop-cost' }, cl));
    if (draft.returnTransport.stars) row.appendChild(starsView(draft.returnTransport.stars));
    ret.appendChild(row);
    col.appendChild(ret);
  }

  col.appendChild(el('button', {
    class: 'vp-stop-add', onclick: () => addStop(draft.id)
  }, '+ add stop'));

  const totals = draftTotals(draft);
  const foot = el('div', { class: 'vp-draft-foot' });
  foot.appendChild(el('div', { class: 'vp-draft-total' }, fmtCost(totals.usd, totals.pointsByProgram)));
  foot.appendChild(el('div', { class: 'vp-draft-nights' },
    totals.nights + (totals.nights === 1 ? ' night total' : ' nights total')));

  const win = tripWindowDays();
  if (win && totals.nights && Math.abs(totals.nights - win) > 1) {
    foot.appendChild(el('div', { class: 'vp-draft-warn' },
      '⚠ ' + totals.nights + ' nights vs a ' + win + '-day trip window'));
  }
  const footBtns = el('div', { class: 'vp-draft-foot-btns' });
  footBtns.appendChild(el('button', {
    class: 'vp-draft-preview',
    onclick: e => { e.stopPropagation(); previewDraftOnCalendar(draft.id); }
  }, 'View on calendar'));
  footBtns.appendChild(el('button', {
    class: 'vp-draft-send',
    onclick: e => { e.stopPropagation(); useThisRoute(draft); }
  }, 'Use this route'));
  foot.appendChild(footBtns);
  col.appendChild(foot);

  return col;
}

// Built by render() when the Plan view is active.
export function renderPlanView() {
  const p = plan();
  const panel = el('div', { class: 'vp-plan' });

  const head = el('div', { class: 'vp-places-head' });
  head.appendChild(el('h3', {}, 'Plan — itinerary drafts'));
  const headActions = el('div', { class: 'vp-plan-head-actions' });
  const compared = ui.planComparedDraftIds || [];
  if (compared.length >= 2) {
    headActions.appendChild(el('button', {
      class: 'vp-btn-secondary',
      onclick: () => compareDraftsOnCalendar(compared)
    }, 'Compare ' + compared.length + ' on calendar'));
  }
  // Standalone "+ add miles balance" so balances can be managed from the
  // header even before any drafts exist.
  headActions.appendChild(el('button', {
    class: 'vp-btn-secondary',
    onclick: () => persistBalances(getPointsBalances().concat({ name: '', balance: 0 }))
  }, '+ add miles balance'));
  headActions.appendChild(el('button', { class: 'vp-btn-primary', onclick: addDraft }, '+ new draft'));
  head.appendChild(headActions);
  panel.appendChild(head);

  // Sidebar is always rendered so the user can manage balances even with
  // zero drafts in play. The main area falls back to an empty-state hint.
  const layout = el('div', { class: 'vp-plan-layout' });
  layout.appendChild(renderBalancesPanel());

  // Clicking empty space in the drafts area deselects the focused draft.
  const main = el('div', {
    class: 'vp-plan-main',
    onclick: e => {
      if (e.target.closest('.vp-draft')) return;
      if (ui.planSelectedDraftId) { ui.planSelectedDraftId = null; render(); }
    }
  });
  if (!p.drafts.length) {
    main.appendChild(el('div', { class: 'vp-places-empty' },
      'No drafts yet. Add a draft to sketch a candidate itinerary, then compare.'));
  } else {
    const row = el('div', { class: 'vp-draft-row' });
    p.drafts.forEach(d => row.appendChild(renderDraftColumn(d)));
    main.appendChild(row);
  }
  layout.appendChild(main);

  panel.appendChild(layout);
  return panel;
}
