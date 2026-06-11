// City search via the Open-Meteo geocoding API — free, no key, global
// coverage, and returns the IANA timezone for each result. Used by the
// city picker.
//
// Place / address geocoding via OpenStreetMap Nominatim — also free, no
// key, and used to pin imported places on the Places map. Nominatim's
// usage policy is max 1 request per second; callers must space them out.
const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

// Search for cities matching `query`. Resolves to an array of normalized
// city objects, or [] for short queries. Throws on network failure.
export async function searchCities(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const url = `${ENDPOINT}?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding request failed: ' + res.status);
  const data = await res.json();
  return (data.results || []).map(r => ({
    name: r.name,
    admin1: r.admin1 || '',
    country: r.country || '',
    countryCode: r.country_code || '',
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone || '',
    population: r.population || 0,
    // "City, Region, Country" — Region disambiguates same-named places.
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', ')
  }));
}

// Geocode a free-form place query (e.g. "Café Tortoni, Av. de Mayo 825,
// Buenos Aires") to coordinates via OpenStreetMap Nominatim. Returns
// { lat, lng } or null when no result. Never throws.
export async function geocodePlace(query) {
  const q = (query || '').trim();
  if (!q) return null;
  const url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

// Reverse-geocode coordinates to a human address via Nominatim. Used to
// prefill the address (and an explicit city) when a place is pinned from a
// Google Maps link, which carries coordinates but no street address. Returns
// { address, city } or null. Never throws.
export async function reverseGeocode(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const url = `${NOMINATIM_REVERSE}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.county || '';
    // Compact one-line address rather than Nominatim's long display_name.
    const street = [a.road, a.house_number].filter(Boolean).join(' ').trim();
    const parts = [street, city, a.state, a.country].filter(Boolean);
    const address = parts.length ? parts.join(', ') : (data.display_name || '');
    if (!address) return null;
    return { address, city };
  } catch {
    return null;
  }
}
