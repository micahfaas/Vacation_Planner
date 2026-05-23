// Card read view: a clean, non-editable summary shown when you open a saved
// card. The Edit button flips to the full editor (editor.js). New cards still
// open the editor directly. Modeled on the condensed side-pane cards, just
// larger and with a few extras (clickable links, a best-effort website photo,
// Navigate, and a flight-status button).
import { activeTrip } from './state.js';
import { TYPES, CITY_STAY_COLORS } from './constants.js';
import { el } from './dom.js';
import { supabase } from './supabase.js';
import { openEditor } from './editor.js';
import { removeCard } from './cards.js';
import { confirmDialog } from './dialog.js';
import { openAttachment } from './attachments.js';
import { getProfile } from './profile.js';
import { eligibleLoungesForFlight, hasLoungeProfile } from './lounges.js';
import { parseISO } from './dates.js';

const URL_RE = /\bhttps?:\/\/[^\s<>()]+/i;
const URL_RE_G = /\bhttps?:\/\/[^\s<>()]+/gi;

// The first "real website" URL in free-text notes — i.e. not a map, share, or
// social link. Used for the Website link and the photo lookup.
function firstWebsiteUrl(notes) {
  const urls = (notes || '').match(URL_RE_G) || [];
  return urls.find(u =>
    !/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|facebook\.com|instagram\.com|twitter\.com|x\.com|t\.co/i.test(u)
  ) || '';
}

