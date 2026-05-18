// Searchable city input: type a name, pick from live geocoding results.
// Free-form text is allowed too — unmatched input falls back to the
// browser timezone.
import { el } from './dom.js';
import { searchCities } from './geocoding.js';
import { browserTz } from './timezone.js';

// opts: { city, timezone, latitude, longitude, placeholder }
// Returns { el, getValue } where getValue() -> { name, timezone, latitude, longitude }.
export function createCityPicker(opts = {}) {
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
    if (!value.name) { caption.textContent = ''; return; }
    if (selected) {
      caption.textContent = 'Timezone: ' + value.timezone;
    } else {
      caption.textContent = 'Not matched — using your timezone (' + value.timezone + ')';
      caption.classList.add('vp-citypicker-tz-freeform');
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
    }
  };
}
