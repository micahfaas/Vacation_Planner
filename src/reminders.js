// Reminders view: a to-do list with due dates, plus a packing checklist.
// Both lists live in the trip document and sync like everything else.
import { activeTrip } from './state.js';
import { el } from './dom.js';
import { save } from './storage.js';
import { render } from './render.js';
import { isoDate } from './dates.js';

function reminders() {
  const t = activeTrip();
  if (!t.reminders) t.reminders = [];
  return t.reminders;
}
function packing() {
  const t = activeTrip();
  if (!t.packing) t.packing = [];
  return t.packing;
}

// ---------- reminder ops ----------
function addReminder() {
  const id = crypto.randomUUID();
  reminders().push({ id, text: '', dueDate: '', done: false });
  save(); render();
  setTimeout(() => {
    const inp = document.querySelector(`[data-rem-id="${id}"] .vp-rem-text`);
    if (inp) inp.focus();
  }, 30);
}
function patchReminder(id, patch, doRender) {
  const r = reminders().find(x => x.id === id);
  if (r) { Object.assign(r, patch); save(); if (doRender) render(); }
}
function removeReminder(id) {
  const t = activeTrip();
  t.reminders = reminders().filter(x => x.id !== id);
  save(); render();
}

// ---------- packing ops ----------
function addPackingItem() {
  const id = crypto.randomUUID();
  packing().push({ id, text: '', packed: false });
  save(); render();
  setTimeout(() => {
    const inp = document.querySelector(`[data-pack-id="${id}"] .vp-pack-text`);
    if (inp) inp.focus();
  }, 30);
}
function patchPackingItem(id, patch, doRender) {
  const it = packing().find(x => x.id === id);
  if (it) { Object.assign(it, patch); save(); if (doRender) render(); }
}
function removePackingItem(id) {
  const t = activeTrip();
  t.packing = packing().filter(x => x.id !== id);
  save(); render();
}

// Open reminders first, then by due date (undated last), done items last.
function cmpReminder(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  const ad = a.dueDate || '9999-12-31';
  const bd = b.dueDate || '9999-12-31';
  return ad < bd ? -1 : ad > bd ? 1 : 0;
}

// ---------- rendering ----------
function renderReminderRow(r, todayISO) {
  const overdue = !r.done && r.dueDate && r.dueDate < todayISO;
  const dueToday = !r.done && r.dueDate && r.dueDate === todayISO;
  const row = el('div', {
    class: 'vp-rem' + (r.done ? ' vp-rem-done' : '') + (overdue ? ' vp-rem-overdue' : ''),
    'data-rem-id': r.id
  });

  const check = el('input', { type: 'checkbox', class: 'vp-rem-check' });
  if (r.done) check.checked = true;
  check.addEventListener('change', () => patchReminder(r.id, { done: check.checked }, true));
  row.appendChild(check);

  const text = el('input', {
    type: 'text', class: 'vp-rem-text', value: r.text || '',
    placeholder: 'e.g. Book hotel for Lima'
  });
  text.addEventListener('change', () => patchReminder(r.id, { text: text.value.trim() }, false));
  text.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      patchReminder(r.id, { text: text.value.trim() }, false);
      addReminder();
    }
  });
  row.appendChild(text);

  if (overdue || dueToday) {
    row.appendChild(el('span', { class: 'vp-rem-flag' }, overdue ? 'overdue' : 'today'));
  }

  const date = el('input', { type: 'date', class: 'vp-rem-date', value: r.dueDate || '' });
  date.addEventListener('change', () => patchReminder(r.id, { dueDate: date.value }, true));
  row.appendChild(date);

  row.appendChild(el('button', {
    type: 'button', class: 'vp-rem-rm', title: 'Delete',
    onclick: () => removeReminder(r.id)
  }, '×'));
  return row;
}

function renderPackingRow(it) {
  const row = el('div', {
    class: 'vp-pack' + (it.packed ? ' vp-pack-done' : ''),
    'data-pack-id': it.id
  });

  const check = el('input', { type: 'checkbox', class: 'vp-pack-check' });
  if (it.packed) check.checked = true;
  check.addEventListener('change', () => patchPackingItem(it.id, { packed: check.checked }, true));
  row.appendChild(check);

  const text = el('input', {
    type: 'text', class: 'vp-pack-text', value: it.text || '',
    placeholder: 'e.g. Passport'
  });
  text.addEventListener('change', () => patchPackingItem(it.id, { text: text.value.trim() }, false));
  text.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      patchPackingItem(it.id, { text: text.value.trim() }, false);
      addPackingItem();
    }
  });
  row.appendChild(text);

  row.appendChild(el('button', {
    type: 'button', class: 'vp-pack-rm', title: 'Delete',
    onclick: () => removePackingItem(it.id)
  }, '×'));
  return row;
}

// Built by render() when the Reminders view is active.
export function renderRemindersView() {
  const panel = el('div', { class: 'vp-places' });
  const todayISO = isoDate(new Date());

  // --- reminders ---
  const head = el('div', { class: 'vp-places-head' });
  head.appendChild(el('h3', {}, 'Reminders'));
  head.appendChild(el('button', { class: 'vp-btn-primary', onclick: addReminder }, '+ add reminder'));
  panel.appendChild(head);

  const rem = reminders();
  if (!rem.length) {
    panel.appendChild(el('div', { class: 'vp-places-empty' },
      'No reminders yet. Add things to do before the trip — book a hotel, make a reservation.'));
  } else {
    const list = el('div', { class: 'vp-rem-list' });
    rem.slice().sort(cmpReminder).forEach(r => list.appendChild(renderReminderRow(r, todayISO)));
    panel.appendChild(list);
    const open = rem.filter(r => !r.done).length;
    panel.appendChild(el('div', { class: 'vp-list-count' },
      open ? open + (open === 1 ? ' reminder left' : ' reminders left') : 'All reminders done ✓'));
  }

  // --- packing list ---
  const phead = el('div', { class: 'vp-places-head', style: { marginTop: '24px' } });
  phead.appendChild(el('h3', {}, 'Packing list'));
  phead.appendChild(el('button', { class: 'vp-btn-primary', onclick: addPackingItem }, '+ add item'));
  panel.appendChild(phead);

  const pack = packing();
  if (!pack.length) {
    panel.appendChild(el('div', { class: 'vp-places-empty' },
      'Nothing on the packing list yet. Add what you need to bring.'));
  } else {
    const list = el('div', { class: 'vp-rem-list' });
    pack.forEach(it => list.appendChild(renderPackingRow(it)));
    panel.appendChild(list);
    const packed = pack.filter(it => it.packed).length;
    panel.appendChild(el('div', { class: 'vp-list-count' }, packed + ' / ' + pack.length + ' packed'));
  }

  return panel;
}
