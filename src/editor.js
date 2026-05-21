// Card create/edit modal.
import { activeTrip } from './state.js';
import { TYPES, CITY_STAY_COLORS } from './constants.js';
import { getPointsBalances } from './profile.js';
import { el } from './dom.js';
import { addCard, removeCard, duplicateCard } from './cards.js';
import { save } from './storage.js';
import { render } from './render.js';
import { createCityPicker } from './citypicker.js';
import { createAttachmentsField } from './attachments.js';
import { lookupFlight } from './flightlookup.js';
import { confirmDialog } from './dialog.js';

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
    placeholder: 'Search origin city…'
  });
  const destPicker = createCityPicker({
    city: c.destCity, timezone: c.destTz,
    latitude: c.destLat, longitude: c.destLng,
    placeholder: 'Search destination city…'
  });

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

  function renderDynamic() {
    dynamic.innerHTML = '';
    const tp = typeSel.value;
    if (tp === 'flight' || tp === 'transit') {
      dynamic.appendChild(el('label', {}, 'Origin city'));
      dynamic.appendChild(originPicker.el);
      dynamic.appendChild(el('label', {}, 'Destination city'));
      dynamic.appendChild(destPicker.el);
      dynamic.appendChild(el('label', {}, tp === 'flight' ? 'Flight number' : 'Carrier / reference'));
      dynamic.appendChild(flightNoIn);
      dynamic.appendChild(el('label', {}, 'Depart — local time at origin'));
      dynamic.appendChild(departIn);
      dynamic.appendChild(el('label', {}, 'Arrive — local time at destination'));
      dynamic.appendChild(arriveIn);
      if (tp === 'flight') {
        setLookupMsg('', false);
        dynamic.appendChild(el('div', { class: 'vp-flight-lookup-row' }, lookupBtn, lookupMsg));
      }
      // Points payment subsection. Leaving these blank means cash-only;
      // filling them in marks this leg as a points (or mixed) redemption
      // and feeds the Plan tab's running-balance math.
      dynamic.appendChild(el('div', { class: 'vp-editor-section' }, 'Points payment (optional)'));
      dynamic.appendChild(el('label', {}, 'Points cost'));
      dynamic.appendChild(pointsCostIn);
      dynamic.appendChild(el('label', {}, 'Program'));
      dynamic.appendChild(pointsProgramIn);
      dynamic.appendChild(buildPointsDatalist());
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
  m.appendChild(el('label', {}, 'Attachments'));
  m.appendChild(attachField.el);

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
