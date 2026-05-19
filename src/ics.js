// Export the active trip's scheduled cards as an .ics calendar file that
// imports into Apple Calendar, Google Calendar, Outlook, etc.
import { activeTrip } from './state.js';
import { TYPES } from './constants.js';
import { parseISO, addDays, isoDate } from './dates.js';

function pad(n) { return String(n).padStart(2, '0'); }

function icsDate(iso) {
  return iso.replace(/-/g, '');
}

// "YYYY-MM-DDTHH:MM" -> "YYYYMMDDTHHMMSS" (floating local time)
function icsDateTimeLocal(s) {
  const m = (s || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? m[1] + m[2] + m[3] + 'T' + m[4] + m[5] + '00' : '';
}

function icsStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 line folding — long lines wrap with CRLF + a leading space.
function fold(line) {
  if (line.length <= 73) return line;
  let out = '';
  let rest = line;
  while (rest.length > 73) {
    out += rest.slice(0, 73) + '\r\n ';
    rest = rest.slice(73);
  }
  return out + rest;
}

function cardLocation(c) {
  if (c.type === 'flight' || c.type === 'transit') {
    const a = c.originCity || '', b = c.destCity || '';
    return (a || b) ? (a || '?') + ' → ' + (b || '?') : '';
  }
  return c.city || '';
}

// { start, end } as full property lines, choosing a timed or all-day event.
function cardWhen(c, anchorISO) {
  if ((c.type === 'flight' || c.type === 'transit') && c.depart && c.arrive) {
    const s = icsDateTimeLocal(c.depart);
    const e = icsDateTimeLocal(c.arrive);
    if (s && e) return { start: 'DTSTART:' + s, end: 'DTEND:' + e };
  }
  if ((c.type === 'activity' || c.type === 'meal') && c.time) {
    const m = c.time.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      const [y, mo, d] = anchorISO.split('-').map(Number);
      const start = new Date(y, mo - 1, d, Number(m[1]), Number(m[2]));
      const end = new Date(start.getTime() + 60 * 60000);
      const fmt = dt => dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate()) +
        'T' + pad(dt.getHours()) + pad(dt.getMinutes()) + '00';
      return { start: 'DTSTART:' + fmt(start), end: 'DTEND:' + fmt(end) };
    }
  }
  // all-day event; hotels span their nights
  let days = 1;
  if (c.type === 'hotel') days = Math.max(1, parseInt(c.nights, 10) || 1);
  const endISO = isoDate(addDays(parseISO(anchorISO), days));
  return {
    start: 'DTSTART;VALUE=DATE:' + icsDate(anchorISO),
    end: 'DTEND;VALUE=DATE:' + icsDate(endISO)
  };
}

export function exportICS() {
  const t = activeTrip();
  const stamp = icsStamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vacation Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold('X-WR-CALNAME:' + esc(t.name || 'Trip'))
  ];

  let count = 0;
  Object.keys(t.schedule || {}).forEach(anchor => {
    (t.schedule[anchor] || []).forEach(id => {
      const c = t.cards[id];
      if (!c) return;
      const when = cardWhen(c, anchor);
      const tp = TYPES[c.type] || TYPES.note;
      const descBits = [];
      if (c.type === 'flight' && c.flightNo) descBits.push('Flight ' + c.flightNo);
      if (c.notes) descBits.push(c.notes);
      if (c.booked) descBits.push('Booked ✓');
      const loc = cardLocation(c);
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + id + '-' + anchor + '@vacation-planner');
      lines.push('DTSTAMP:' + stamp);
      lines.push(when.start);
      lines.push(when.end);
      lines.push(fold('SUMMARY:' + esc(c.title || tp.label)));
      if (loc) lines.push(fold('LOCATION:' + esc(loc)));
      if (descBits.length) lines.push(fold('DESCRIPTION:' + esc(descBits.join('\n'))));
      lines.push('END:VEVENT');
      count++;
    });
  });
  lines.push('END:VCALENDAR');

  if (!count) {
    alert('Nothing to export yet — drag some cards onto calendar days first.');
    return;
  }

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (t.name || 'trip').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() + '.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
