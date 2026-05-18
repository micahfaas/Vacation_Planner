// City search via the Open-Meteo geocoding API — free, no key, global
// coverage, and returns the IANA timezone for each result.
const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

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
