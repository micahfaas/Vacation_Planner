// Read-only trip sharing. Publishing uploads a JSON snapshot of a trip to a
// public Supabase Storage bucket; the share link (?share=<token>) loads that
// snapshot and renders a read-only itinerary with no sign-in required.
import { supabase } from './supabase.js';
import { save, markTripDirty } from './storage.js';
import { el } from './dom.js';
import { TYPES } from './constants.js';
import { isoDate, parseISO, addDays, fmtShort } from './dates.js';

const BUCKET = 'shared';

// Upload (or refresh) a public snapshot of a trip; resolves to the share URL.
export async function shareTrip(trip) {
  if (!trip.shareToken) {
    trip.shareToken = crypto.randomUUID();
    markTripDirty(trip.id);
    save();
  }
  const snapshot = {
    version: 1,
    sharedAt: new Date().toISOString(),
    trip: {
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      cards: trip.cards || {},
      schedule: trip.schedule || {},
      places: trip.places || []
    }
  };
  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET)
    .upload(trip.shareToken + '.json', blob, { upsert: true, contentType: 'application/json' });
  if (error) throw error;
  return location.origin + location.pathname + '?share=' + trip.shareToken;
}

// Fetch a published snapshot by token (no auth — the bucket is public).
export async function loadSharedTrip(token) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(token + '.json');
  const res = await fetch(data.publicUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error('Shared trip not found');
  const json = await res.json();
  return json.trip || json;
}

// ---------- share dialog ----------
export async function openShareDialog(trip) {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, 'Share trip'));
  const status = el('div', { class: 'vp-share-status' }, 'Publishing a read-only snapshot…');
  m.appendChild(status);
  bg.appendChild(m);
  document.body.appendChild(bg);

  try {
    const url = await shareTrip(trip);
    status.remove();
    m.appendChild(el('p', { class: 'vp-share-note' },
      'Anyone with this link can view a read-only snapshot of this trip — no account needed. Share again any time to update the snapshot.'));
    const urlIn = el('input', { type: 'text', readonly: true, value: url, class: 'vp-share-url' });
    m.appendChild(urlIn);

    const copyBtn = el('button', { class: 'vp-save' }, 'Copy link');
    copyBtn.addEventListener('click', () => {
      urlIn.focus();
      urlIn.select();
      navigator.clipboard.writeText(url).then(
        () => { copyBtn.textContent = 'Copied ✓'; },
        () => { copyBtn.textContent = 'Press ⌘/Ctrl+C'; }
      );
    });

    const actions = el('div', { class: 'vp-modal-actions' });
    actions.appendChild(el('div', {}));
    const right = el('div', { class: 'vp-right' });
    right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
    right.appendChild(copyBtn);
    actions.appendChild(right);
    m.appendChild(actions);
    setTimeout(() => { urlIn.focus(); urlIn.select(); }, 30);
  } catch (e) {
    status.textContent = 'Could not publish — ' + (e.message || e) +
      '. Make sure supabase/share.sql has been run in your Supabase project.';
    status.classList.add('vp-share-status-err');
  }
}

// ---------- read-only render ----------
function sharedMeta(c) {
  const bits = [];
  if (c.type === 'flight' || c.type === 'transit') {
    if (c.depart && c.arrive) {
      bits.push((c.originCity || '?') + ' ' + c.depart.slice(11, 16) +
        ' → ' + (c.destCity || '?') + ' ' + c.arrive.slice(11, 16));
    } else if (c.originCity || c.destCity) {
      bits.push((c.originCity || '?') + ' → ' + (c.destCity || '?'));
    }
  } else {
    if (c.city) bits.push(c.city);
    if (c.time) bits.push(c.time);
    if (c.type === 'hotel' && c.nights) bits.push(c.nights + (c.nights == 1 ? ' night' : ' nights'));
  }
  return bits.join(' · ');
}

function sharedCard(c) {
  const tp = TYPES[c.type] || TYPES.note;
  const card = el('div', {
    class: 'vp-shared-card',
    style: { background: tp.bg, color: tp.text, borderLeftColor: tp.color }
  });
  const title = el('div', { class: 'vp-shared-card-title' },
    el('i', { class: 'ti ' + tp.icon }), el('span', {}, c.title || tp.label));
  card.appendChild(title);
  const meta = sharedMeta(c);
  if (meta) card.appendChild(el('div', { class: 'vp-shared-card-meta' }, meta));
  if (c.notes) card.appendChild(el('div', { class: 'vp-shared-card-notes' }, c.notes));
  return card;
}

export function renderSharedTrip(trip) {
  const root = document.getElementById('vp-root');
  root.innerHTML = '';
  document.body.classList.add('vp-shared');

  const wrap = el('div', { class: 'vp-shared-wrap' });
  wrap.appendChild(el('div', { class: 'vp-shared-banner' },
    el('i', { class: 'ti ti-eye' }), ' Shared itinerary — read-only'));
  wrap.appendChild(el('h2', { class: 'vp-shared-title' }, trip.name || 'Trip'));
  if (trip.startDate && trip.endDate) {
    wrap.appendChild(el('div', { class: 'vp-shared-dates' },
      fmtShort(parseISO(trip.startDate)) + ' – ' + fmtShort(parseISO(trip.endDate))));
  }

  const cards = trip.cards || {};
  const schedule = trip.schedule || {};
  if (trip.startDate && trip.endDate && trip.endDate >= trip.startDate) {
    const agenda = el('div', { class: 'vp-shared-agenda' });
    let d = parseISO(trip.startDate);
    const end = parseISO(trip.endDate);
    while (d <= end) {
      const ids = schedule[isoDate(d)] || [];
      const day = el('div', { class: 'vp-shared-day' });
      day.appendChild(el('div', { class: 'vp-shared-day-label' },
        d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })));
      if (!ids.length) {
        day.appendChild(el('div', { class: 'vp-shared-empty' }, 'Open day'));
      } else {
        ids.forEach(id => { if (cards[id]) day.appendChild(sharedCard(cards[id])); });
      }
      agenda.appendChild(day);
      d = addDays(d, 1);
    }
    wrap.appendChild(agenda);
  }

  const places = trip.places || [];
  if (places.length) {
    wrap.appendChild(el('h3', { class: 'vp-shared-section' }, 'Saved places'));
    const grid = el('div', { class: 'vp-shared-places' });
    places.forEach(p => {
      const card = el('div', { class: 'vp-shared-place' });
      card.appendChild(el('div', { class: 'vp-shared-place-name' }, p.name || 'Place'));
      if (p.address) card.appendChild(el('div', { class: 'vp-shared-place-addr' }, p.address));
      if (p.notes) card.appendChild(el('div', { class: 'vp-shared-place-notes' }, p.notes));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  wrap.appendChild(el('div', { class: 'vp-shared-foot' }, 'Made with Vacation Planner'));
  root.appendChild(wrap);
}
