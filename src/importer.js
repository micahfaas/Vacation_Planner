// Import bookings into the current trip: paste text or upload a file,
// review what was detected, then add the chosen items as cards.
import { el } from './dom.js';
import { activeTrip } from './state.js';
import { addCard } from './cards.js';
import { save } from './storage.js';
import { render } from './render.js';
import { TYPES } from './constants.js';
import { isoDate, parseISO, addDays, fmtShort } from './dates.js';
import { importJSON } from './io.js';
import { parseText, parseICS, parsePkpass } from './import-formats.js';
import { alertDialog } from './dialog.js';

export function openImportModal() {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-imp' });
  bg.appendChild(m);
  document.body.appendChild(bg);
  const close = () => bg.remove();

  function setBody(...nodes) {
    m.innerHTML = '';
    nodes.flat().forEach(n => { if (n) m.appendChild(n); });
  }

  function actions(btns) {
    const row = el('div', { class: 'vp-modal-actions' });
    row.appendChild(el('div', {}));
    const right = el('div', { class: 'vp-right' });
    btns.forEach(b => right.appendChild(b));
    row.appendChild(right);
    return row;
  }
  const cancelBtn = () => el('button', { onclick: close }, 'Cancel');
  const backBtn = () => el('button', { onclick: showPicker }, 'Back');

  // ---------- step: choose a method ----------
  function showPicker() {
    const method = (icon, title, desc, go) =>
      el('button', { type: 'button', class: 'vp-imp-method', onclick: go },
        el('i', { class: 'ti ' + icon, 'aria-hidden': 'true' }),
        el('div', { class: 'vp-imp-method-text' },
          el('div', { class: 'vp-imp-method-title' }, title),
          el('div', { class: 'vp-imp-method-desc' }, desc)));
    const list = el('div', { class: 'vp-imp-methods' },
      method('ti-clipboard-text', 'Paste text',
        'A confirmation email or itinerary — anything', showPaste),
      method('ti-file-upload', 'Upload a file',
        'Calendar invite (.ics), Wallet pass (.pkpass), or a trip backup (.json)',
        () => pickFile('.ics,.pkpass,.json,text/calendar,application/json')));
    setBody(el('h3', {}, 'Import into this trip'), list, actions([cancelBtn()]));
  }

  // ---------- step: paste ----------
  function showPaste() {
    const ta = el('textarea', {
      class: 'vp-imp-textarea',
      placeholder: 'Paste a confirmation email, an itinerary, flight details…'
    });
    setBody(
      el('h3', {}, 'Paste text'),
      ta,
      actions([
        backBtn(),
        el('button', {
          class: 'vp-save',
          onclick: () => { const text = ta.value.trim(); if (text) review(parseText(text)); }
        }, 'Find bookings')
      ])
    );
    setTimeout(() => ta.focus(), 30);
  }

  // ---------- file routing ----------
  function pickFile(accept) {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { if (input.files[0]) routeFile(input.files[0]); });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 0);
  }

  async function routeFile(file) {
    const name = (file.name || '').toLowerCase();
    try {
      if (name.endsWith('.json') || file.type === 'application/json') {
        importJSON(file);
        close();
        return;
      }
      if (name.endsWith('.ics') || file.type === 'text/calendar') {
        review(parseICS(await file.text()));
        return;
      }
      if (name.endsWith('.pkpass') || file.type === 'application/vnd.apple.pkpass') {
        review(parsePkpass(await file.arrayBuffer()));
        return;
      }
      showMessage('That file type is not supported yet.');
    } catch (e) {
      showMessage('Could not read that file: ' + (e.message || e));
    }
  }

  // ---------- step: review ----------
  function review(cands) {
    if (!cands || !cands.length) {
      showMessage('No bookings found there. Try pasting the text, or add a card manually.');
      return;
    }
    const list = el('div', { class: 'vp-imp-review' });
    cands.forEach(c => {
      const tp = TYPES[c.type] || TYPES.note;
      const cb = el('input', { type: 'checkbox' });
      cb.checked = c.include !== false;
      cb.addEventListener('change', () => { c.include = cb.checked; updateCount(); });
      const target = c.date
        ? el('span', { class: 'vp-imp-target' }, fmtShort(parseISO(c.date)))
        : el('span', { class: 'vp-imp-target vp-imp-target-lib' }, 'Library');
      list.appendChild(el('label', { class: 'vp-imp-item' },
        cb,
        el('i', { class: 'ti ' + tp.icon, style: { color: tp.color } }),
        el('span', { class: 'vp-imp-item-label' }, c.label || tp.label),
        target));
    });

    const commitBtn = el('button', { class: 'vp-save', onclick: () => commit(cands) });
    function updateCount() {
      const n = cands.filter(c => c.include !== false).length;
      commitBtn.textContent = n ? 'Add ' + n + (n === 1 ? ' item' : ' items') : 'Nothing selected';
      commitBtn.disabled = !n;
    }

    setBody(
      el('h3', {}, 'Review — ' + cands.length + (cands.length === 1 ? ' item' : ' items') + ' found'),
      el('p', { class: 'vp-imp-msg' }, 'Dated items go on the calendar; the rest go to your card library.'),
      list,
      actions([backBtn(), commitBtn])
    );
    updateCount();
  }

  function commit(cands) {
    const t = activeTrip();
    let count = 0, minD = null, maxD = null;
    cands.forEach(c => {
      if (c.include === false) return;
      if (c.date) {
        addCard(c.card, { kind: 'day', date: c.date });
        if (!minD || c.date < minD) minD = c.date;
        let end = c.date;
        if (c.type === 'hotel') {
          end = isoDate(addDays(parseISO(c.date), parseInt(c.card.nights, 10) || 1));
        }
        if (!maxD || end > maxD) maxD = end;
      } else {
        addCard(c.card, { kind: 'lib' });
      }
      count++;
    });
    if (minD && (!t.startDate || minD < t.startDate)) t.startDate = minD;
    if (maxD && (!t.endDate || maxD > t.endDate)) t.endDate = maxD;
    save();
    render();
    close();
    alertDialog(count + (count === 1 ? ' item was' : ' items were') + ' added to your trip.');
  }

  function showMessage(msg) {
    setBody(
      el('h3', {}, 'Import'),
      el('p', { class: 'vp-imp-msg' }, msg),
      actions([backBtn(), el('button', { onclick: close }, 'Close')])
    );
  }

  showPicker();
}
