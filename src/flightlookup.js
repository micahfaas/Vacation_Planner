// Flight lookup via AeroDataBox (RapidAPI). The key is read from the
// VITE_AERODATABOX_KEY env var; when it is absent the lookup UI stays hidden.
const KEY = import.meta.env.VITE_AERODATABOX_KEY;
const HOST = 'aerodatabox.p.rapidapi.com';

export function flightLookupEnabled() {
  return !!KEY;
}

// AeroDataBox times look like "2024-06-01 14:30-04:00" (local) — pull out
// just the date and HH:MM for a datetime-local input.
function localDateTime(timeObj) {
  const s = (timeObj && (timeObj.local || timeObj.utc)) || '';
  const m = s.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? m[1] + 'T' + m[2] : '';
}

function endpoint(side) {
  const ap = (side && side.airport) || {};
  const loc = ap.location || {};
  return {
    city: ap.municipalityName || ap.shortName || ap.name || '',
    timezone: ap.timeZone || '',
    lat: typeof loc.lat === 'number' ? loc.lat : null,
    lng: typeof loc.lon === 'number' ? loc.lon : null,
    dt: localDateTime(side && (side.revisedTime || side.scheduledTime))
  };
}

// Look up a flight by number and date ("YYYY-MM-DD").
// Resolves to { flightNo, airline, origin, dest } or throws a friendly error.
export async function lookupFlight(flightNumber, date) {
  if (!KEY) throw new Error('Flight lookup is not configured.');
  const num = flightNumber.replace(/\s+/g, '').toUpperCase();
  const url = 'https://' + HOST + '/flights/number/' +
    encodeURIComponent(num) + '/' + encodeURIComponent(date);

  let res;
  try {
    res = await fetch(url, { headers: { 'X-RapidAPI-Key': KEY, 'X-RapidAPI-Host': HOST } });
  } catch {
    throw new Error('Network error during flight lookup.');
  }
  if (res.status === 404) throw new Error('No flight found for that number and date.');
  if (res.status === 401 || res.status === 403) throw new Error('Flight API key was rejected.');
  if (res.status === 429) throw new Error('Flight API rate limit reached — try again later.');
  if (!res.ok) throw new Error('Flight lookup failed (' + res.status + ').');

  const data = await res.json();
  const flights = Array.isArray(data) ? data : (data && data.flights) || [];
  if (!flights.length) throw new Error('No flight found for that number and date.');

  const f = flights[0];
  return {
    flightNo: (f.number || num).replace(/\s+/g, ''),
    airline: (f.airline && f.airline.name) || '',
    origin: endpoint(f.departure),
    dest: endpoint(f.arrival)
  };
}
