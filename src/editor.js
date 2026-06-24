// Card create/edit modal.
import { activeTrip } from './state.js';
import { TYPES, CITY_STAY_COLORS } from './constants.js';
import { getPointsBalances, getProfile } from './profile.js';
import { matchProgram, matchCurrency, transfersInto, ratioLabel } from './transfers.js';
import { el, collapsible } from './dom.js';
import { addCard, removeCard, duplicateCard } from './cards.js';
import { save } from './storage.js';
import { render } from './render.js';
import { createCityPicker } from './citypicker.js';
import { createAttachmentsField } from './attachments.js';
import { lookupFlight } from './flightlookup.js';
import { confirmDialog } from './dialog.js';
import { eligibleLoungesForFlight, hasLoungeProfile, airportsForCity } from './lounges.js';

export function openEditor(id, addTarget) {
  const t = activeTrip();
  const isNew = !id;
  const c = isNew ? { type: 'flight', title: '' } : Object.assign({}, t.cards[id]);

  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, isNew ? 'New card' : 'Edit card'));

  const typeSel = el('select', {});
  Object.entries(TYPES).forEach(([k, v]) => {
    const opt = el('option', { value: k }, v.label);
    if (c.type === k) opt.selected = true;
    typeSel.appendChild(opt);
  });
  m.appendChild(el('label', {}, 'Type'));
  m.appendChild(typeSel);

  const titleIn = el('input', { type: 'text', value: c.title || '', placeholder: 'e.g. Fly to Buenos Aires' });
  m.appendChild(el('label', {}, 'Title'));
  m.appendChild(titleIn);

  // City is shown for non-flight types; flight/transit use origin/destination pickers.
  const cityLabel = el('label', {}, 'City');
  const cityIn = el('input', { type: 'text', value: c.city || '', placeholder: 'e.g. Buenos Aires' });
  const originPicker = createCityPicker({
    city: c.originCity, timezone: c.originTz,
    latitude: c.originLat, longitude: c.originLng,
    placeholder: 'Search origin city…',
    onChange: () => refreshLounges()
  });
  const destPicker = createCityPicker({
    city: c.destCity, timezone: c.destTz,
    latitude: c.destLat, longitude: c.destLng,
    placeholder: 'Search destination city…',
    onChange: () => refreshLounges()
  });

  // Live lounge section: rebuilt whenever the cities (or type) change, reading
  // the current picker values rather than the card snapshot — so it works for
  // brand-new cards as the route is filled in.
  let loungeContainer = null;
  function refreshLounges() {
    if (!loungeContainer) return;
    loungeContainer.innerHTML = '';
    const liveCard = {
      type: typeSel.value,
      originCity: originPicker.getValue().name,
      destCity: destPicker.getValue().name
    };
    const block = renderLoungeBlock(liveCard);
    if (block) loungeContainer.appendChild(block);
  }

  const flightNoIn = el('input', { type: 'text', value: c.flightNo || '', placeholder: 'AA123' });
  const departIn = el('input', { type: 'datetime-local', value: c.depart || '' });
  const arriveIn = el('input', { type: 'datetime-local', value: c.arrive || '' });
  const timeIn = el('input', { type: 'time', value: c.time || '' });
  const nightsIn = el('input', { type: 'number', min: '1', value: c.nights || 1 });
  const costIn = el('input', {
    type: 'number', min: '0', step: '1',
    value: c.cost != null ? c.cost : '', placeholder: 'Estimated cost, e.g. 250'
  });

  // Points payment (flight/transit only). Free-text program with a datalist
  // sourced from the user's saved balances — autocompletes if they've already
  // entered "Avios", but they can type any new name too.
  const pointsCostIn = el('input', {
    type: 'number', min: '0', step: '1',
    value: c.pointsCost != null ? c.pointsCost : '',
    placeholder: 'e.g. 75000'
  });
  const pointsBalanceList = 'vp-balance-programs';
  const pointsProgramIn = el('input', {
    type: 'text',
    list: pointsBalanceList,
    value: c.pointsProgram || '',
    placeholder: 'e.g. Avios, Bonvoy, Flying Blue'
  });
  function buildPointsDatalist() {
    const dl = el('datalist', { id: pointsBalanceList });
    getPointsBalances().forEach(b => {
      if (b && b.name) dl.appendChild(el('option', { value: b.name }));
    });
    return dl;
  }

  // Live "can I cover this?" hint under the points fields: checks the entered
  // points cost + program against the user's saved balances and the transfer
  // graph, so they see at the point of entry whether they can pay this leg and,
  // if not directly, which flexible currency to transfer from. Reuses
  // transfers.js. The inputs persist across type switches, so the listeners are
  // attached once here; the hint element is re-parented into the points section
  // each time renderDynamic rebuilds it.
  const pointsHint = el('div', { class: 'vp-points-hint', style: { display: 'none' } });
  function updatePointsHint() {
    pointsHint.innerHTML = '';
    const hint = buildCoverageHint(pointsCostIn.value, pointsProgramIn.value);
    if (!hint) { pointsHint.style.display = 'none'; return; }
    pointsHint.style.display = '';
    pointsHint.className = 'vp-points-hint vp-points-hint-' + hint.tone;
    pointsHint.appendChild(el('i', { class: 'ti ' + HINT_ICON[hint.tone], 'aria-hidden': 'true' }));
    pointsHint.appendChild(el('span', {}, hint.text));
  }
  pointsCostIn.addEventListener('input', updatePointsHint);
  pointsProgramIn.addEventListener('input', updatePointsHint);

  const notesIn = el('textarea', { placeholder: 'Confirmation #, address, links, anything else…' });
  notesIn.value = c.notes || '';

  // City-stay color picker: named-palette chips. Active selection tracked
  // in cityColor so the dynamic re-render preserves it across type switches.
  let cityColor = c.color && CITY_STAY_COLORS[c.color] ? c.color : 'slate';
  function colorPicker() {
    const row = el('div', { class: 'vp-color-picker' });
    Object.keys(CITY_STAY_COLORS).forEach(name => {
      const swatch = CITY_STAY_COLORS[name];
      const chip = el('button', {
        type: 'button',
        class: 'vp-color-chip' + (cityColor === name ? ' vp-color-chip-on' : ''),
        title: name,
        style: { background: swatch.bg, borderColor: swatch.color },
        onclick: () => { cityColor = name; renderDynamic(); }
      });
      row.appendChild(chip);
    });
    return row;
  }

  const dynamic = el('div', {});
  m.appendChild(dynamic);

  // Flight lookup — fills times and airports from a flight number + date.
  const lookupMsg = el('div', { class: 'vp-flight-msg' });
  function setLookupMsg(text, isErr) {
    lookupMsg.textContent = text;
    lookupMsg.classList.toggle('vp-flight-msg-err', !!isErr);
  }
  const lookupBtn = el('button', { type: 'button', class: 'vp-flight-lookup' },
    el('i', { class: 'ti ti-search' }), ' Look up flight times');
  lookupBtn.addEventListener('click', async () => {
    const num = flightNoIn.value.trim();
    if (!num) { setLookupMsg('Enter a flight number first.', true); return; }
    const date = (departIn.value || '').slice(0, 10);
    if (!date) { setLookupMsg('Set the Depart date above first.', true); return; }
    lookupBtn.disabled = true;
    setLookupMsg('Looking up ' + num.toUpperCase() + '…', false);
    try {
      const leg = await lookupFlight(num, date);
      flightNoIn.value = leg.flightNo;
      if (leg.origin.dt) departIn.value = leg.origin.dt;
      if (leg.dest.dt) arriveIn.value = leg.dest.dt;
      originPicker.setValue({
        city: leg.origin.city, timezone: leg.origin.timezone,
        latitude: leg.origin.lat, longitude: leg.origin.lng
      });
      destPicker.setValue({
        city: leg.dest.city, timezone: leg.dest.timezone,
        latitude: leg.dest.lat, longitude: leg.dest.lng
      });
      if (!titleIn.value.trim() && leg.dest.city) titleIn.value = 'Flight to ' + leg.dest.city;
      setLookupMsg((leg.airline ? leg.airline + ' — ' : '') + 'times and airports filled in.', false);
    } catch (e) {
      setLookupMsg(e.message || 'Lookup failed.', true);
    }
    lookupBtn.disabled = false;
  });

  // Pair related fields onto one row to keep the form compact. Each field is a
  // label + input stacked in a column; .vp-field-row lays them side by side and
  // wraps to stacked on narrow screens.
  function field(labelText, node) {
    return el('div', { class: 'vp-field' }, el('label', {}, labelText), node);
  }
  function fieldRow() {
    return el('div', { class: 'vp-field-row' }, ...Array.from(arguments));
  }

  function renderDynamic() {
    dynamic.innerHTML = '';
    loungeContainer = null; // detached on rebuild; re-created below for flights
    const tp = typeSel.value;
    if (tp === 'flight' || tp === 'transit') {
      dynamic.appendChild(fieldRow(
        field('Origin city', originPicker.el),
        field('Destination city', destPicker.el)
      ));
      dynamic.appendChild(field(tp === 'flight' ? 'Flight number' : 'Carrier / reference', flightNoIn));
      dynamic.appendChild(fieldRow(
        field('Depart — local time at origin', departIn),
        field('Arrive — local time at destination', arriveIn)
      ));
      if (tp === 'flight') {
        setLookupMsg('', false);
        dynamic.appendChild(el('div', { class: 'vp-flight-lookup-row' }, lookupBtn, lookupMsg));
      }
      // Lounge access: a live container rebuilt as the cities/type change
      // (refreshLounges reads the picker values, so new cards work too).
      loungeContainer = el('div', { class: 'vp-lounge-container' });
      dynamic.appendChild(loungeContainer);
      refreshLounges();

      // Points payment subsection — collapsible, open when the card already
      // carries a points cost/program. Leaving it blank means cash-only;
      // filling it marks this leg as a points (or mixed) redemption and feeds
      // the Plan tab's running-balance math.
      const ptsSec = collapsible('Points payment (optional)', !!(c.pointsCost || c.pointsProgram));
      ptsSec.body.appendChild(fieldRow(
        field('Points cost', pointsCostIn),
        field('Program', pointsProgramIn)
      ));
      ptsSec.body.appendChild(buildPointsDatalist());
      ptsSec.body.appendChild(pointsHint);
      updatePointsHint();
      dynamic.appendChild(ptsSec.el);
    } else {
      dynamic.appendChild(cityLabel);
      dynamic.appendChild(cityIn);
      if (tp === 'hotel' || tp === 'cityStay') {
        dynamic.appendChild(el('label', {}, 'Nights'));
        dynamic.appendChild(nightsIn);
      } else if (tp === 'activity' || tp === 'meal') {
        dynamic.appendChild(el('label', {}, 'Time'));
        dynamic.appendChild(timeIn);
      }
      if (tp === 'cityStay') {
        dynamic.appendChild(el('label', {}, 'Color'));
        dynamic.appendChild(colorPicker());
      }
    }
  }
  renderDynamic();
  typeSel.addEventListener('change', () => {
    renderDynamic();
    updateBookedVisibility();
    updateCostLabel();
  });

  const attachField = createAttachmentsField(c.attachments);
  const attachSec = collapsible('Attachments', !!(c.attachments && c.attachments.length));
  attachSec.body.appendChild(attachField.el);
  m.appendChild(attachSec.el);

  const costLabel = el('label', {}, 'Cost (USD)');
  m.appendChild(costLabel);
  m.appendChild(costIn);
  // Cost label switches to "Cash cost" for flight/transit, where a separate
  // Points cost field is shown above.
  function updateCostLabel() {
    costLabel.textContent = (typeSel.value === 'flight' || typeSel.value === 'transit')
      ? 'Cash cost (USD)' : 'Cost (USD)';
  }
  updateCostLabel();

  m.appendChild(el('label', {}, 'Notes'));
  m.appendChild(notesIn);

  const bookedRow = el('label', {
    class: 'vp-checkbox-row',
    style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', cursor: 'pointer' }
  });
  const bookedIn = el('input', { type: 'checkbox' });
  if (c.booked) bookedIn.checked = true;
  bookedRow.appendChild(bookedIn);
  bookedRow.appendChild(el('span', { style: { fontSize: '13px', color: 'var(--text)' } }, 'Booked ✓'));
  m.appendChild(bookedRow);
  // City stays aren't "booked" — they describe the trip shape.
  function updateBookedVisibility() {
    bookedRow.style.display = typeSel.value === 'cityStay' ? 'none' : 'flex';
  }
  updateBookedVisibility();

  const actions = el('div', { class: 'vp-modal-actions' });
  const leftBtns = el('div', { style: { display: 'flex', gap: '8px' } });
  if (!isNew) {
    leftBtns.appendChild(el('button', {
      onclick: () => { duplicateCard(id); bg.remove(); }
    }, 'Duplicate'));
    leftBtns.appendChild(el('button', {
      class: 'vp-delete',
      onclick: () => {
        confirmDialog('Delete this card?', { danger: true, confirmText: 'Delete' })
          .then(ok => { if (ok) { removeCard(id); bg.remove(); } });
      }
    }, 'Delete'));
  }
  actions.appendChild(leftBtns);

  const rightBtns = el('div', { class: 'vp-right' });
  rightBtns.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  rightBtns.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      const tp = typeSel.value;
      // City stays default their title to the city name when the user
      // hasn't typed something more specific ("Beach week in Sevilla").
      const cityValue = cityIn.value.trim();
      const titleFallback = tp === 'cityStay' && cityValue ? cityValue : TYPES[tp].label;
      const out = {
        type: tp,
        title: titleIn.value.trim() || titleFallback,
        notes: notesIn.value.trim(),
        booked: tp === 'cityStay' ? false : bookedIn.checked
      };
      if (tp === 'flight' || tp === 'transit') {
        out.flightNo = flightNoIn.value.trim();
        out.depart = departIn.value;
        out.arrive = arriveIn.value;
        const o = originPicker.getValue();
        const d = destPicker.getValue();
        out.originCity = o.name;
        out.originTz = o.timezone;
        out.originLat = o.latitude;
        out.originLng = o.longitude;
        out.destCity = d.name;
        out.destTz = d.timezone;
        out.destLat = d.latitude;
        out.destLng = d.longitude;
        const pc = parseFloat(pointsCostIn.value);
        const pp = pointsProgramIn.value.trim();
        if (pc > 0) out.pointsCost = pc;
        if (pp) out.pointsProgram = pp;
      } else {
        out.city = cityValue;
        if (tp === 'hotel' || tp === 'cityStay') out.nights = parseInt(nightsIn.value) || 1;
        if (tp === 'activity' || tp === 'meal') out.time = timeIn.value;
        if (tp === 'cityStay') out.color = cityColor;
      }

      const att = attachField.getValue();
      if (att.length) out.attachments = att;
      const cost = parseFloat(costIn.value);
      if (cost > 0) out.cost = cost;

      if (isNew) {
        addCard(out, addTarget || { kind: 'lib' });
      } else {
        const card = t.cards[id];
        Object.assign(card, out);
        // clean stale fields that don't apply to the new type
        if (tp === 'flight' || tp === 'transit') {
          delete card.city;
          if (!(out.pointsCost > 0)) delete card.pointsCost;
          if (!out.pointsProgram) delete card.pointsProgram;
        } else {
          ['flightNo', 'depart', 'arrive',
           'originCity', 'originTz', 'originLat', 'originLng',
           'destCity', 'destTz', 'destLat', 'destLng',
           'pointsCost', 'pointsProgram'].forEach(k => delete card[k]);
        }
        if (tp !== 'hotel' && tp !== 'cityStay') delete card.nights;
        if (tp !== 'cityStay') delete card.color;
        if (tp !== 'activity' && tp !== 'meal') delete card.time;
        if (!att.length) delete card.attachments;
        if (!(cost > 0)) delete card.cost;
        save(); render();
      }
      bg.remove();
    }
  }, 'Save'));
  actions.appendChild(rightBtns);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => titleIn.focus(), 30);
}

