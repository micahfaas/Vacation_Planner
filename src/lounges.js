// Lounge access lookup. Maps a flight card's origin/destination cities to
// airports, then filters the curated lounge list by the user's selected
// cards and elite statuses. Pure data + functions — no DOM, no module-level
// dependency on the profile (callers pass the profile object explicitly to
// avoid a circular import with profile.js).
import LOUNGES_DATA from './data/lounges.json';
import CATALOG_DATA from './data/lounge-catalog.json';

export const LOUNGES = LOUNGES_DATA.airports || {};
export const CITY_TO_AIRPORTS = LOUNGES_DATA.cityToAirports || {};
export const CARDS = (CATALOG_DATA.cards || []).slice();
export const STATUSES = (CATALOG_DATA.statuses || []).slice();

const CARDS_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
const STATUSES_BY_ID = Object.fromEntries(STATUSES.map(s => [s.id, s]));

// Set of access tags the given profile unlocks across all its cards + statuses.
export function userAccessTags(profile) {
  const tags = new Set();
  if (!profile) return tags;
  (profile.loungeCards || []).forEach(id => {
    const c = CARDS_BY_ID[id];
    if (c) c.unlocks.forEach(t => tags.add(t));
  });
  (profile.loungeStatuses || []).forEach(id => {
    const s = STATUSES_BY_ID[id];
    if (s) s.unlocks.forEach(t => tags.add(t));
  });
  return tags;
}

// Resolve a city name to one or more IATA codes. Match is case-insensitive
// and tolerant of light variants. Returns [] for unknown cities.
export function airportsForCity(city) {
  if (!city) return [];
  const direct = CITY_TO_AIRPORTS[city];
  if (direct) return direct.slice();
  const lower = city.trim().toLowerCase();
  for (const k of Object.keys(CITY_TO_AIRPORTS)) {
    if (k.toLowerCase() === lower) return CITY_TO_AIRPORTS[k].slice();
  }
  return [];
}

// Lounges at a single airport that the user can access. Returns [] if the
// airport isn't curated or no lounges match.
export function loungesAtAirport(iata, tags) {
  const list = LOUNGES[iata] || [];
  return list.filter(l => l.access && l.access.some(t => tags.has(t)));
}

// All eligible lounges for a flight card, grouped by airport. Looks up both
// the origin and destination cities. Pass the user profile (from
// getProfile()) so this module stays decoupled from profile.js.
export function eligibleLoungesForFlight(card, profile) {
  if (!card || (card.type !== 'flight' && card.type !== 'transit')) return [];
  const accessTags = userAccessTags(profile);
  if (!accessTags.size) return [];

  const cities = [
    { side: 'departure', city: card.originCity },
    { side: 'arrival', city: card.destCity }
  ];
  const out = [];
  for (const { side, city } of cities) {
    const airports = airportsForCity(city);
    for (const iata of airports) {
      const matches = loungesAtAirport(iata, accessTags);
      if (matches.length) out.push({ side, city, iata, lounges: matches });
    }
  }
  return out;
}

// All eligible lounges across an entire trip's flight cards.
// Useful for an "All lounges this trip" summary. Deduplicates by airport.
export function eligibleLoungesForTrip(trip, profile) {
  if (!trip) return [];
  const accessTags = userAccessTags(profile);
  if (!accessTags.size) return [];
  const seen = new Map();
  Object.values(trip.cards || {}).forEach(c => {
    if (c.type !== 'flight' && c.type !== 'transit') return;
    eligibleLoungesForFlight(c, profile).forEach(g => {
      if (!seen.has(g.iata)) seen.set(g.iata, { iata: g.iata, city: g.city, lounges: g.lounges });
    });
  });
  return Array.from(seen.values());
}

// True if the profile has any cards/statuses selected.
export function hasLoungeProfile(profile) {
  if (!profile) return false;
  return (profile.loungeCards || []).length > 0 || (profile.loungeStatuses || []).length > 0;
}
