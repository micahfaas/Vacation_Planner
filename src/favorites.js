// Cross-trip favorite places. Each user has a single row in public.favorites
// whose JSONB holds { places: [...] }, the pool of starred places they can
// drop into any trip's research list.
import { supabase } from './supabase.js';
import { getUserId } from './storage.js';
import { el } from './dom.js';
import { PLACE_CATEGORIES } from './constants.js';

let cached = { places: [] };
const CACHE_KEY = 'vacation_planner_favs_';

function readCache(uid) {
  try {
    const raw = localStorage.getItem(CACHE_KEY + uid);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.places)) return parsed;
  } catch { /* ignore */ }
  return { places: [] };
}

function writeCache(uid, data) {
  try { localStorage.setItem(CACHE_KEY + uid, JSON.stringify(data)); } catch { /* ignore */ }
}

export async function loadFavorites(uid) {
  cached = readCache(uid);
  try {
    const { data, error } = await supabase
      .from('favorites').select('data').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (data && data.data && Array.isArray(data.data.places)) {
      cached = { places: data.data.places };
      writeCache(uid, cached);
    }
  } catch (e) {
    console.warn('Favorites load failed; using cache.', e);
  }
  return cached;
}

export function getFavorites() { return cached.places.slice(); }

async function persist() {
  const uid = getUserId();
  writeCache(uid, cached);
  if (!uid) return;
  const { error } = await supabase.from('favorites').upsert({
    user_id: uid, data: cached, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

// Strip trip-only fields and copy a place into the favorites pool.
// Resolves with the new favorite's id, which the caller stamps onto the
// source place so the star toggle can find the linked entry later.
export async function addFavorite(place) {
  const id = crypto.randomUUID();
  const snap = {
    id,
    name: place.name || 'Place',
    category: place.category || 'other',
    address: place.address || '',
    city: place.city || '',
    url: place.url || '',
    website: place.website || '',
    notes: place.notes || '',
    savedAt: new Date().toISOString()
  };
  if (typeof place.lat === 'number' && typeof place.lng === 'number') {
    snap.lat = place.lat;
    snap.lng = place.lng;
  }
  cached.places.push(snap);
  await persist();
  return id;
}

export async function removeFavorite(id) {
  cached.places = cached.places.filter(f => f.id !== id);
  await persist();
}

export function isFavoriteId(id) {
  return !!id && cached.places.some(f => f.id === id);
}

// A low-visibility, read-only view of every starred place across all trips.
// Opened from the More menu. The star toggle on any place card feeds this pool.
export function openSavedPlaces() {
  const favs = getFavorites().slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal' });
  m.appendChild(el('h3', {}, 'Saved places'));
  m.appendChild(el('p', { class: 'vp-profile-sub' },
    'Everything you’ve starred, across all your trips. Add any of them to a trip from the Places tab’s “From favorites”.'));

  if (!favs.length) {
    m.appendChild(el('div', { class: 'vp-places-empty' },
      'No saved places yet. Tap the star on any place to save it here for next time.'));
  } else {
    const list = el('div', { class: 'vp-saved-list' });
    favs.forEach(f => {
      const cat = PLACE_CATEGORIES[f.category] || PLACE_CATEGORIES.other;
      const row = el('div', { class: 'vp-saved-item' });
      row.appendChild(el('i', { class: 'ti ' + cat.icon + ' vp-saved-icon', 'aria-hidden': 'true' }));
      const txt = el('div', {});
      txt.appendChild(el('div', { style: { fontWeight: 500 } }, f.name || 'Place'));
      const sub = [f.city, f.address].filter(Boolean).join(' · ');
      if (sub) txt.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-2)' } }, sub));
      row.appendChild(txt);
      list.appendChild(row);
    });
    m.appendChild(list);
  }

  const actions = el('div', { class: 'vp-modal-actions' });
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Close'));
  actions.appendChild(right);
  m.appendChild(actions);
  bg.appendChild(m);
  document.body.appendChild(bg);
}
