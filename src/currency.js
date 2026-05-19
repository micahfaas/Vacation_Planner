// Currency converter modal, backed by the free open.er-api.com endpoint
// (no API key; daily rates for ~160 currencies, including PEN and ARS).
import { el } from './dom.js';

let ratesPromise = null;

function loadRates() {
  if (ratesPromise) return ratesPromise;
  ratesPromise = fetch('https://open.er-api.com/v6/latest/USD')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('rates ' + r.status))))
    .then(j => {
      if (j.result !== 'success' || !j.rates) throw new Error('bad rates payload');
      return { rates: j.rates, date: j.time_last_update_utc || '' };
    })
    .catch(e => { ratesPromise = null; throw e; }); // clear so a retry can refetch
  return ratesPromise;
}

// Currencies surfaced at the top of the pickers — the rest follow alphabetically.
const PREFERRED = ['USD', 'PEN', 'ARS', 'EUR', 'GBP', 'BRL', 'CLP', 'MXN', 'COP'];

export function openCurrencyConverter() {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, 'Currency converter'));

  const status = el('div', { class: 'vp-cc-status' }, 'Loading exchange rates…');
  m.appendChild(status);

  const amountIn = el('input', { type: 'number', min: '0', step: 'any', value: '100' });
  const fromSel = el('select', {});
  const toSel = el('select', {});
  const result = el('div', { class: 'vp-cc-result' }, '—');
  const dateNote = el('div', { class: 'vp-cc-date' });
  const swap = el('button', { type: 'button', class: 'vp-cc-swap', title: 'Swap currencies', 'aria-label': 'Swap currencies' },
    el('i', { class: 'ti ti-arrows-exchange', 'aria-hidden': 'true' }));

  m.appendChild(el('label', {}, 'Amount'));
  m.appendChild(amountIn);
  m.appendChild(el('label', {}, 'From / to'));
  m.appendChild(el('div', { class: 'vp-cc-row' }, fromSel, swap, toSel));
  m.appendChild(result);
  m.appendChild(dateNote);

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);

  let rates = null;
  function recompute() {
    if (!rates) return;
    const amt = parseFloat(amountIn.value);
    const f = fromSel.value, tcur = toSel.value;
    if (!(amt >= 0) || !rates[f] || !rates[tcur]) { result.textContent = '—'; return; }
    const converted = amt / rates[f] * rates[tcur];
    const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    result.textContent = fmt(amt) + ' ' + f + '  =  ' + fmt(converted) + ' ' + tcur;
  }

  loadRates().then(({ rates: r, date }) => {
    rates = r;
    status.remove();
    const rest = Object.keys(r).sort().filter(c => !PREFERRED.includes(c));
    PREFERRED.filter(c => r[c]).concat(rest).forEach(c => {
      fromSel.appendChild(el('option', { value: c }, c));
      toSel.appendChild(el('option', { value: c }, c));
    });
    fromSel.value = r.USD ? 'USD' : fromSel.options[0].value;
    toSel.value = r.PEN ? 'PEN' : (toSel.options[1] || toSel.options[0]).value;
    if (date) dateNote.textContent = 'Rates updated ' + date;
    recompute();
  }).catch(() => {
    status.textContent = 'Could not load exchange rates — check your connection.';
    status.classList.add('vp-cc-status-err');
  });

  amountIn.addEventListener('input', recompute);
  fromSel.addEventListener('change', recompute);
  toSel.addEventListener('change', recompute);
  swap.addEventListener('click', () => {
    const a = fromSel.value;
    fromSel.value = toSel.value;
    toSel.value = a;
    recompute();
  });

  setTimeout(() => amountIn.focus(), 30);
}
