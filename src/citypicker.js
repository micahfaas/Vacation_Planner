// Searchable city input: type a name, pick from live geocoding results.
// Free-form text is allowed too — unmatched input falls back to the
// browser timezone.
import { el } from './dom.js';
import { searchCities } from './geocoding.js';
import { browserTz } from './timezone.js';

// opts: { city, timezone, latitude, longitude, placeholder, onChange }
// onChange() fires whenever the city value changes (selection, typing, or
// programmatic setValue) so callers can react live.
// Returns { el, getValue } where getValue() -> { name, timezone, latitude, longitude }.
export function createCityPicker(opts = {}) {
  const fireChange = () => { if (typeof opts.onChange === 'function') opts.onChange(); };
  const value = {
    name: opts.city || '',
    timezone: opts.timezone || browserTz(),
    latitude: opts.latitude ?? null,
    longitude: opts.longitude ?? null
  };
  // A card that arrives with both a city and a timezone was a resolved match.
  let selected = !!(opts.city && opts.timezone);

  const input = el('input', {
    type: 'text',
    value: value.name,
    placeholder: opts.placeholder || 'Search any city…',
    autocomplete: 'off'
  });
  const menu = el('div', { class: 'vp-citypicker-menu' });
  menu.style.display = 'none';
  const caption = el('div', { class: 'vp-citypicker-tz' });
  const wrap = el('div', { class: 'vp-citypicker' }, input, menu, caption);

  function updateCaption() {
    caption.classList.remove('vp-citypicker-tz-freeform');
    // Only surface the timezone when it's a resolved match in a zone that
    // differs from the device — that's the only time it's actually useful for
    // reading depart/arrive. A defaulted device zone is just noise (and was
    // misleading, e.g. showing "America/Los_Angeles" for a city it didn't match).
    if (value.name && selected && value.timezone && value.timezone !== browserTz()) {
      caption.textContent = 'Timezone: ' + value.timezone;
    } else {
      caption.textContent = '';
    }
  }
  updateCaption();

  function hideMenu() { menu.style.display = 'none'; }
  function showMenu() { menu.style.display = ''; }

  function setMessage(text) {
    menu.innerHTML = '';
    menu.appendChild(el('div', { class: 'vp-citypicker-msg' }, text));
    showMenu();
  }

  function renderResults(results) {
    menu.innerHTML = '';
    if (results.length === 0) {
      setMessage('No matches — your typed text will be kept as a custom city.');
      return;
    }
    results.forEach(city => {
      const item = el('div', { class: 'vp-citypicker-item' },
        el('span', { class: 'vp-citypicker-item-name' }, city.label),
        el('span', { class: 'vp-citypicker-item-tz' }, city.timezone)
      );
      // mousedown fires before the input's blur, so the click isn't lost
      item.addEventListener('mousedown', e => { e.preventDefault(); choose(city); });
      menu.appendChild(item);
    });
    showMenu();
  }

  function choose(city) {
    value.name = city.name;
    value.timezone = city.timezone || browserTz();
    value.latitude = city.latitude ?? null;
    value.longitude = city.longitude ?? null;
    selected = true;
    input.value = city.label;
    hideMenu();
    updateCaption();
    fireChange();
  }

  let debounceTimer = 0;
  let reqSeq = 0;
  function search(q) {
    const seq = ++reqSeq;
    setMessage('Searching…');
    searchCities(q).then(results => {
      if (seq === reqSeq) renderResults(results);
    }).catch(() => {
      if (seq === reqSeq) setMessage('Search unavailable — type a city name to use it as-is.');
    });
  }

  input.addEventListener('input', () => {
    const text = input.value.trim();
    // Editing detaches any prior match; treat as free-form until re-selected.
    value.name = text;
    value.timezone = browserTz();
    value.latitude = null;
    value.longitude = null;
    selected = false;
    updateCaption();
    fireChange();
    clearTimeout(debounceTimer);
    if (text.length < 2) { hideMenu(); return; }
    debounceTimer = setTimeout(() => search(text), 250);
  });

  input.addEventListener('focus', () => {
    if (!selected && input.value.trim().length >= 2 && menu.childNodes.length) showMenu();
  });
  input.addEventListener('blur', () => { setTimeout(hideMenu, 150); });

  return {
    el: wrap,
    getValue() {
      return {
        name: value.name,
        timezone: value.name ? value.timezone : '',
        latitude: value.latitude,
        longitude: value.longitude
      };
    },
    // Fill the picker programmatically (used by flight lookup).
    setValue(v) {
      value.name = (v && v.city) || '';
      value.timezone = (v && v.timezone) || browserTz();
      value.latitude = v && v.latitude != null ? v.latitude : null;
      value.longitude = v && v.longitude != null ? v.longitude : null;
      selected = !!(value.name && v && v.timezone);
      input.value = value.name;
      hideMenu();
      updateCaption();
      fireChange();
    }
  };
}
