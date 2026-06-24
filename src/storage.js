// Data layer. Trips live in Supabase (one JSONB row per trip); localStorage
// is kept as an offline fallback cache. Mutations call save(), which writes
// the cache immediately and debounces a push to the cloud.
import { data } from './state.js';
import { STORAGE_KEY } from './constants.js';
import { isoDate } from './dates.js';
import { browserTz } from './timezone.js';
import { supabase } from './supabase.js';
import { toast } from './dom.js';

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
// trip id -> the updated_at we last saw from the server. Lets us detect when
// another device wrote the same trip between our load and our next write, so a
// stale tab can no longer silently overwrite newer work.
const loadedVersions = {};
let lastRefresh = 0;
let listenersWired = false;

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
  if (!t.places) t.places = [];
  if (!t.plan) t.plan = { drafts: [] };
  if (!t.resources) t.resources = { links: [], tickets: [] };
  if (!t.reminders) t.reminders = [];
  if (!t.packing) t.packing = [];
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
      .from('trips').select('id, data, updated_at').eq('user_id', uid);
    if (error) throw error;
    if (rows && rows.length) {
      rows.forEach(r => { data.trips[r.id] = r.data; loadedVersions[r.id] = r.updated_at; });
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
  wireSyncListeners();
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
  // Never land on an archived trip; fall back to the first non-archived one.
  const ok = active && data.trips[active] && !data.trips[active].archived;
  data.activeTripId = ok
    ? active
    : (Object.keys(data.trips).find(id => !data.trips[id].archived)
       || Object.keys(data.trips)[0] || null);
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

export function getUserId() { return userId; }

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
  const conflicts = [];
  try {
    for (const id of toUpsert) {
      const trip = data.trips[id];
      const stamp = new Date().toISOString();
      const base = loadedVersions[id];
      if (base) {
        // Only overwrite if no other device has written this trip since we
        // last saw it. The updated_at guard turns a blind last-write-wins
        // upsert into a detectable conflict.
        const { data: rows, error } = await supabase.from('trips')
          .update({ data: trip, updated_at: stamp })
          .eq('id', id).eq('user_id', userId).eq('updated_at', base)
          .select('updated_at');
        if (error) throw error;
        if (rows && rows.length) loadedVersions[id] = rows[0].updated_at;
        else conflicts.push(id);
      } else {
        // First sync of a locally-created trip: insert it (or adopt an
        // existing row of the same id, which only happens on a retry).
        const { data: rows, error } = await supabase.from('trips')
          .upsert({ id, user_id: userId, data: trip, updated_at: stamp })
          .select('updated_at');
        if (error) throw error;
        if (rows && rows.length) loadedVersions[id] = rows[0].updated_at;
      }
    }
    if (toDelete.length) {
      const { error } = await supabase.from('trips').delete().in('id', toDelete);
      if (error) throw error;
      toDelete.forEach(id => { delete loadedVersions[id]; });
    }
  } catch (e) {
    console.warn('Cloud sync failed; will retry.', e);
    toUpsert.forEach(id => dirty.add(id));
    toDelete.forEach(id => deleted.add(id));
    scheduleFlush();
    return;
  }
  if (conflicts.length) resolveConflicts(conflicts);
}

// A trip we tried to write had been changed on another device since we loaded
// it. Two JSONB snapshots cannot be safely merged, so we reload the server's
// version (never silently destroying synced work) and tell the user, who can
// re-apply a small change if needed. Refresh-on-focus makes this rare.
async function resolveConflicts(ids) {
  let rows;
  try {
    const res = await supabase.from('trips')
      .select('id, data, updated_at').in('id', ids).eq('user_id', userId);
    if (res.error) throw res.error;
    rows = res.data || [];
  } catch (e) {
    console.warn('Could not reload conflicting trips.', e);
    return;
  }
  const names = [];
  rows.forEach(r => {
    data.trips[r.id] = r.data;
    ensureTripFields(data.trips[r.id]);
    loadedVersions[r.id] = r.updated_at;
    if (r.data && r.data.name) names.push(r.data.name);
  });
  reconcileActiveTrip();
  writeCache();
  const { render } = await import('./render.js');
  render();
  const label = names.length ? '“' + names.join('”, “') + '”' : 'A trip';
  toast(label + ' was updated on another device, so the latest version was loaded here. Re-apply your change if it is missing.');
}

// Pull the latest trips from the cloud and fold in anything changed on another
// device, without disturbing edits still pending on this one. Runs when the
// app regains focus / visibility / connectivity, which closes the window where
// a stale tab would overwrite newer work.
export async function refreshFromCloud() {
  if (!userId || document.hidden || navigator.onLine === false) return;
  const now = Date.now();
  if (now - lastRefresh < 8000) return;
  lastRefresh = now;
  let rows;
  try {
    const res = await supabase.from('trips')
      .select('id, data, updated_at').eq('user_id', userId);
    if (res.error) throw res.error;
    rows = res.data || [];
  } catch {
    return; // offline or transient: keep the local copy
  }
  let changed = false;
  const remoteIds = new Set();
  rows.forEach(r => {
    remoteIds.add(r.id);
    if (dirty.has(r.id)) return;                  // don't clobber pending local edits
    if (loadedVersions[r.id] !== r.updated_at) {  // newer (or new) on the server
      data.trips[r.id] = r.data;
      ensureTripFields(data.trips[r.id]);
      loadedVersions[r.id] = r.updated_at;
      changed = true;
    }
  });
  // Trips removed on another device: drop locally only if we had synced them
  // and have no pending local edit/delete for them.
  Object.keys(data.trips).forEach(id => {
    if (!remoteIds.has(id) && loadedVersions[id] && !dirty.has(id) && !deleted.has(id)) {
      delete data.trips[id];
      delete loadedVersions[id];
      changed = true;
    }
  });
  if (changed) {
    reconcileActiveTrip();
    writeCache();
    const { render } = await import('./render.js');
    render();
  }
}

function wireSyncListeners() {
  if (listenersWired) return;
  listenersWired = true;
  document.addEventListener('visibilitychange', refreshFromCloud);
  window.addEventListener('focus', refreshFromCloud);
  window.addEventListener('online', refreshFromCloud);
}
