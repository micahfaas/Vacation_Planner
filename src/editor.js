// Card create/edit modal.
import { activeTrip } from './state.js';
import { TYPES } from './constants.js';
import { el } from './dom.js';
import { addCard, removeCard, duplicateCard } from './cards.js';
import { save } from './storage.js';
import { render } from './render.js';

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

  const cityIn = el('input', { type: 'text', value: c.city || '', placeholder: 'e.g. Buenos Aires' });
  m.appendChild(el('label', {}, 'City'));
  m.appendChild(cityIn);

  const flightNoIn = el('input', { type: 'text', value: c.flightNo || '', placeholder: 'AA123' });
  const departIn = el('input', { type: 'datetime-local', value: c.depart || '' });
  const arriveIn = el('input', { type: 'datetime-local', value: c.arrive || '' });
  const timeIn = el('input', { type: 'time', value: c.time || '' });
  const nightsIn = el('input', { type: 'number', min: '1', value: c.nights || 1 });
  const notesIn = el('textarea', { placeholder: 'Confirmation #, address, links, anything else…' });
  notesIn.value = c.notes || '';

  const dynamic = el('div', {});
  m.appendChild(dynamic);

  function renderDynamic() {
    dynamic.innerHTML = '';
    const tp = typeSel.value;
    if (tp === 'flight' || tp === 'transit') {
      dynamic.appendChild(el('label', {}, tp === 'flight' ? 'Flight number' : 'Carrier / reference'));
      dynamic.appendChild(flightNoIn);
      dynamic.appendChild(el('label', {}, 'Depart'));
      dynamic.appendChild(departIn);
      dynamic.appendChild(el('label', {}, 'Arrive'));
      dynamic.appendChild(arriveIn);
    } else if (tp === 'hotel') {
      dynamic.appendChild(el('label', {}, 'Nights'));
      dynamic.appendChild(nightsIn);
    } else if (tp === 'activity' || tp === 'meal') {
      dynamic.appendChild(el('label', {}, 'Time'));
      dynamic.appendChild(timeIn);
    }
  }
  renderDynamic();
  typeSel.addEventListener('change', renderDynamic);

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

  const actions = el('div', { class: 'vp-modal-actions' });
  const leftBtns = el('div', { style: { display: 'flex', gap: '8px' } });
  if (!isNew) {
    leftBtns.appendChild(el('button', {
      onclick: () => { duplicateCard(id); bg.remove(); }
    }, 'Duplicate'));
    leftBtns.appendChild(el('button', {
      class: 'vp-delete',
      onclick: () => { if (confirm('Delete this card?')) { removeCard(id); bg.remove(); } }
    }, 'Delete'));
  }
  actions.appendChild(leftBtns);

  const rightBtns = el('div', { class: 'vp-right' });
  rightBtns.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  rightBtns.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      const out = {
        type: typeSel.value,
        title: titleIn.value.trim() || TYPES[typeSel.value].label,
        city: cityIn.value.trim(),
        notes: notesIn.value.trim(),
        booked: bookedIn.checked
      };
      const tp = typeSel.value;
      if (tp === 'flight' || tp === 'transit') {
        out.flightNo = flightNoIn.value.trim();
        out.depart = departIn.value;
        out.arrive = arriveIn.value;
      }
      if (tp === 'hotel') out.nights = parseInt(nightsIn.value) || 1;
      if (tp === 'activity' || tp === 'meal') out.time = timeIn.value;

      if (isNew) {
        addCard(out, addTarget || { kind: 'lib' });
      } else {
        Object.assign(t.cards[id], out);
        // clean stale fields that don't apply to new type
        if (out.type !== 'flight' && out.type !== 'transit') {
          delete t.cards[id].flightNo;
          delete t.cards[id].depart;
          delete t.cards[id].arrive;
        }
        if (out.type !== 'hotel') delete t.cards[id].nights;
        if (out.type !== 'activity' && out.type !== 'meal') delete t.cards[id].time;
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
