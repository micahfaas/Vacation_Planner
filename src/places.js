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
import { deepLinksFor } from './deeplinks.js';
import { confirmDialog } from './dialog.js';
import { openPlacesImport } from './places-import.js';
import { geocodePlace } from './geocoding.js';
import { getFavorites, addFavorite, removeFavorite, isFavoriteId } from './favorites.js';

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

// Best-effort city for a place — prefers an explicit field, otherwise the
// second-to-last comma-separated chunk of the address (after stripping a
// leading postal code). Returns '' when nothing usable is available.
export function placeCity(p) {
  const explicit = (p.city || '').trim();
  if (explicit) return explicit;
  const addr = (p.address || '').trim();
  if (!addr) return '';
  const parts = addr.split(/,\s*/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  const candidate = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  // Strip a leading postal code, numeric ("06700 ...") or alphanumeric ("C1043ABO ...").
  return candidate.replace(/^(\d{4,7}|[A-Z]\d{3,5}[A-Z]*)\s+/, '').trim();
}

// Google Maps directions deep-link to a place.
function navUrl(p) {
  const dest = (typeof p.lat === 'number' && typeof p.lng === 'number')
    ? p.lat + ',' + p.lng
    : (p.address || p.name || '');
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest);
}

export function addPlace(place) {
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
      onclick: () => {
        confirmDialog('Delete this place?', { danger: true, confirmText: 'Delete' })
          .then(ok => { if (ok) { removePlace(id); bg.remove(); } });
      }
    }, 'Delete'));
  }
  actions.appendChild(leftBtns);

  const rightBtns = el('div', { class: 'vp-right' });
  rightBtns.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  const saveBtn = el('button', {
    class: 'vp-save',
    onclick: async () => {
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
      } else if (out.address) {
        // Try to pin the place from its address so the map and Navigate work.
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        const found = await geocodePlace([out.name, out.address].filter(Boolean).join(', '));
        if (found) { out.lat = found.lat; out.lng = found.lng; }
      }
      if (isNew) addPlace(out);
      else updatePlace(id, out);
      bg.remove();
    }
  }, 'Save');
  rightBtns.appendChild(saveBtn);
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
      if (e.target.closest('.vp-place-actions') || e.target.closest('a') ||
          e.target.closest('.vp-place-star')) return;
      openPlaceEditor(p.id);
    }
  });

  const top = el('div', { class: 'vp-place-top' });
  top.appendChild(el('i', { class: 'ti ' + cat.icon + ' vp-place-icon' }));
  top.appendChild(el('div', { class: 'vp-place-name' }, p.name || 'Untitled place'));

  // Favorite toggle — copies the place into the cross-trip favorites pool.
  const starred = isFavoriteId(p.favoriteId);
  const starBtn = el('button', {
    class: 'vp-place-star' + (starred ? ' vp-place-star-on' : ''),
    title: starred ? 'Remove from favorites' : 'Save to favorites',
    'aria-label': starred ? 'Remove from favorites' : 'Save to favorites'
  }, el('i', { class: 'ti ' + (starred ? 'ti-star-filled' : 'ti-star') }));
  starBtn.addEventListener('click', async e => {
    e.stopPropagation();
    starBtn.disabled = true;
    try {
      if (starred) {
        await removeFavorite(p.favoriteId);
        updatePlace(p.id, { favoriteId: '' });
      } else {
        const fid = await addFavorite(p);
        updatePlace(p.id, { favoriteId: fid });
      }
    } catch (err) {
      console.warn('Favorite toggle failed.', err);
      starBtn.disabled = false;
    }
  });
  top.appendChild(starBtn);
  card.appendChild(top);

  card.appendChild(el('div', { class: 'vp-place-cat' }, cat.label));
  if (p.address) card.appendChild(el('div', { class: 'vp-place-addr' }, p.address));

  const links = el('div', { class: 'vp-place-links' });
  if (p.url) links.appendChild(el('a',
    { href: normalizeUrl(p.url), target: '_blank', rel: 'noopener', class: 'vp-place-link',
      title: normalizeUrl(p.url) },
    el('i', { class: 'ti ti-link' }), 'Link'));
  if (p.website) links.appendChild(el('a',
    { href: normalizeUrl(p.website), target: '_blank', rel: 'noopener', class: 'vp-place-link',
      title: normalizeUrl(p.website) },
    el('i', { class: 'ti ti-world' }), 'Website'));
  links.appendChild(el('a',
    { href: navUrl(p), target: '_blank', rel: 'noopener', class: 'vp-place-link vp-place-nav',
      title: 'Open directions in Google Maps' },
    el('i', { class: 'ti ti-navigation' }), 'Navigate'));
  card.appendChild(links);

  // Category-aware search links into other travel apps.
  const deep = deepLinksFor(p);
  if (deep.length) {
    const deepRow = el('div', { class: 'vp-place-deeplinks' });
    deep.forEach(d => {
      deepRow.appendChild(el('a',
        { href: d.url, target: '_blank', rel: 'noopener', class: 'vp-place-deeplink',
          title: d.title },
        el('i', { class: 'ti ' + d.icon }), d.label));
    });
    card.appendChild(deepRow);
  }

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
    title: 'Delete', 'aria-label': 'Delete place',
    onclick: e => {
      e.stopPropagation();
      confirmDialog('Delete this place?', { danger: true, confirmText: 'Delete' })
        .then(ok => { if (ok) removePlace(p.id); });
    }
  }, '×'));
  card.appendChild(actions);

  return card;
}

