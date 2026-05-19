// Weather outlook for saved places via the free Open-Meteo API (no key).
// Trips inside the 16-day window use the live forecast; trips further out
// fall back to the same dates a year earlier as a typical-conditions proxy.
import { isoDate, parseISO, addDays } from './dates.js';

const cache = new Map(); // key -> Promise<summary|null>

function shiftYear(iso, years) {
  const d = parseISO(iso);
  d.setFullYear(d.getFullYear() + years);
  return isoDate(d);
}

// Decide which API and date range to query for a trip's date window.
function pickPlan(startISO, endISO) {
  if (!startISO || !endISO || endISO < startISO) return null;
  const todayISO = isoDate(new Date());
  const horizonISO = isoDate(addDays(new Date(), 15));
  if (endISO < todayISO) {
    return { api: 'archive', kind: 'recorded', start: startISO, end: endISO };
  }
  if (startISO <= horizonISO) {
    return {
      api: 'forecast', kind: 'forecast',
      start: startISO < todayISO ? todayISO : startISO,
      end: endISO < horizonISO ? endISO : horizonISO
    };
  }
  return { api: 'archive', kind: 'typical', start: shiftYear(startISO, -1), end: shiftYear(endISO, -1) };
}

function summarize(daily, kind) {
  const max = daily.temperature_2m_max || [];
  const min = daily.temperature_2m_min || [];
  const precip = daily.precipitation_sum || [];
  const n = max.length;
  if (!n) return null;
  let sumHi = 0, sumLo = 0, rain = 0;
  for (let i = 0; i < n; i++) {
    sumHi += max[i] || 0;
    sumLo += min[i] || 0;
    if ((precip[i] || 0) > 1) rain++;
  }
  const ratio = rain / n;
  let icon = 'ti-sun';
  if (ratio > 0.5) icon = 'ti-cloud-rain';
  else if (ratio > 0.15) icon = 'ti-cloud';
  return {
    hi: Math.round(sumHi / n),
    lo: Math.round(sumLo / n),
    rainDays: rain,
    days: n,
    icon,
    kind
  };
}

// Resolves to { hi, lo, rainDays, days, icon, kind } in °F, or null.
export function weatherSummary(lat, lng, startISO, endISO) {
  const plan = pickPlan(startISO, endISO);
  if (!plan) return Promise.resolve(null);
  const key = [lat.toFixed(2), lng.toFixed(2), plan.api, plan.start, plan.end].join('|');
  if (cache.has(key)) return cache.get(key);

  const base = plan.api === 'archive'
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const url = base +
    '?latitude=' + lat + '&longitude=' + lng +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum' +
    '&temperature_unit=fahrenheit&precipitation_unit=mm&timezone=auto' +
    '&start_date=' + plan.start + '&end_date=' + plan.end;

  const p = fetch(url)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('weather ' + r.status))))
    .then(j => summarize(j.daily || {}, plan.kind))
    .catch(() => null);
  cache.set(key, p);
  return p;
}
