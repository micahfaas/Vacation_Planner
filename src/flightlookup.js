// Flight lookup via the flight-lookup Supabase Edge Function, which proxies
// AeroDataBox (RapidAPI) with the API key held server-side.
import { supabase } from './supabase.js';

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
  const num = flightNumber.replace(/\s+/g, '').toUpperCase();

  let res;
  try {
    res = await supabase.functions.invoke('flight-lookup', {
      body: { flightNumber: num, date }
    });
  } catch {
    throw new Error('Network error during flight lookup.');
  }
  if (res.error) throw new Error('Flight lookup failed — try again.');

  const data = res.data;
  if (!data || data.ok !== true) {
    throw new Error((data && data.error) || 'Flight lookup failed.');
  }
  const flights = Array.isArray(data.flights) ? data.flights : [];
  if (!flights.length) throw new Error('No flight found for that number and date.');

  const f = flights[0];
  return {
    flightNo: (f.number || num).replace(/\s+/g, ''),
    airline: (f.airline && f.airline.name) || '',
    origin: endpoint(f.departure),
    dest: endpoint(f.arrival)
  };
}
