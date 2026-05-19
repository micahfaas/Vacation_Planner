// Research / places library + an OpenStreetMap map of saved places.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { activeTrip, ui } from './state.js';
import { el } from './dom.js';
import { save } from './storage.js';
import { render } from './render.js';
import { PLACE_CATEGORIES } from './constants.js';
import { addCard } from './cards.js';
import { weatherSummary } from './weather.js';

// category -> card type, for turning a researched place into a trip card
const CAT_TO_TYPE = {
  restaurant: 'meal', cafe: 'meal', bar: 'meal', cocktail: 'meal',
  attraction: 'activity', shop: 'activity', other: 'activity',
  lodging: 'hotel', staying: 'hotel', blog: 'note'
};

function normalizeUrl(u) {
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

function isShortMapsUrl(u) {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(u || '');
}

// Pull a place name and coordinates out of a full Google Maps URL.
function parseMapsUrl(u) {
  const out = {};
  let m = (u || '').match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (!m) m = (u || '').match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) { out.lat = parseFloat(m[1]); out.lng = parseFloat(m[2]); }
  const nm = (u || '').match(/\/maps\/place\/([^/@]+)/);
  if (nm) {
    try { out.name = decodeURIComponent(nm[1].replace(/\+/g, ' ')); }
    catch { out.name = nm[1].replace(/\+/g, ' '); }
  }
  return out;
}

// Google Maps directions deep-link to a place.
function navUrl(p) {
  const dest = (typeof p.lat === 'number' && typeof p.lng === 'number')
    ? p.lat + ',' + p.lng
    : (p.address || p.name || '');
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest);
}

function addPlace(place) {
  const t = activeTrip();
  if (!t.places) t.places = [];
  t.places.push(Object.assign({ id: crypto.randomUUID(), category: 'other', name: 'New place' }, place));
  save(); render();
}

function updatePlace(id, patch) {
  const t = activeTrip();
  const p = (t.places || []).find(x => x.id === id);
  if (p) { Object.assign(p, patch); save(); render(); }
}

function removePlace(id) {
  const t = activeTrip();
  t.places = (t.places || []).filter(x => x.id !== id);
  save(); render();
}

// Turn a place into a library card and switch to the calendar to see it.
function makeCardFromPlace(p) {
  const type = CAT_TO_TYPE[p.category] || 'activity';
  const card = {
    type,
    title: p.name || 'Place',
    notes: [p.notes, p.address, p.url, p.website].filter(Boolean).join('\n')
  };
  if (type === 'hotel') card.nights = 1;
  if (type !== 'flight' && type !== 'transit') card.city = '';
  ui.view = 'calendar';
  addCard(card, { kind: 'lib' }); // addCard saves + renders
}

