// Cross-trip favorite places. Each user has a single row in public.favorites
// whose JSONB holds { places: [...] }, the pool of starred places they can
// drop into any trip's research list.
import { supabase } from './supabase.js';
import { getUserId } from './storage.js';

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
