// Data layer. Trips live in Supabase (one JSONB row per trip); localStorage
// is kept as an offline fallback cache. Mutations call save(), which writes
// the cache immediately and debounces a push to the cloud.
import { data } from './state.js';
import { STORAGE_KEY } from './constants.js';
import { isoDate } from './dates.js';
import { browserTz } from './timezone.js';
import { supabase } from './supabase.js';

// Legacy flight/transit cards stored depart/arrive as plain wall-clock
// strings with no timezone. Default both ends to the browser timezone,
// which keeps their computed times identical to the pre-timezone behavior.
export function migrateCard(c) {
  if ((c.type === 'flight' || c.type === 'transit') && (c.depart || c.arrive) && !c.originTz) {
    const tz = browserTz();
    c.originTz = tz;
    c.destTz = tz;
    if (!c.originCity) c.originCity = c.city || '';
    if (!c.destCity) c.destCity = c.city || '';
  }
  return c;
}

let userId = null;
const dirty = new Set();    // trip ids needing an upsert
const deleted = new Set();  // trip ids needing a delete
let flushTimer = 0;

function cacheKey() { return 'vacation_planner_cache_' + userId; }
function activeKey() { return 'vacation_planner_active_' + userId; }

export function newTripId() { return crypto.randomUUID(); }

function defaultTrip() {
  const today = new Date();
  const end = new Date(today); end.setDate(end.getDate() + 13);
  return {
    id: newTripId(), name: 'My trip',
    startDate: isoDate(today), endDate: isoDate(end),
    cards: {}, schedule: {}, library: [], libFilter: 'all', nextId: 1
  };
}

function ensureTripFields(t) {
  if (!t.cards) t.cards = {};
  if (!t.schedule) t.schedule = {};
  if (!t.library) t.library = [];
  if (!t.libFilter) t.libFilter = 'all';
  if (!t.nextId) t.nextId = 1;
  Object.values(t.cards).forEach(migrateCard);
}

// Fetch the signed-in user's trips. Falls back to the local cache when the
// network is unavailable, and seeds a starter trip for brand-new accounts.
export async function loadTrips(uid) {
  userId = uid;
  data.trips = {};
  let loaded = false;
  try {
    const { data: rows, error } = await supabase
      .from('trips').select('id, data').eq('user_id', uid);
    if (error) throw error;
    if (rows && rows.length) {
      rows.forEach(r => { data.trips[r.id] = r.data; });
      loaded = true;
    } else {
      loaded = migrateLegacyTrips();
    }
  } catch (e) {
    console.warn('Cloud load failed; using local cache.', e);
    loadFromCache();
    loaded = Object.keys(data.trips).length > 0;
  }
  if (!loaded || Object.keys(data.trips).length === 0) {
    const t = defaultTrip();
    data.trips[t.id] = t;
    dirty.add(t.id);
    scheduleFlush();
  }
  Object.values(data.trips).forEach(ensureTripFields);
  reconcileActiveTrip();
  writeCache();
}

// One-time import of pre-accounts localStorage data into a fresh account.
function migrateLegacyTrips() {
  let legacy = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    legacy = raw ? JSON.parse(raw) : null;
  } catch { legacy = null; }
  let trips = [];
  if (legacy && legacy.trips) trips = Object.values(legacy.trips);
  else if (legacy && legacy.cards) trips = [Object.assign({ name: 'My trip', nextId: 1 }, legacy)];
  if (!trips.length) return false;
  trips.forEach(t => {
    t.id = newTripId();
    ensureTripFields(t);
    data.trips[t.id] = t;
    dirty.add(t.id);
  });
  scheduleFlush();
  return true;
}

function reconcileActiveTrip() {
  let active = null;
  try { active = localStorage.getItem(activeKey()); } catch { /* ignore */ }
  data.activeTripId = (active && data.trips[active])
    ? active
    : (Object.keys(data.trips)[0] || null);
}

function loadFromCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey()));
    if (parsed && parsed.trips) data.trips = parsed.trips;
  } catch { /* ignore */ }
}

function writeCache() {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ trips: data.trips }));
    if (data.activeTripId) localStorage.setItem(activeKey(), data.activeTripId);
  } catch { /* ignore */ }
}

// Persist a change. The active trip is marked dirty by default; callers that
// change another trip should call markTripDirty(id) first.
export function save() {
  if (data.activeTripId) dirty.add(data.activeTripId);
  writeCache();
  scheduleFlush();
}

export function markTripDirty(id) {
  if (id) dirty.add(id);
}

export function markTripDeleted(id) {
  if (!id) return;
  deleted.add(id);
  dirty.delete(id);
  scheduleFlush();
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 800);
}

async function flush() {
  if (!userId) return;
  const toUpsert = [...dirty].filter(id => data.trips[id]);
  const toDelete = [...deleted];
  dirty.clear();
  deleted.clear();
  try {
    if (toUpsert.length) {
      const rows = toUpsert.map(id => ({
        id, user_id: userId, data: data.trips[id], updated_at: new Date().toISOString()
      }));
      const { error } = await supabase.from('trips').upsert(rows);
      if (error) throw error;
    }
    if (toDelete.length) {
      const { error } = await supabase.from('trips').delete().in('id', toDelete);
      if (error) throw error;
    }
  } catch (e) {
    console.warn('Cloud sync failed; will retry.', e);
    toUpsert.forEach(id => dirty.add(id));
    toDelete.forEach(id => deleted.add(id));
    scheduleFlush();
  }
}
