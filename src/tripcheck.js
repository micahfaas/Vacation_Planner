// Trip-check: sends a compact trip summary to the trip-check Edge Function
// (which calls Claude) and renders the returned issues in a modal. Cached
// per-trip by a content hash so re-opening the panel without changes is free.
import { supabase } from './supabase.js';
import { activeTrip } from './state.js';
import { el } from './dom.js';

// Cache last result per trip id, keyed by a content hash of the summary we
// sent. If the trip changes, the hash changes and we re-fetch on the next
// open. djb2 is enough for change detection — no security need.
const cache = new Map();

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

// Strip the active trip down to the fields the model actually uses. Drops
// library/nextId noise, internal ids on the schedule, and any empty strings
// to keep the prompt cheap.
function compactTrip(t) {
  const cards = Object.values(t.cards || {}).map(c => {
    const out = { id: c.id, type: c.type, title: c.title };
    ['date', 'time', 'city', 'originCity', 'destCity', 'flightNo',
     'depart', 'arrive', 'nights', 'notes', 'booked'].forEach(k => {
      if (c[k] !== undefined && c[k] !== '' && c[k] !== null) out[k] = c[k];
    });
    return out;
  });
  const schedule = {};
  Object.keys(t.schedule || {}).forEach(d => {
    const ids = (t.schedule[d] || []).filter(Boolean);
    if (ids.length) schedule[d] = ids;
  });
  return {
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
    cards,
    schedule
  };
}

async function fetchIssues(trip) {
  const summary = compactTrip(trip);
  const key = hash(JSON.stringify(summary));
  const cached = cache.get(trip.id);
  if (cached && cached.key === key) return cached.issues;

  let res;
  try {
    res = await supabase.functions.invoke('trip-check', { body: { trip: summary } });
  } catch {
    throw new Error('Could not reach the trip-check service.');
  }
  if (res.error) throw new Error('The trip-check service failed.');
  const data = res.data;
  if (!data || data.ok !== true) {
    throw new Error((data && data.error) || 'Trip check failed.');
  }
  const issues = Array.isArray(data.issues) ? data.issues : [];
  cache.set(trip.id, { key, issues });
  return issues;
}

const CATEGORY_LABEL = {
  timing: 'Timing',
  logistics: 'Logistics',
  closure: 'Closure',
  visa: 'Visa / passport',
  weather: 'Weather',
  jetlag: 'Jet lag',
  etiquette: 'Etiquette',
  other: 'Other'
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

function renderIssue(issue) {
  const wrap = el('div', { class: 'vp-tc-issue vp-tc-' + issue.severity });
  const head = el('div', { class: 'vp-tc-head' });
  head.appendChild(el('span', { class: 'vp-tc-badge vp-tc-badge-' + issue.severity }, issue.severity));
  head.appendChild(el('span', { class: 'vp-tc-cat' }, CATEGORY_LABEL[issue.category] || issue.category));
  if (issue.dayDate) head.appendChild(el('span', { class: 'vp-tc-day' }, issue.dayDate));
  wrap.appendChild(head);
  wrap.appendChild(el('div', { class: 'vp-tc-msg' }, issue.message));
  if (issue.suggestion) {
    wrap.appendChild(el('div', { class: 'vp-tc-fix' },
      el('strong', {}, 'Suggested fix: '), issue.suggestion));
  }
  return wrap;
}

function showModal(buildBody) {
  const bg = el('div', { class: 'vp-modal-bg' });
  const m = el('div', { class: 'vp-modal vp-tc-modal' });
  bg.appendChild(m);
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });

  const header = el('div', { class: 'vp-tc-modal-head' });
  header.appendChild(el('h3', {}, 'Trip check'));
  const close = el('button', { class: 'vp-tc-close', onclick: () => bg.remove() }, '×');
  header.appendChild(close);
  m.appendChild(header);

  const body = el('div', { class: 'vp-tc-body' });
  m.appendChild(body);
  buildBody(body, bg);

  document.body.appendChild(bg);
  return { bg, body };
}

export async function openTripCheck() {
  const t = activeTrip();
  if (!t) return;
  if (!t.startDate || !t.endDate) {
    const { body } = showModal(() => {});
    body.appendChild(el('p', { class: 'vp-tc-empty' },
      'Set trip dates first — there isn\'t enough to check yet.'));
    return;
  }
  const cardCount = Object.keys(t.cards || {}).length;
  if (cardCount === 0) {
    const { body } = showModal(() => {});
    body.appendChild(el('p', { class: 'vp-tc-empty' },
      'Add a flight, hotel, or activity first — there isn\'t anything to check yet.'));
    return;
  }

  const { body } = showModal(() => {});
  body.appendChild(el('p', { class: 'vp-tc-loading' }, 'Looking your trip over…'));

  let issues;
  try {
    issues = await fetchIssues(t);
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'vp-tc-error' }, e.message || 'Something went wrong.'));
    return;
  }

  body.innerHTML = '';
  if (!issues.length) {
    body.appendChild(el('p', { class: 'vp-tc-clean' },
      'No issues spotted. Your trip looks well-planned.'));
    return;
  }
  issues.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  issues.forEach(i => body.appendChild(renderIssue(i)));
}
