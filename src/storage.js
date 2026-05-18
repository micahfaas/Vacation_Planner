// localStorage persistence and first-load bootstrapping/migration.
import { data } from './state.js';
import { STORAGE_KEY } from './constants.js';
import { isoDate } from './dates.js';

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.trips) {
        data.activeTripId = parsed.activeTripId;
        data.trips = parsed.trips;
      } else if (parsed && parsed.cards) {
        // legacy single-trip shape, migrate
        const id = 't' + Date.now();
        data.activeTripId = id;
        data.trips = { [id]: Object.assign({ id, name: 'My trip', nextId: 1 }, parsed) };
      }
    }
  } catch (e) {
    console.warn('Load failed', e);
  }
  if (!data.activeTripId || !data.trips[data.activeTripId]) {
    const id = 't' + Date.now();
    const today = new Date();
    const end = new Date(today); end.setDate(end.getDate() + 13);
    data.activeTripId = id;
    data.trips = {
      [id]: {
        id, name: 'My trip',
        startDate: isoDate(today), endDate: isoDate(end),
        cards: {}, schedule: {}, library: [],
        libFilter: 'all',
        nextId: 1
      }
    };
  }
  // ensure each trip has all required fields
  Object.values(data.trips).forEach(t => {
    if (!t.cards) t.cards = {};
    if (!t.schedule) t.schedule = {};
    if (!t.library) t.library = [];
    if (!t.libFilter) t.libFilter = 'all';
    if (!t.nextId) t.nextId = 1;
  });
  save();
}

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Save failed', e);
  }
}