// Renders the "Lounges you can access" subsection for a flight/transit card.
// Returns null when the user has no cards/status configured, or when neither
// city maps to a curated airport with eligible lounges.
function renderLoungeBlock(card) {
  const profile = getProfile();
  // Keep the editor uncluttered: only surface the lounge subsection when there
  // are actual eligible lounges. The empty/no-profile/not-covered cases stay
  // silent (lounges are discoverable via the About me section).
  if (!hasLoungeProfile(profile)) return null;

  const groups = eligibleLoungesForFlight(card, profile);
  if (!groups.length) return null;

  const block = el('div', { class: 'vp-lounge-block' });
  block.appendChild(el('div', { class: 'vp-editor-section' }, 'Lounges you can access'));
  groups.forEach(g => {
    const head = el('div', { class: 'vp-lounge-head' },
      el('span', { class: 'vp-lounge-iata' }, g.iata),
      el('span', { class: 'vp-lounge-city' },
        (g.side === 'departure' ? 'Departure · ' : 'Arrival · ') + g.city));
    block.appendChild(head);
    g.lounges.forEach(l => {
      const row = el('div', { class: 'vp-lounge-row' });
      row.appendChild(el('div', { class: 'vp-lounge-name' }, l.name));
      if (l.terminal) row.appendChild(el('div', { class: 'vp-lounge-term' }, l.terminal));
      block.appendChild(row);
    });
  });
  return block;
}