// ---------- favorites picker ----------
function openFavoritesPicker() {
  const t = activeTrip();
  const already = new Set((t.places || []).map(p => p.favoriteId).filter(Boolean));
  const favs = getFavorites().filter(f => !already.has(f.id));

  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, 'Add from favorites'));

  if (!favs.length) {
    m.appendChild(el('p', { class: 'vp-dialog-msg' },
      getFavorites().length
        ? 'All of your favorites are already in this trip.'
        : 'You have no favorites yet. Star a place on any trip to save it for next time.'));
    const actions = el('div', { class: 'vp-modal-actions' });
    actions.appendChild(el('div', {}));
    const right = el('div', { class: 'vp-right' });
    right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
    actions.appendChild(right);
    m.appendChild(actions);
    bg.appendChild(m);
    document.body.appendChild(bg);
    return;
  }

  m.appendChild(el('p', { class: 'vp-dialog-msg' },
    'Pick favorites to add to this trip’s research.'));

  // Group by city for scannability.
  const byCity = new Map();
  favs.forEach(f => {
    const c = placeCity(f) || '— no city —';
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(f);
  });

  const selected = new Set();
  const list = el('div', { class: 'vp-fav-list' });
  Array.from(byCity.keys()).sort().forEach(city => {
    list.appendChild(el('div', { class: 'vp-fav-city' }, city));
    byCity.get(city).forEach(f => {
      const cat = PLACE_CATEGORIES[f.category] || PLACE_CATEGORIES.other;
      const row = el('label', { class: 'vp-fav-row' });
      const cb = el('input', { type: 'checkbox' });
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(f.id); else selected.delete(f.id);
        addBtn.disabled = selected.size === 0;
        addBtn.textContent = selected.size
          ? 'Add ' + selected.size + (selected.size === 1 ? ' place' : ' places')
          : 'Add';
      });
      row.appendChild(cb);
      row.appendChild(el('i', { class: 'ti ' + cat.icon + ' vp-fav-icon' }));
      const mainCol = el('div', { class: 'vp-fav-main' });
      mainCol.appendChild(el('div', { class: 'vp-fav-name' }, f.name || 'Place'));
      if (f.address) mainCol.appendChild(el('div', { class: 'vp-fav-addr' }, f.address));
      row.appendChild(mainCol);
      list.appendChild(row);
    });
  });
  m.appendChild(list);

  const addBtn = el('button', { class: 'vp-save' }, 'Add');
  addBtn.disabled = true;
  addBtn.addEventListener('click', () => {
    favs.filter(f => selected.has(f.id)).forEach(f => {
      const copy = Object.assign({}, f);
      delete copy.id;        // addPlace will assign a fresh trip-level id
      delete copy.savedAt;
      copy.favoriteId = f.id;
      addPlace(copy);
    });
    bg.remove();
  });

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
  right.appendChild(addBtn);
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
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
  const headBtns = el('div', { class: 'vp-res-headbtns' });
  headBtns.appendChild(el('button', {
    class: 'vp-btn-primary', onclick: () => openPlacesImport()
  }, 'Import places'));
  if (getFavorites().length) {
    headBtns.appendChild(el('button', {
      class: 'vp-btn-primary', onclick: () => openFavoritesPicker()
    }, 'From favorites'));
  }
  headBtns.appendChild(el('button', {
    class: 'vp-btn-primary', onclick: () => openPlaceEditor(null)
  }, '+ new place'));
  head.appendChild(headBtns);
  panel.appendChild(head);

  const filterRow = el('div', { class: 'vp-lib-filter' });
  const cats = [['all', 'all']].concat(Object.entries(PLACE_CATEGORIES).map(([k, v]) => [k, v.label.toLowerCase()]));
  cats.forEach(([k, label]) => {
    filterRow.appendChild(el('button', {
      class: 'vp-chip' + (ui.placeFilter === k ? ' vp-chip-on' : ''),
      onclick: () => { ui.placeFilter = k; render(); }
    }, label));
  });

  // City dropdown — only shown when the saved places span at least two cities.
  const cities = Array.from(new Set(all.map(placeCity).filter(Boolean))).sort();
  if (cities.length >= 2) {
    if (ui.placeCityFilter !== 'all' && !cities.includes(ui.placeCityFilter)) {
      ui.placeCityFilter = 'all';
    }
    const citySel = el('select', { class: 'vp-place-city-sel' });
    citySel.appendChild(el('option', { value: 'all' }, 'All cities'));
    cities.forEach(c => {
      const opt = el('option', { value: c }, c);
      if (c === ui.placeCityFilter) opt.selected = true;
      citySel.appendChild(opt);
    });
    citySel.addEventListener('change', () => { ui.placeCityFilter = citySel.value; render(); });
    filterRow.appendChild(citySel);
  } else if (ui.placeCityFilter !== 'all') {
    ui.placeCityFilter = 'all';
  }

  panel.appendChild(filterRow);

  const visible = all.filter(p =>
    (ui.placeFilter === 'all' || p.category === ui.placeFilter) &&
    (ui.placeCityFilter === 'all' || placeCity(p) === ui.placeCityFilter)
  );
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