// Render notes preserving line breaks, with any URLs turned into links.
export function linkifyNotes(notes) {
  const wrap = el('div', { class: 'vp-cd-notes' });
  (notes || '').split('\n').forEach((line, i) => {
    if (i) wrap.appendChild(el('br'));
    let last = 0, m;
    const re = new RegExp(URL_RE_G.source, 'gi');
    while ((m = re.exec(line))) {
      if (m.index > last) wrap.appendChild(document.createTextNode(line.slice(last, m.index)));
      wrap.appendChild(el('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
      last = m.index + m[0].length;
    }
    if (last < line.length) wrap.appendChild(document.createTextNode(line.slice(last)));
  });
  return wrap;
}

function cardNavUrl(c) {
  const q = [c.title, c.city].filter(Boolean).join(', ');
  if (!q) return '';
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q);
}

function flightStatusUrl(c) {
  const no = (c.flightNo || '').replace(/\s+/g, '');
  if (!no) return '';
  const date = (c.depart || '').slice(0, 10);
  return 'https://www.google.com/search?q=' + encodeURIComponent(no + ' flight status' + (date ? ' ' + date : ''));
}

// Format a wall-clock "YYYY-MM-DDTHH:MM" for display (kept in local components,
// since the stored time is already the local time at that airport).
function fmtDateTime(s) {
  const m = (s || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function overnightDays(depart, arrive) {
  const d = (depart || '').slice(0, 10), a = (arrive || '').slice(0, 10);
  if (!d || !a || a <= d) return 0;
  return Math.round((parseISO(a) - parseISO(d)) / 86400000);
}

// Real venue photo from Google Places (place-photo function), fetched
// server-side and cached for the session. Removes the wrapper if none is found.
const photoCache = new Map();
export async function loadPlacePhoto(query, wrap) {
  if (!query) { wrap.remove(); return; }
  if (photoCache.has(query)) { showPhoto(wrap, photoCache.get(query)); return; }
  try {
    const res = await supabase.functions.invoke('place-photo', { body: { query } });
    const d = res && res.data;
    const data = (d && d.ok && d.image) ? { image: d.image, attribution: d.attribution || '' } : null;
    photoCache.set(query, data);
    showPhoto(wrap, data);
  } catch {
    photoCache.set(query, null);
    wrap.remove();
  }
}
function showPhoto(wrap, data) {
  if (!data || !data.image) { wrap.remove(); return; }
  const img = el('img', { class: 'vp-cd-photo-img', src: data.image, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => wrap.remove());
  wrap.appendChild(img);
  if (data.attribution) wrap.appendChild(el('div', { class: 'vp-cd-photo-attr' }, 'Photo: ' + data.attribution + ' · Google'));
}

function appendLounges(m, c) {
  const profile = getProfile();
  if (!hasLoungeProfile(profile)) return;
  const groups = eligibleLoungesForFlight(c, profile);
  if (!groups.length) return;
  const count = groups.reduce((n, g) => n + g.lounges.length, 0);
  const toggle = el('button', { class: 'vp-cd-lounge-toggle' }, '▸ Lounges (' + count + ')');
  const body = el('div', { class: 'vp-cd-lounge-body', style: { display: 'none' } });
  groups.forEach(g => {
    body.appendChild(el('div', { class: 'vp-cd-lounge-head' },
      g.iata + ' · ' + (g.side === 'departure' ? 'Departure' : 'Arrival') + ' · ' + g.city));
    g.lounges.forEach(l => body.appendChild(el('div', { class: 'vp-cd-lounge-name' },
      l.name + (l.terminal ? ' — ' + l.terminal : ''))));
  });
  let open = false;
  toggle.addEventListener('click', () => {
    open = !open;
    body.style.display = open ? 'block' : 'none';
    toggle.textContent = (open ? '▾' : '▸') + ' Lounges (' + count + ')';
  });
  m.appendChild(toggle);
  m.appendChild(body);
}

export function openCardDetail(id) {
  const t = activeTrip();
  const c = t && t.cards[id];
  if (!c) return;
  const tp = TYPES[c.type] || TYPES.note;
  const isFlightLike = c.type === 'flight' || c.type === 'transit';
  const isPlaceLike = c.type === 'hotel' || c.type === 'activity' || c.type === 'meal';
  const palette = (c.type === 'cityStay' && c.color && CITY_STAY_COLORS[c.color])
    ? CITY_STAY_COLORS[c.color] : tp;

  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-card-detail' });

  // Header: type accent + icon + title + booked badge.
  const header = el('div', { class: 'vp-cd-head', style: { borderLeftColor: palette.color } });
  const titleRow = el('div', { class: 'vp-cd-titlerow' });
  titleRow.appendChild(el('i', { class: 'ti ' + tp.icon + ' vp-cd-icon', style: { color: palette.color }, 'aria-hidden': 'true' }));
  titleRow.appendChild(el('div', { class: 'vp-cd-title' }, c.title || tp.label));
  if (c.booked) titleRow.appendChild(el('span', { class: 'vp-cd-booked' }, '✓ Booked'));
  header.appendChild(titleRow);
  header.appendChild(el('div', { class: 'vp-cd-type' }, tp.label));
  m.appendChild(header);

  const website = (isPlaceLike || c.type === 'note') ? firstWebsiteUrl(c.notes) : '';

  // Real venue photo from Google Places for place-like cards (best-effort).
  if (isPlaceLike) {
    const photoWrap = el('div', { class: 'vp-cd-photo' });
    m.appendChild(photoWrap);
    loadPlacePhoto([c.title, c.city].filter(Boolean).join(', '), photoWrap);
  }

  // Essentials.
  const body = el('div', { class: 'vp-cd-body' });
  function row(label, value) {
    if (value == null || value === '') return;
    const r = el('div', { class: 'vp-cd-row' });
    r.appendChild(el('span', { class: 'vp-cd-label' }, label));
    r.appendChild(el('span', { class: 'vp-cd-val' }, value));
    body.appendChild(r);
  }

  if (isFlightLike) {
    body.appendChild(el('div', { class: 'vp-cd-route' }, (c.originCity || '?') + ' → ' + (c.destCity || '?')));
    if (c.flightNo) row(c.type === 'flight' ? 'Flight' : 'Carrier', c.flightNo);
    if (c.depart) row('Depart', fmtDateTime(c.depart) + (c.originCity ? ' · ' + c.originCity : ''));
    if (c.arrive) {
      const nd = overnightDays(c.depart, c.arrive);
      row('Arrive', fmtDateTime(c.arrive) + (c.destCity ? ' · ' + c.destCity : '') + (nd > 0 ? '  (+' + nd + 'd)' : ''));
    }
    if (c.pointsCost > 0) row('Points', Math.round(c.pointsCost).toLocaleString() + (c.pointsProgram ? ' ' + c.pointsProgram : ''));
    if (c.cost > 0) row(c.pointsCost > 0 ? 'Taxes / cash' : 'Cost', '$' + Math.round(c.cost).toLocaleString());
  } else if (c.type === 'cityStay') {
    row('City', c.city);
    if (c.nights) row('Nights', c.nights + (c.nights == 1 ? ' night' : ' nights'));
  } else if (c.type !== 'note') {
    row('City', c.city);
    if (c.time) row('Time', c.time);
    if (c.type === 'hotel' && c.nights) row('Nights', c.nights + (c.nights == 1 ? ' night' : ' nights'));
    if (c.cost > 0) row('Cost', '$' + Math.round(c.cost).toLocaleString());
  }
  if (body.children.length) m.appendChild(body);

  // Website link.
  if (website) {
    m.appendChild(el('div', { class: 'vp-cd-links' },
      el('a', { href: website, target: '_blank', rel: 'noopener noreferrer', class: 'vp-cd-link' },
        el('i', { class: 'ti ti-world', 'aria-hidden': 'true' }), 'Website')));
  }

  // Lounges (flights, collapsible).
  if (isFlightLike) appendLounges(m, c);

  // Notes (linkified).
  if (c.notes && c.notes.trim()) {
    m.appendChild(el('div', { class: 'vp-cd-section' }, 'Notes'));
    m.appendChild(linkifyNotes(c.notes));
  }

  // Attachments (openable chips).
  if (c.attachments && c.attachments.length) {
    m.appendChild(el('div', { class: 'vp-cd-section' }, 'Attachments'));
    const chips = el('div', { class: 'vp-cd-attach' });
    c.attachments.forEach(a => {
      chips.appendChild(el('button', { class: 'vp-cd-attach-chip', onclick: () => openAttachment(a.path) },
        el('i', { class: 'ti ti-file', 'aria-hidden': 'true' }), el('span', {}, a.name)));
    });
    m.appendChild(chips);
  }

  // Actions: Delete (left) — Navigate / Flight status / Edit (right).
  const actions = el('div', { class: 'vp-modal-actions' });
  const left = el('div', { style: { display: 'flex', gap: '8px' } });
  left.appendChild(el('button', {
    class: 'vp-delete',
    onclick: () => confirmDialog('Delete this card?', { danger: true, confirmText: 'Delete' })
      .then(ok => { if (ok) { removeCard(id); bg.remove(); } })
  }, 'Delete'));
  actions.appendChild(left);

  const right = el('div', { class: 'vp-right' });
  if (isPlaceLike) {
    const nav = cardNavUrl(c);
    if (nav) right.appendChild(el('a', {
      href: nav, target: '_blank', rel: 'noopener noreferrer', class: 'vp-cd-actionlink'
    }, el('i', { class: 'ti ti-navigation', 'aria-hidden': 'true' }), 'Navigate'));
  }
  if (c.type === 'flight') {
    const fs = flightStatusUrl(c);
    if (fs) right.appendChild(el('a', {
      href: fs, target: '_blank', rel: 'noopener noreferrer', class: 'vp-cd-actionlink'
    }, el('i', { class: 'ti ti-plane', 'aria-hidden': 'true' }), 'Flight status'));
  }
  right.appendChild(el('button', { class: 'vp-save', onclick: () => { bg.remove(); openEditor(id); } }, 'Edit'));
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
}