// ---- Inline points-coverage advisor ----
const HINT_ICON = { good: 'ti-check', warn: 'ti-alert-triangle', muted: 'ti-info-circle' };

// Compact points formatting: 75000 -> "75k", 1500 -> "1.5k", 800 -> "800".
function fmtK(n) {
  n = Math.round(n);
  if (n >= 1000) {
    const k = n / 1000;
    return (Number.isInteger(k) ? k : k.toFixed(1)) + 'k';
  }
  return n.toLocaleString();
}

// Transfers move in 1,000-point blocks, so round any required amount up.
function roundUp1000(n) { return Math.ceil(n / 1000) * 1000; }

// Instant transfers first when choosing the best source currency.
function speedRank(s) { return /instant/i.test(s || '') ? 0 : 1; }

// Given the points cost and program a leg is paid with, decide whether the
// user can cover it from their saved balances (directly or via a transfer) and
// return { tone, text } for the inline hint, or null when there is nothing
// useful to say. Pure read of getPointsBalances() + the transfers.js graph.
function buildCoverageHint(pointsCostVal, programText) {
  const need = parseFloat(pointsCostVal) || 0;
  const progTxt = (programText || '').trim();
  if (!(need > 0) || !progTxt) return null;

  const balances = getPointsBalances()
    .filter(b => b && b.name && (parseFloat(b.balance) || 0) > 0);
  if (!balances.length) {
    return { tone: 'muted', text: 'Add your points balances on the Plan tab to see whether you can cover this.' };
  }

  const prog = matchProgram(progTxt);
  const progLabel = prog ? prog.name : progTxt;

  // Points already held in the exact program this leg needs.
  let directHave = 0;
  balances.forEach(b => {
    const amt = parseFloat(b.balance) || 0;
    const bp = matchProgram(b.name);
    if (prog && bp && bp.id === prog.id) directHave += amt;
    else if (!prog && b.name.trim().toLowerCase() === progTxt.toLowerCase()) directHave += amt;
  });

  if (directHave >= need) {
    return { tone: 'good', text: `You have enough ${progLabel}: ${fmtK(directHave)} of ${fmtK(need)} needed.` };
  }

  // Off-graph program (e.g. a hotel currency or an unrecognized name): we can
  // compare a directly-held balance but cannot reason about transfers.
  if (!prog) {
    if (directHave > 0) {
      return { tone: 'warn', text: `Short ${fmtK(need - directHave)} ${progLabel} (have ${fmtK(directHave)} of ${fmtK(need)}).` };
    }
    return { tone: 'muted', text: `Transfer options are tracked for airline programs; “${progTxt}” isn’t one I can check.` };
  }

  // Airline program in the graph: find held flexible currencies that transfer
  // into it, and whether one can cover the shortfall.
  const shortfall = need - directHave;
  const held = [];
  balances.forEach(b => {
    const currency = matchCurrency(b.name);
    if (currency) held.push({ balance: parseFloat(b.balance) || 0, currency });
  });
  const options = transfersInto(prog.id, held).map(o => {
    const fromNeeded = roundUp1000(Math.ceil(shortfall / o.ratio));
    return { ...o, fromNeeded, enough: o.balance >= fromNeeded };
  }).sort((a, b) =>
    (b.enough - a.enough) || (speedRank(a.speed) - speedRank(b.speed)) || (a.fromNeeded - b.fromNeeded)
  );

  const head = directHave > 0 ? `Short ${fmtK(shortfall)} ${progLabel}.` : `You don't hold ${progLabel}.`;
  const best = options[0];
  if (!best) {
    return { tone: 'warn', text: `${head} None of your saved balances transfer in.` };
  }
  const speed = best.speed ? `, ${best.speed}` : '';
  if (best.enough) {
    return { tone: 'good', text: `${head} Transfer ${fmtK(best.fromNeeded)} from ${best.currency.name} (${ratioLabel(best.ratio)}${speed}).` };
  }
  return { tone: 'warn', text: `${head} ${best.currency.name} transfers in (${ratioLabel(best.ratio)}${speed}) but won’t fully cover it.` };
}

