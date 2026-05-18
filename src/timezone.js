// Timezone math built on Intl — converts a wall-clock time in a given IANA
// zone to a real UTC instant, so flight durations across timezones are correct.

export function browserTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Offset (minutes) of `timeZone` at the given UTC instant.
// Positive means the local wall clock is ahead of UTC.
function tzOffsetMinutes(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const asIfUTC = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    hour,
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );
  return Math.round((asIfUTC - utcMs) / 60000);
}

// Interpret a 'YYYY-MM-DDTHH:MM' wall-clock string as local time in `timeZone`
// and return the corresponding UTC epoch milliseconds. Returns NaN on bad input.
export function wallClockToUTC(wallStr, timeZone) {
  if (!wallStr || !timeZone) return NaN;
  const [datePart, timePart] = wallStr.split('T');
  if (!datePart || !timePart) return NaN;
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  if ([y, mo, d, h, mi].some(n => Number.isNaN(n))) return NaN;
  // Treat the wall components as if UTC for a first guess, then correct by the
  // zone's offset. A second pass settles DST-boundary cases.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - tzOffsetMinutes(guess, timeZone) * 60000;
  utc = guess - tzOffsetMinutes(utc, timeZone) * 60000;
  return utc;
}
