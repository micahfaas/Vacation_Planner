// Derived/computed views over trip state: day ranges, stats, conflicts.
import { activeTrip } from './state.js';
import { isoDate, parseISO, addDays, timeToMin } from './dates.js';
import { wallClockToUTC } from './timezone.js';

// Real UTC duration (ms) of a flight/transit card. depart/arrive are
// wall-clock strings local to the origin and destination respectively.
function legUTC(c) {
  if (!c.depart || !c.arrive) return null;
  let dep, arr;
  if ((c.type === 'flight' || c.type === 'transit') && c.originTz && c.destTz) {
    dep = wallClockToUTC(c.depart, c.originTz);
    arr = wallClockToUTC(c.arrive, c.destTz);
  } else {
    dep = new Date(c.depart).getTime();
    arr = new Date(c.arrive).getTime();
  }
  if (Number.isNaN(dep) || Number.isNaN(arr)) return null;
  return { dep, arr };
}

export function getDays() {
  const t = activeTrip();
  const out = [];
  if (!t.startDate || !t.endDate) return out;
  const start = parseISO(t.startDate);
  const end = parseISO(t.endDate);
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d));
  return out;
}

export function getGridDays() {
  const days = getDays();
  if (days.length === 0) return [];
  const first = days[0]; const last = days[days.length - 1];
  const padBefore = first.getDay();
  const padAfter = 6 - last.getDay();
  const out = [];
  for (let i = padBefore; i > 0; i--) out.push({ d: addDays(first, -i), out: true });
  days.forEach(d => out.push({ d, out: false }));
  for (let i = 1; i <= padAfter; i++) out.push({ d: addDays(last, i), out: true });
  return out;
}

export function computeStats() {
  const t = activeTrip();
  const days = getDays();
  const totalDays = days.length;
  const filled = days.filter(d => (t.schedule[isoDate(d)] || []).length > 0).length;
  const cityNights = {};
  let totalFlightMin = 0, totalTransitMin = 0;
  let totalCards = 0, bookedCards = 0;
  // count every scheduled card (including library? no - just scheduled)
  Object.values(t.schedule).forEach(ids => {
    ids.forEach(id => {
      const c = t.cards[id]; if (!c) return;
      totalCards++;
      if (c.booked) bookedCards++;
    });
  });
  days.forEach(d => {
    const ids = t.schedule[isoDate(d)] || [];
    ids.forEach(id => {
      const c = t.cards[id]; if (!c) return;
      if (c.type === 'hotel' && c.city) {
        cityNights[c.city] = (cityNights[c.city] || 0) + (parseInt(c.nights) || 1);
      }
      if (c.type === 'flight' || c.type === 'transit') {
        const leg = legUTC(c);
        if (leg) {
          const m = (leg.arr - leg.dep) / 60000;
          if (m > 0 && m < 60 * 48) {
            if (c.type === 'flight') totalFlightMin += m;
            else totalTransitMin += m;
          }
        }
      }
    });
  });
  return { totalDays, filled, unaccounted: totalDays - filled, cityNights, totalFlightMin, totalTransitMin, totalCards, bookedCards };
}

export function getConflicts() {
  const t = activeTrip();
  const out = {};
  Object.keys(t.schedule).forEach(date => {
    const ids = t.schedule[date];
    const intervals = [];
    ids.forEach(id => {
      const c = t.cards[id]; if (!c) return;
      const leg = legUTC(c);
      if (leg) {
        intervals.push([leg.dep, leg.arr, c]);
      } else if (c.time) {
        const a = parseISO(date).getTime() + timeToMin(c.time) * 60000;
        intervals.push([a, a + 60 * 60000, c]);
      }
    });
    let conflict = false;
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        if (intervals[i][0] < intervals[j][1] && intervals[j][0] < intervals[i][1]) conflict = true;
      }
    }
    if (conflict) out[date] = true;
  });
  return out;
}
