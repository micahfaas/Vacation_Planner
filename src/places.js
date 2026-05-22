// Research / places library + an OpenStreetMap map of saved places.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { activeTrip, ui } from './state.js';
import { el } from './dom.js';
import { save } from './storage.js';
import { render } from './render.js';

// Jump to the Places tab and spotlight a specific saved place. Clears any
// filters that would hide it, switches view, then scrolls to + briefly
// highlights its card. Used by the journal's photo→place links.
export function focusPlace(placeId) {
  const t = activeTrip();
  if (!t || !(t.places || []).some(p => p.id === placeId)) return;
  ui.placeFilter = 'all';
  ui.placeCityFilter = 'all';
  ui.focusPlaceId = placeId;
  ui.view = 'places';
  render();
  // After the view renders, scroll the card into view and flash it.
  setTimeout(() => {
    const card = document.querySelector('.vp-place[data-place-id="' + placeId + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Drop the highlight after the flash so it doesn't persist on re-render.
    setTimeout(() => {
      if (ui.focusPlaceId === placeId) {
        ui.focusPlaceId = null;
        const c = document.querySelector('.vp-place-focus');
        if (c) c.classList.remove('vp-place-focus');
      }
    }, 2200);
  }, 60);
}
import { PLACE_CATEGORIES } from './constants.js';
import { addCard } from './cards.js';
import { deepLinksFor } from './deeplinks.js';
import { confirmDialog, alertDialog } from './dialog.js';
import { openPlacesImport, tryGeocode } from './places-import.js';
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

// Clean up a city candidate: strip leading or trailing postal codes and
// common administrative prefixes that show up in addresses but aren't the
// city name humans use.
function cleanCityName(s) {
  let v = s;
  v = v.replace(/^(\d{4,7}|[A-Z]\d{3,5}[A-Z]*)\s+/, '');         // leading postal
  v = v.replace(/\s+\d{4,7}$/, '');                              // trailing numeric postal
  v = v.replace(/\s+[A-Z]\d{3,5}[A-Z]*$/, '');                   // trailing alphanumeric postal
  v = v.replace(
    /^(Cdad\.?\s+Aut[oó]noma\s+de\s+|Ciudad\s+Aut[oó]noma\s+de\s+|Provincia\s+de\s+|Comuna\s+de\s+|Distrito\s+de\s+|Regi[oó]n\s+(?:de\s+)?)/i,
    '');
  return v.trim();
}

// Best-effort city for a place — prefers an explicit field, otherwise picks
// the most-likely-city comma chunk of the address. Returns '' if nothing
// usable is available.
export function placeCity(p) {
  const explicit = (p.city || '').trim();
  if (explicit) return cleanCityName(explicit);
  const addr = (p.address || '').trim();
  if (!addr) return '';
  const parts = addr.split(/,\s*/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  // Second-to-last is the typical city slot. In US-style addresses
  // ("..., City, State ZIP, Country") the "State ZIP" lands there and the
  // city sits one further back.
  let candidate = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  if (/^[A-Z]{2}\s+\d{5}/.test(candidate) && parts.length >= 3) {
    candidate = parts[parts.length - 3];
  }
  return cleanCityName(candidate);
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
    class: 'vp-place vp-place-cat-' + (p.category || 'other') +
      (p.category === 'staying' ? ' vp-place-staying' : '') +
      (ui.focusPlaceId === p.id ? ' vp-place-focus' : ''),
    'data-place-id': p.id,
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

// ---------- backfill geocoding for places that lack coordinates ----------
async function pinMissingPlaces(targets, btn) {
  const total = targets.length;
  let done = 0, found = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  btn.disabled = true;
  for (const p of targets) {
    btn.textContent = 'Pinning ' + (++done) + ' of ' + total + '…';
    const coords = await tryGeocode(p.name, p.address);
    if (coords) {
      updatePlace(p.id, { lat: coords.lat, lng: coords.lng });
      found++;
    }
    // Nominatim's usage policy asks for ≤1 request per second.
    if (done < total) await sleep(1100);
  }
  btn.disabled = false;
  // The render() inside updatePlace will refresh the map; nothing else to do.
  if (found < total) {
    alertDialog(
      'Pinned ' + found + ' of ' + total + ' place' + (total === 1 ? '' : 's') +
      '. The rest didn\'t turn up in OpenStreetMap — try opening each and ' +
      'pasting a Google Maps link into the Link field.');
  }
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

// Marker colors mirror the place card tints so a glance ties a pin to a card.
const MARKER_COLORS = {
  staying:    '#c7549f',
  restaurant: '#d94d3a',
  cafe:       '#a88a4f',
  bar:        '#e8821e',
  cocktail:   '#7a4ea0',
  attraction: '#2da55a',
  shop:       '#1f7fb5',
  lodging:    '#c7549f',
  other:      '#6b6151'
};

function placeMarkerIcon(category) {
  const cat = PLACE_CATEGORIES[category] || PLACE_CATEGORIES.other;
  const color = MARKER_COLORS[category] || MARKER_COLORS.other;
  return L.divIcon({
    className: 'vp-place-marker',
    html: '<span class="vp-place-marker-pin" style="background:' + color + '">' +
          '<i class="ti ' + cat.icon + '"></i></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function initPlacesMap(mapDiv, pts) {
  if (!document.body.contains(mapDiv)) return; // view changed before the tick fired
  if (placesMap) { placesMap.remove(); placesMap = null; }
  // scrollWheelZoom enables two-finger trackpad scroll-to-zoom and pinch-zoom.
  const map = L.map(mapDiv, { scrollWheelZoom: true });
  placesMap = map;
  // CartoDB Positron — a desaturated basemap so the colored markers pop.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  const latlngs = [];
  pts.forEach(p => {
    const ll = [p.lat, p.lng];
    latlngs.push(ll);
    L.marker(ll, { icon: placeMarkerIcon(p.category) }).addTo(map)
      .bindTooltip(p.name || 'Place')
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
  // Backfill button for places that have an address but no map coordinates.
  const needsCoords = all.filter(p =>
    (p.address && p.address.trim()) &&
    !(typeof p.lat === 'number' && typeof p.lng === 'number'));
  if (needsCoords.length) {
    const pinBtn = el('button', {
      class: 'vp-btn-primary',
      title: 'Geocode addresses for ' + needsCoords.length + ' place' +
        (needsCoords.length === 1 ? '' : 's') + ' that aren’t on the map yet',
      onclick: () => pinMissingPlaces(needsCoords, pinBtn)
    }, 'Pin ' + needsCoords.length + ' on map');
    headBtns.appendChild(pinBtn);
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

  // Side-by-side layout: list on the left, sticky map on the right.
  // The split collapses to a stack on narrow viewports via CSS.
  const split = el('div', { class: 'vp-places-split' });
  panel.appendChild(split);

  const listCol = el('div', { class: 'vp-places-list-col' });
  split.appendChild(listCol);

  if (visible.length === 0) {
    listCol.appendChild(el('div', { class: 'vp-places-empty' },
      all.length ? 'No places match the current filter.'
                 : 'No places yet. Click + new place to start your research list.'));
  } else {
    visible.forEach(p => listCol.appendChild(renderPlaceCard(p)));
  }

  if (withCoords.length) {
    const mapDiv = el('div', { class: 'vp-map vp-places-map' });
    split.appendChild(mapDiv);
    setTimeout(() => initPlacesMap(mapDiv, withCoords), 0);
  }

  return panel;
}