function openPlaceEditor(id) {
  const t = activeTrip();
  const isNew = !id;
  const p = isNew ? { category: 'restaurant' } : Object.assign({}, (t.places || []).find(x => x.id === id));

  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, isNew ? 'New place' : 'Edit place'));

  const nameIn = el('input', { type: 'text', value: p.name || '', placeholder: 'e.g. Café Tortoni' });
  const catSel = el('select', {});
  Object.entries(PLACE_CATEGORIES).forEach(([k, v]) => {
    const opt = el('option', { value: k }, v.label);
    if (p.category === k) opt.selected = true;
    catSel.appendChild(opt);
  });
  const urlIn = el('input', { type: 'text', value: p.url || '', placeholder: 'Paste a Google Maps link, review, or blog URL' });
  const siteIn = el('input', { type: 'text', value: p.website || '', placeholder: 'Official website (optional)' });
  const addrIn = el('input', { type: 'text', value: p.address || '', placeholder: 'Address (optional)' });
  const notesIn = el('textarea', { placeholder: 'Why you saved it, hours, what to order…' });
  notesIn.value = p.notes || '';

  // Coordinates come from pasting a full Google Maps link into the Link field.
  const coords = {
    lat: typeof p.lat === 'number' ? p.lat : null,
    lng: typeof p.lng === 'number' ? p.lng : null
  };
  const locCaption = el('div', { class: 'vp-place-loc' });
  function updateLocCaption() {
    locCaption.classList.remove('vp-place-loc-warn');
    if (coords.lat != null && coords.lng != null) {
      locCaption.textContent = `Pinned at ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} — shows on the map.`;
    } else if (isShortMapsUrl(urlIn.value)) {
      locCaption.textContent = 'Shortened link — open it in a browser and paste the full URL to pin this place.';
      locCaption.classList.add('vp-place-loc-warn');
    } else {
      locCaption.textContent = 'Tip: paste a Google Maps link to pin this place on the map.';
    }
  }
  urlIn.addEventListener('input', () => {
    const parsed = parseMapsUrl(urlIn.value);
    if (parsed.lat != null && parsed.lng != null) {
      coords.lat = parsed.lat;
      coords.lng = parsed.lng;
    }
    if (parsed.name && !nameIn.value.trim()) nameIn.value = parsed.name;
    updateLocCaption();
  });
  updateLocCaption();

  m.appendChild(el('label', {}, 'Name'));
  m.appendChild(nameIn);
  m.appendChild(el('label', {}, 'Category'));
  m.appendChild(catSel);
  m.appendChild(el('label', {}, 'Link'));
  m.appendChild(urlIn);
  m.appendChild(locCaption);
  m.appendChild(el('label', {}, 'Website'));
  m.appendChild(siteIn);
  m.appendChild(el('label', {}, 'Address'));
  m.appendChild(addrIn);
  m.appendChild(el('label', {}, 'Notes'));
  m.appendChild(notesIn);

  const actions = el('div', { class: 'vp-modal-actions' });
  const leftBtns = el('div', { style: { display: 'flex', gap: '8px' } });
  if (!isNew) {
    leftBtns.appendChild(el('button', {
      class: 'vp-delete',
      onclick: () => { if (confirm('Delete this place?')) { removePlace(id); bg.remove(); } }
    }, 'Delete'));
  }
  actions.appendChild(leftBtns);

  const rightBtns = el('div', { class: 'vp-right' });
  rightBtns.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  rightBtns.appendChild(el('button', {
    class: 'vp-save',
    onclick: () => {
      const out = {
        name: nameIn.value.trim() || 'Untitled place',
        category: catSel.value,
        url: urlIn.value.trim(),
        website: siteIn.value.trim(),
        address: addrIn.value.trim(),
        notes: notesIn.value.trim()
      };
      if (coords.lat != null && coords.lng != null) {
        out.lat = coords.lat;
        out.lng = coords.lng;
      }
      if (isNew) addPlace(out);
      else updatePlace(id, out);
      bg.remove();
    }
  }, 'Save'));
  actions.appendChild(rightBtns);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => nameIn.focus(), 30);
}

function renderPlaceCard(p) {
  const cat = PLACE_CATEGORIES[p.category] || PLACE_CATEGORIES.other;
  const card = el('div', {
    class: 'vp-place' + (p.category === 'staying' ? ' vp-place-staying' : ''),
    onclick: e => {
      if (e.target.closest('.vp-place-actions') || e.target.closest('a')) return;
      openPlaceEditor(p.id);
    }
  });

  const top = el('div', { class: 'vp-place-top' });
  top.appendChild(el('i', { class: 'ti ' + cat.icon + ' vp-place-icon' }));
  top.appendChild(el('div', { class: 'vp-place-name' }, p.name || 'Untitled place'));
  card.appendChild(top);

  card.appendChild(el('div', { class: 'vp-place-cat' }, cat.label));
  if (p.address) card.appendChild(el('div', { class: 'vp-place-addr' }, p.address));

  const links = el('div', { class: 'vp-place-links' });
  if (p.url) links.appendChild(el('a',
    { href: normalizeUrl(p.url), target: '_blank', rel: 'noopener', class: 'vp-place-link' },
    el('i', { class: 'ti ti-link' }), 'Link'));
  if (p.website) links.appendChild(el('a',
    { href: normalizeUrl(p.website), target: '_blank', rel: 'noopener', class: 'vp-place-link' },
    el('i', { class: 'ti ti-world' }), 'Website'));
  links.appendChild(el('a',
    { href: navUrl(p), target: '_blank', rel: 'noopener', class: 'vp-place-link vp-place-nav' },
    el('i', { class: 'ti ti-navigation' }), 'Navigate'));
  card.appendChild(links);

  if (p.notes) card.appendChild(el('div', { class: 'vp-place-notes' }, p.notes));

  // Weather outlook for the trip dates — filled in asynchronously.
  if (typeof p.lat === 'number' && typeof p.lng === 'number') {
    const wx = el('div', { class: 'vp-place-weather' });
    card.appendChild(wx);
    const t = activeTrip();
    weatherSummary(p.lat, p.lng, t.startDate, t.endDate).then(s => {
      if (!s) { wx.remove(); return; }
      const label = s.kind === 'forecast' ? 'forecast'
        : s.kind === 'recorded' ? 'recorded' : 'typical · last yr';
      wx.appendChild(el('i', { class: 'ti ' + s.icon }));
      wx.appendChild(el('span', {},
        s.hi + '° / ' + s.lo + '°F · ' +
        s.rainDays + (s.rainDays === 1 ? ' rainy day' : ' rainy days') +
        ' · ' + label));
    });
  }

  const actions = el('div', { class: 'vp-place-actions' });
  actions.appendChild(el('button', {
    title: 'Add as a trip card', onclick: e => { e.stopPropagation(); makeCardFromPlace(p); }
  }, '+ card'));
  actions.appendChild(el('button', {
    title: 'Delete', onclick: e => { e.stopPropagation(); if (confirm('Delete this place?')) removePlace(p.id); }
  }, '×'));
  card.appendChild(actions);

  return card;
}

