// AI trip co-planner: a modal that sends the active trip's state plus a
// free-text request to the co-planner Edge Function (Claude) and shows the
// advice it returns, with one-tap "Add" for any cards it suggests.
import { el } from './dom.js';
import { activeTrip } from './state.js';
import { supabase } from './supabase.js';
import { addCard } from './cards.js';
import { getDays } from './derived.js';
import { isoDate } from './dates.js';
import { TYPES } from './constants.js';
import { aiCardToCandidate } from './import-ai.js';
import { addPlace } from './places.js';
import { profileSummary } from './profile.js';
import { geocodePlace } from './geocoding.js';

// ---------- trip context sent to the model ----------
function describeCard(c) {
  const bits = [(c.title || c.type), '[' + c.type + ']'];
  if (c.type === 'hotel' && c.nights) bits.push(c.nights + (c.nights === 1 ? ' night' : ' nights'));
  if (c.time) bits.push(c.time);
  if (c.city) bits.push(c.city);
  if ((c.type === 'flight' || c.type === 'transit') && (c.originCity || c.destCity)) {
    bits.push((c.originCity || '?') + ' → ' + (c.destCity || '?'));
  }
  if (c.booked) bits.push('booked');
  return bits.join(' ');
}

// A compact text snapshot of the trip for the model to plan against.
function tripSummary() {
  const t = activeTrip();
  const lines = [];
  const prof = profileSummary();
  if (prof) lines.push(prof, '');
  lines.push('Trip: ' + (t.name || 'Untitled trip'));

  if (t.startDate && t.endDate) {
    const days = getDays();
    lines.push('Dates: ' + t.startDate + ' to ' + t.endDate + ' (' + days.length + ' days)');
    lines.push('', 'Itinerary by day:');
    days.forEach(d => {
      const iso = isoDate(d);
      const items = (t.schedule[iso] || [])
        .map(id => t.cards[id]).filter(Boolean).map(describeCard);
      lines.push('  ' + iso + ': ' + (items.length ? items.join('; ') : '— open —'));
    });
  } else {
    lines.push('Dates: not set');
  }

  const lib = (t.library || []).map(id => t.cards[id]).filter(Boolean);
  if (lib.length) {
    lines.push('', 'Unscheduled cards in the library:');
    lib.forEach(c => lines.push('  - ' + describeCard(c)));
  }

  const places = t.places || [];
  if (places.length) {
    lines.push('', 'Saved places (research):');
    places.forEach(p => lines.push(
      '  - ' + (p.name || 'Place') + ' (' + (p.category || 'place') +
      (p.address ? ', ' + p.address : '') + ')'));
  }

  return lines.join('\n').slice(0, 11000);
}

// ---------- suggestion rendering ----------

// Card types that can also be saved as a Place, with their Place category.
const PLACE_CAT = { meal: 'restaurant', activity: 'attraction', hotel: 'lodging', note: 'other' };

// Google Maps search link built from whatever venue info we have.
function mapsSearchUrl(card, address) {
  const parts = [card.title, address, !address ? card.city : ''].filter(Boolean);
  const query = parts.join(', ').trim();
  if (!query) return '';
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}

