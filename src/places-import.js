// Bulk-import Places from pasted text. The user pastes their research
// (often from a Claude chat — "here are 10 cafés in Buenos Aires…"), the
// parse-places Edge Function turns it into structured Place entries, a
// review screen lets them pick which to keep, and each kept place is
// geocoded via OpenStreetMap so it lands on the Places map.
import { el } from './dom.js';
import { supabase } from './supabase.js';
import { PLACE_CATEGORIES } from './constants.js';
import { addPlace } from './places.js';
import { geocodePlace } from './geocoding.js';
import { alertDialog } from './dialog.js';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Strip postal codes from an address — Nominatim chokes on country-specific
// codes ("Lima 15063", "C1043ABO") that often don't match its own indices.
function withoutPostalCodes(addr) {
  return (addr || '')
    .replace(/\s+\d{4,7}(?=,|\s|$)/g, '')
    .replace(/(?:^|,\s*)[A-Z]\d{3,5}[A-Z]*\s+/g, m => m.startsWith(',') ? ', ' : '');
}

// Try a few query shapes against Nominatim until one returns coordinates.
// Order: full (name + address) → address only → address minus postal codes.
// Pauses between attempts to respect Nominatim's 1 req/sec policy.
export async function tryGeocode(name, address) {
  const tries = [];
  if (name && address) tries.push(name + ', ' + address);
  if (address) tries.push(address);
  const noZip = withoutPostalCodes(address);
  if (noZip && noZip !== address) tries.push(noZip);
  if (name && noZip) tries.push(name + ', ' + noZip);

  for (let i = 0; i < tries.length; i++) {
    const coords = await geocodePlace(tries[i]);
    if (coords) return coords;
    if (i < tries.length - 1) await sleep(1100);
  }
  return null;
}

export function openPlacesImport() {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  bg.appendChild(m);
  document.body.appendChild(bg);
  const close = () => bg.remove();

  function setBody(...nodes) {
    m.innerHTML = '';
    nodes.flat().forEach(n => { if (n) m.appendChild(n); });
  }

  function showPaste(initial) {
    const ta = el('textarea', {
      class: 'vp-imp-textarea',
      placeholder: 'Paste your place research — a list of restaurants, cafés, attractions… even messy notes from a chat.'
    });
    if (initial) ta.value = initial;
    const actions = el('div', { class: 'vp-modal-actions' });
    actions.appendChild(el('div', {}));
    const right = el('div', { class: 'vp-right' });
    right.appendChild(el('button', { onclick: close }, 'Cancel'));
    right.appendChild(el('button', {
      class: 'vp-save',
      onclick: () => { const t = ta.value.trim(); if (t) find(t); }
    }, 'Find places'));
    actions.appendChild(right);
    setBody(el('h3', {}, 'Import places'), ta, actions);
    setTimeout(() => ta.focus(), 30);
  }

  async function find(text) {
    setBody(el('h3', {}, 'Import places'),
      el('div', { class: 'vp-imp-status' }, 'Reading your research…'));
    let res;
    try {
      res = await supabase.functions.invoke('parse-places', { body: { text } });
    } catch {
      showMessage(text, 'The import service is unavailable. Try again later.');
      return;
    }
    if (res.error) {
      showMessage(text, 'The import service is unavailable. Try again later.');
      return;
    }
    const data = res.data;
    if (!data || data.ok !== true) {
      showMessage(text, (data && data.error) || 'The AI could not read that text.');
      return;
    }
    const places = (Array.isArray(data.places) ? data.places : [])
      .filter(p => p && typeof p === 'object' && p.name)
      .map(p => ({
        name: String(p.name).trim(),
        category: PLACE_CATEGORIES[p.category] ? p.category : 'other',
        address: String(p.address || '').trim(),
        notes: String(p.notes || '').trim(),
        include: true
      }));
    if (!places.length) {
      showMessage(text, 'No places found in that text. Try pasting a clearer list.');
      return;
    }
    review(places, text);
  }

  function review(places, text) {
    const commitBtn = el('button', { class: 'vp-save' });
    function updateCount() {
      const n = places.filter(p => p.include).length;
      commitBtn.textContent = n ? 'Add ' + n + (n === 1 ? ' place' : ' places') : 'Nothing selected';
      commitBtn.disabled = !n;
    }

    const list = el('div', { class: 'vp-imp-review' });
    places.forEach(p => {
      const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.other;
      const cb = el('input', { type: 'checkbox' });
      cb.checked = true;
      cb.addEventListener('change', () => { p.include = cb.checked; updateCount(); });
      const labelText = p.name + (p.address ? ' — ' + p.address : '');
      list.appendChild(el('label', { class: 'vp-imp-item' },
        cb,
        el('i', { class: 'ti ' + cat.icon }),
        el('span', { class: 'vp-imp-item-label', title: labelText }, labelText)));
    });
    commitBtn.addEventListener('click', () => commit(places));

    const actions = el('div', { class: 'vp-modal-actions' });
    actions.appendChild(el('div', {}));
    const right = el('div', { class: 'vp-right' });
    right.appendChild(el('button', { onclick: () => showPaste(text) }, 'Back'));
    right.appendChild(commitBtn);
    actions.appendChild(right);

    setBody(
      el('h3', {}, 'Review — ' + places.length + (places.length === 1 ? ' place' : ' places') + ' found'),
      el('p', { class: 'vp-imp-msg' },
        'Places go to your research library. Addresses are looked up on the map where possible.'),
      list,
      actions
    );
    updateCount();
  }

  async function commit(places) {
    const chosen = places.filter(p => p.include);
    const status = el('div', { class: 'vp-imp-status' });
    setBody(el('h3', {}, 'Import places'), status);

    let pinned = 0;
    for (let i = 0; i < chosen.length; i++) {
      const p = chosen[i];
      status.textContent = `Adding places — ${i + 1} of ${chosen.length}…`;
      const coords = await tryGeocode(p.name, p.address);
      const place = {
        name: p.name,
        category: p.category,
        address: p.address,
        notes: p.notes,
      };
      if (coords) {
        place.lat = coords.lat;
        place.lng = coords.lng;
        pinned++;
      }
      addPlace(place);
      // Nominatim's usage policy asks for ≤1 request per second — space them out.
      if (i < chosen.length - 1) await sleep(1100);
    }

    close();
    const total = chosen.length;
    const noun = total === 1 ? ' place was' : ' places were';
    const tail = pinned === total
      ? ' all pinned on the map.'
      : pinned === 0
        ? ' added (no addresses could be located — they have no map pin yet).'
        : ` added (${pinned} pinned on the map; the rest had no locatable address).`;
    alertDialog(total + noun + tail);
  }

  function showMessage(text, msg) {
    const actions = el('div', { class: 'vp-modal-actions' });
    actions.appendChild(el('div', {}));
    const right = el('div', { class: 'vp-right' });
    right.appendChild(el('button', { onclick: () => showPaste(text) }, 'Back'));
    right.appendChild(el('button', { onclick: close }, 'Close'));
    actions.appendChild(right);
    setBody(el('h3', {}, 'Import places'), el('p', { class: 'vp-imp-msg' }, msg), actions);
  }

  showPaste();
}