// ---------- map ----------
let placesMap = null;

function initPlacesMap(mapDiv, pts) {
  if (!document.body.contains(mapDiv)) return; // view changed before the tick fired
  if (placesMap) { placesMap.remove(); placesMap = null; }
  // scrollWheelZoom enables two-finger trackpad scroll-to-zoom and pinch-zoom.
  const map = L.map(mapDiv, { scrollWheelZoom: true });
  placesMap = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  const latlngs = [];
  pts.forEach(p => {
    const ll = [p.lat, p.lng];
    latlngs.push(ll);
    const staying = p.category === 'staying';
    L.circleMarker(ll, {
      radius: staying ? 10 : 8, color: '#fff', weight: 2,
      fillColor: staying ? '#c7549f' : '#1d8a9c', fillOpacity: 1
    }).addTo(map)
      .bindTooltip((staying ? '🏠 ' : '') + (p.name || 'Place'))
      .on('click', () => openPlaceEditor(p.id));
  });
  if (latlngs.length) {
    map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30], maxZoom: 15 });
  } else {
    map.setView([20, 0], 2);
  }
  setTimeout(() => map.invalidateSize(), 0);
}

// Built by render() when the Places view is active.
export function renderPlacesView() {
  const t = activeTrip();
  const all = t.places || [];
  const panel = el('div', { class: 'vp-places' });

  const head = el('div', { class: 'vp-places-head' });
  head.appendChild(el('h3', {}, 'Research — places'));
  head.appendChild(el('button', {
    class: 'vp-btn-primary', onclick: () => openPlaceEditor(null)
  }, '+ new place'));
  panel.appendChild(head);

  const filterRow = el('div', { class: 'vp-lib-filter' });
  const cats = [['all', 'all']].concat(Object.entries(PLACE_CATEGORIES).map(([k, v]) => [k, v.label.toLowerCase()]));
  cats.forEach(([k, label]) => {
    filterRow.appendChild(el('button', {
      class: 'vp-chip' + (ui.placeFilter === k ? ' vp-chip-on' : ''),
      onclick: () => { ui.placeFilter = k; render(); }
    }, label));
  });
  panel.appendChild(filterRow);

  const visible = all.filter(p => ui.placeFilter === 'all' || p.category === ui.placeFilter);
  // Surface accommodation first for quick access to where you're staying.
  visible.sort((a, b) => (b.category === 'staying' ? 1 : 0) - (a.category === 'staying' ? 1 : 0));

  const withCoords = visible.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');
  if (withCoords.length) {
    const mapDiv = el('div', { class: 'vp-map' });
    panel.appendChild(mapDiv);
    setTimeout(() => initPlacesMap(mapDiv, withCoords), 0);
  }

  if (visible.length === 0) {
    panel.appendChild(el('div', { class: 'vp-places-empty' },
      all.length ? 'No places in this category.'
                 : 'No places yet. Click + new place to start your research list.'));
    return panel;
  }

  const grid = el('div', { class: 'vp-places-grid' });
  visible.forEach(p => grid.appendChild(renderPlaceCard(p)));
  panel.appendChild(grid);
  return panel;
}