// Model-generated website URLs are unreliable — even with "never invent a
// URL" in the prompt, small models confidently produce plausible homepages
// that 404. Rather than linking a guessed URL, build a Google search for the
// venue's official site: it reliably lands on the real homepage, and the
// knowledge panel surfaces the link, hours, and reviews alongside it.
function officialSiteUrl(name, city) {
  const q = [name, city, 'official website'].filter(Boolean).join(' ').trim();
  if (!q) return '';
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

function suggestionMeta(card, date, address) {
  const bits = [];
  if (date) bits.push(date);
  if (address) bits.push(address);
  else if (card.city) bits.push(card.city);
  if (card.originCity || card.destCity) bits.push((card.originCity || '?') + ' → ' + (card.destCity || '?'));
  if (card.type === 'hotel' && card.nights) bits.push(card.nights + (card.nights === 1 ? ' night' : ' nights'));
  if (card.flightNo) bits.push(card.flightNo);
  if (card.time) bits.push(card.time);
  return bits.join(' · ');
}

function suggestionRow(aiCard) {
  const cand = aiCardToCandidate(aiCard);
  if (!cand) return null;
  const c = cand.card;
  const address = (aiCard.address || '').trim();
  const tp = TYPES[c.type] || TYPES.note;
  const timed = c.type === 'activity' || c.type === 'meal';
  const venueLike = !!PLACE_CAT[c.type] && c.type !== 'note';
  const mapUrl = venueLike ? mapsSearchUrl(c, address) : '';
  // Reliable "official website" search link (replaces the model's guessed URL).
  const siteUrl = venueLike ? officialSiteUrl(c.title, c.city) : '';

  const row = el('div', { class: 'vp-coplan-sug' });
  row.appendChild(el('i', { class: 'ti ' + tp.icon, style: { color: tp.color } }));

  const main = el('div', { class: 'vp-coplan-sug-main' });
  main.appendChild(el('div', { class: 'vp-coplan-sug-title' }, c.title));
  const meta = suggestionMeta(c, cand.date, address);
  if (meta) main.appendChild(el('div', { class: 'vp-coplan-sug-meta' }, meta));
  if (c.notes) main.appendChild(el('div', { class: 'vp-coplan-sug-notes' }, c.notes));

  const controls = el('div', { class: 'vp-coplan-sug-controls' });

  // Map and website links, so the user can vet a place before adding it.
  if (mapUrl) {
    controls.appendChild(el('a', {
      href: mapUrl, target: '_blank', rel: 'noopener noreferrer',
      class: 'vp-coplan-link', title: 'Open in Google Maps'
    }, [el('i', { class: 'ti ti-map-pin' }), 'Map']));
  }
  if (siteUrl) {
    controls.appendChild(el('a', {
      href: siteUrl, target: '_blank', rel: 'noopener noreferrer',
      class: 'vp-coplan-link', title: 'Search for the official website'
    }, [el('i', { class: 'ti ti-external-link' }), 'Site']));
  }

  // Start-time picker for activities and meals.
  let timeInput = null;
  if (timed) {
    timeInput = el('input', { type: 'time', class: 'vp-coplan-time', value: c.time || '', title: 'Start time' });
    controls.appendChild(timeInput);
  }

  // Add as a trip card — onto its date when dated and in range, else the library.
  const cardBtn = el('button', { type: 'button', class: 'vp-coplan-add' }, '+ Card');
  cardBtn.addEventListener('click', () => {
    const card = Object.assign({}, c);
    if (timeInput) {
      if (timeInput.value) card.time = timeInput.value;
      else delete card.time;
    }
    const extras = [address].filter(Boolean);
    if (extras.length) card.notes = [card.notes, ...extras].filter(Boolean).join('\n');
    const t = activeTrip();
    const onDay = cand.date && t.startDate && t.endDate &&
      cand.date >= t.startDate && cand.date <= t.endDate;
    addCard(card, onDay ? { kind: 'day', date: cand.date } : { kind: 'lib' });
    cardBtn.textContent = '✓ Card';
    cardBtn.title = onDay ? 'Added to ' + cand.date : 'Added to the card library';
    cardBtn.disabled = true;
  });
  controls.appendChild(cardBtn);

  // Add as a saved place — for venue-like suggestions only.
  if (PLACE_CAT[c.type]) {
    const placeBtn = el('button', { type: 'button', class: 'vp-coplan-add vp-coplan-add-alt' }, '+ Place');
    placeBtn.addEventListener('click', async () => {
      placeBtn.disabled = true;
      placeBtn.textContent = 'Adding…';
      // Geocode so the map pin and Navigate button work — the address from the
      // co-planner is rarely wrong but never carries coordinates of its own.
      const place = {
        name: c.title || 'Place',
        category: PLACE_CAT[c.type],
        address: address || c.city || '',
        city: c.city || '',
        url: mapUrl || '',
        website: siteUrl || '',
        notes: c.notes || ''
      };
      const query = [place.name, place.address].filter(Boolean).join(', ');
      const coords = query ? await geocodePlace(query) : null;
      if (coords) { place.lat = coords.lat; place.lng = coords.lng; }
      addPlace(place);
      placeBtn.textContent = '✓ Place';
      placeBtn.title = 'Added to your saved places';
    });
    controls.appendChild(placeBtn);
  }

  main.appendChild(controls);
  row.appendChild(main);
  return row;
}

function renderResult(out, data) {
  out.innerHTML = '';
  if (data.reply) out.appendChild(el('div', { class: 'vp-coplan-reply' }, data.reply));

  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  const rows = suggestions.map(suggestionRow).filter(Boolean);
  if (rows.length) {
    out.appendChild(el('div', { class: 'vp-coplan-sug-head' },
      'Suggested cards — tap Add to drop them into your trip'));
    const list = el('div', { class: 'vp-coplan-sug-list' });
    rows.forEach(r => list.appendChild(r));
    out.appendChild(list);
  }
}

// ---------- modal ----------
export function openCoPlanner() {
  const t = activeTrip();
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-coplan' });

  m.appendChild(el('h3', {}, 'Trip co-planner'));
  const tripBits = [t.name || 'Untitled trip'];
  if (t.startDate && t.endDate) tripBits.push(t.startDate + ' → ' + t.endDate);
  m.appendChild(el('div', { class: 'vp-coplan-trip' }, 'Planning: ' + tripBits.join('  ·  ')));

  const ta = el('textarea', {
    class: 'vp-coplan-input',
    placeholder: 'Ask the co-planner — review your plan, suggest activities, fill an open day, draft a few days in a city…'
  });

  const chips = el('div', { class: 'vp-coplan-chips' });
  [
    ['Review my plan', 'Review my itinerary — is the pacing right? Anything missing, rushed, or worth reordering?'],
    ['Fill open days', 'Suggest specific things to do on my open days.'],
    ['Restaurant ideas', 'Suggest a few standout restaurants for the cities on this trip.']
  ].forEach(([label, preset]) => {
    chips.appendChild(el('button', {
      type: 'button', class: 'vp-chip',
      onclick: () => { ta.value = preset; ta.focus(); }
    }, label));
  });
  m.appendChild(chips);
  m.appendChild(ta);

  const out = el('div', { class: 'vp-coplan-out' });
  m.appendChild(out);

  const askBtn = el('button', { class: 'vp-save' }, 'Ask');
  async function ask() {
    const prompt = ta.value.trim();
    if (!prompt) { ta.focus(); return; }
    askBtn.disabled = true;
    out.innerHTML = '';
    out.appendChild(el('div', { class: 'vp-coplan-status' }, 'Thinking — this can take a moment…'));
    try {
      const res = await supabase.functions.invoke('co-planner', {
        body: { prompt, context: tripSummary() }
      });
      if (res.error) throw new Error('The co-planner service is unavailable.');
      const data = res.data;
      if (!data || data.ok !== true) {
        throw new Error((data && data.error) || 'The co-planner could not respond.');
      }
      renderResult(out, data);
    } catch (e) {
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'vp-coplan-status vp-coplan-err' },
        e.message || 'Something went wrong.'));
    }
    askBtn.disabled = false;
  }
  askBtn.addEventListener('click', ask);

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
  right.appendChild(askBtn);
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
  setTimeout(() => ta.focus(), 30);
}
