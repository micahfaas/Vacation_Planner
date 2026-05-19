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
import { parseText, parseICS, parsePkpass, parseBCBP, parseGCalEvents } from './import-formats.js';
import { parseWithAI } from './import-ai.js';
import { gcalEnabled, connectGoogleCalendar, preloadGIS } from './gcal.js';
import { alertDialog } from './dialog.js';

export function openImportModal(opts = {}) {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-imp' });
  bg.appendChild(m);
  document.body.appendChild(bg);
  const close = () => bg.remove();
  if (gcalEnabled()) preloadGIS();

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
    const list = el('div', { class: 'vp-imp-methods' });
    list.appendChild(method('ti-clipboard-text', 'Paste text',
      'A confirmation email or itinerary — anything', () => showPaste()));
    if (gcalEnabled()) {
      list.appendChild(method('ti-calendar', 'Connect Google Calendar',
        'Pull in flights and hotels your calendar already has', connectCalendar));
    }
    list.appendChild(method('ti-file-upload', 'Upload a file',
      'PDF e-ticket, a screenshot, calendar invite (.ics), Wallet pass (.pkpass), or trip backup',
      () => pickFile('.pdf,.ics,.pkpass,.json,image/*,application/pdf,text/calendar,application/json')));
    list.appendChild(method('ti-barcode', 'Scan a boarding pass',
      'A photo of the barcode on a boarding pass', pickBarcode));
    setBody(el('h3', {}, 'Import into this trip'), list, actions([cancelBtn()]));
  }

  async function connectCalendar() {
    showStatus('Opening Google sign-in…');
    try {
      const events = await connectGoogleCalendar();
      review(parseGCalEvents(events), {
        emptyMsg: 'No flights or hotels found in your Google Calendar for the year ahead.',
        dateScope: true
      });
    } catch (e) {
      showMessage(e.message || 'Could not connect to Google Calendar.');
    }
  }

  // ---------- step: paste ----------
  function showPaste(initial) {
    const ta = el('textarea', {
      class: 'vp-imp-textarea',
      placeholder: 'Paste a confirmation email, an itinerary, flight details…'
    });
    if (initial) ta.value = initial;
    setBody(
      el('h3', {}, 'Paste text'),
      ta,
      actions([
        backBtn(),
        el('button', {
          class: 'vp-save',
          onclick: () => { const text = ta.value.trim(); if (text) reviewSmart(text); }
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
      if (name.endsWith('.pdf') || file.type === 'application/pdf') {
        showStatus('Reading the PDF…');
        const { extractPdfText } = await import('./import-pdf.js');
        await reviewSmart(await extractPdfText(await file.arrayBuffer()));
        return;
      }
      if (file.type.startsWith('image/')) {
        showStatus('Reading the image — OCR can take a moment…');
        const { ocrImage } = await import('./import-ocr.js');
        await reviewSmart(await ocrImage(file));
        return;
      }
      showMessage('That file type is not supported yet.');
    } catch (e) {
      showMessage('Could not read that file: ' + (e.message || e));
    }
  }

  // ---------- step: review ----------
  // opts: { emptyMsg, dateScope }. dateScope adds a From/To filter (used by
  // the calendar import) so a long event list narrows to the trip window.
  function review(cands, opts = {}) {
    if (!cands || !cands.length) {
      showMessage(opts.emptyMsg || 'No bookings found there. Try pasting the text, or add a card manually.');
      return;
    }
    const scope = { from: '', to: '' };
    if (opts.dateScope) {
      const t = activeTrip();
      scope.from = t.startDate || '';
      scope.to = t.endDate || '';
    }
    const inScope = c => {
      if (!opts.dateScope || !c.date) return true;
      if (scope.from && c.date < scope.from) return false;
      if (scope.to && c.date > scope.to) return false;
      return true;
    };

    const list = el('div', { class: 'vp-imp-review' });
    const commitBtn = el('button', { class: 'vp-save' });

    function updateCount() {
      const n = cands.filter(c => c.include !== false && inScope(c)).length;
      commitBtn.textContent = n ? 'Add ' + n + (n === 1 ? ' item' : ' items') : 'Nothing selected';
      commitBtn.disabled = !n;
    }

    function renderList() {
      list.innerHTML = '';
      const visible = cands.filter(inScope);
      if (!visible.length) {
        list.appendChild(el('div', { class: 'vp-imp-status' }, 'No travel events in this date range.'));
      }
      visible.forEach(c => {
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
      updateCount();
    }

    commitBtn.addEventListener('click', () => {
      const t = activeTrip();
      let count = 0, minD = null, maxD = null;
      cands.forEach(c => {
        if (c.include === false || !inScope(c)) return;
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
    });

    const header = [el('h3', {}, 'Review — ' + cands.length +
      (cands.length === 1 ? ' item' : ' items') + ' found')];
    if (opts.dateScope) {
      const fromIn = el('input', { type: 'date', value: scope.from });
      const toIn = el('input', { type: 'date', value: scope.to });
      fromIn.addEventListener('change', () => { scope.from = fromIn.value; renderList(); });
      toIn.addEventListener('change', () => { scope.to = toIn.value; renderList(); });
      header.push(el('p', { class: 'vp-imp-msg' },
        'Only travel events are shown. Narrow the dates to this trip, or widen them to catch more.'));
      header.push(el('div', { class: 'vp-imp-scope' },
        el('span', {}, 'Dates'), fromIn, el('span', {}, 'to'), toIn));
    } else {
      header.push(el('p', { class: 'vp-imp-msg' },
        'Dated items go on the calendar; the rest go to your card library.'));
    }
    setBody(header, list, actions([backBtn(), commitBtn]));
    renderList();
  }

  function showMessage(msg) {
    setBody(
      el('h3', {}, 'Import'),
      el('p', { class: 'vp-imp-msg' }, msg),
      actions([backBtn(), el('button', { onclick: close }, 'Close')])
    );
  }

  function showStatus(msg) {
    setBody(el('h3', {}, 'Import'), el('div', { class: 'vp-imp-status' }, msg));
  }

  // Parse free text with the AI parser, falling back to the rule-based
  // parser when the AI is unavailable or finds nothing.
  async function reviewSmart(text) {
    showStatus('Reading your text with AI…');
    try {
      const cands = await parseWithAI(text);
      if (cands.length) { review(cands); return; }
    } catch { /* fall back to the rule-based parser below */ }
    review(parseText(text));
  }

  // ---------- boarding-pass barcode photo ----------
  function pickBarcode() {
    const input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      showStatus('Reading the barcode…');
      try {
        const { decodeBarcode } = await import('./import-barcode.js');
        const text = await decodeBarcode(f);
        const cand = parseBCBP(text);
        review(cand ? [cand] : parseText(text));
      } catch {
        showMessage('Could not read a barcode there. Try a clearer, straight-on photo of just ' +
          'the barcode — or upload the Wallet pass (.pkpass) instead.');
      }
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 0);
  }

  if (opts && opts.text) showPaste(opts.text);
  else showPicker();
}
