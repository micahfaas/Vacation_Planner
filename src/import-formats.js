// Parsers that turn imported content into card "candidates" for the review
// screen. A candidate is { type, card, date, label, include } where `card`
// is a partial card object, `date` is an ISO anchor (or null for the
// library), and `label` is a short human description.
import { unzipSync, strFromU8 } from 'fflate';

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function pad2(n) { return String(n).padStart(2, '0'); }

function daysBetween(aISO, bISO) {
  return Math.round((Date.parse(bISO) - Date.parse(aISO)) / 86400000);
}

// Pull ISO dates out of free text in a few common written formats.
function findDates(text) {
  const out = [];
  let m;
  let re = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = re.exec(text))) out.push(m[1] + '-' + m[2] + '-' + m[3]);
  re = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g;
  while ((m = re.exec(text))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) out.push(m[3] + '-' + pad2(mo) + '-' + pad2(m[1]));
  }
  re = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g;
  while ((m = re.exec(text))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) out.push(m[3] + '-' + pad2(mo) + '-' + pad2(m[2]));
  }
  return out;
}

// ---------- heuristic free-text parsing ----------
export function parseText(text) {
  const cands = [];
  const dates = findDates(text);
  const seen = new Set();
  let m;
  const re = /\b([A-Z]{2})\s?(\d{1,4})\b/g;
  while ((m = re.exec(text))) {
    const code = m[1] + m[2];
    if (seen.has(code)) continue;
    seen.add(code);
    cands.push({
      type: 'flight',
      date: dates[0] || null,
      card: { type: 'flight', title: 'Flight ' + code, flightNo: code, notes: '' },
      label: 'Flight ' + code,
      include: true
    });
  }
  if (/check[\s-]?in/i.test(text) && dates.length) {
    const nights = dates.length >= 2 ? Math.max(1, daysBetween(dates[0], dates[1])) : 1;
    cands.push({
      type: 'hotel',
      date: dates[0],
      card: { type: 'hotel', title: 'Hotel stay', nights, notes: '' },
      label: 'Hotel stay — ' + nights + (nights === 1 ? ' night' : ' nights'),
      include: true
    });
  }
  if (!cands.length) {
    cands.push({
      type: 'note',
      date: null,
      card: { type: 'note', title: 'Imported note', notes: text.trim().slice(0, 2000) },
      label: 'Note from pasted text',
      include: true
    });
  }
  return cands;
}

// ---------- .ics calendar parsing ----------
function icsUnescape(v) {
  return (v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// "20260603" or "20260603T140000(Z)" -> { date, time }. TZID/UTC offsets
// are treated as wall-clock; the review screen lets the user correct.
function icsWhen(v) {
  const m = (v || '').match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return null;
  return { date: m[1] + '-' + m[2] + '-' + m[3], time: m[4] ? m[4] + ':' + m[5] : '' };
}

// Classify an event from any source and build a card candidate.
// `start` / `end` are { date, time } objects, or null.
function classifyAndBuild(summary, loc, desc, start, end) {
  summary = (summary || 'Imported event').trim();
  loc = loc || '';
  desc = desc || '';
  if (!start) {
    return { type: 'note', date: null, card: { type: 'note', title: summary, notes: desc }, label: summary, include: true };
  }
  const s = summary.toLowerCase();
  let type = 'activity';
  if (/\bflight\b|airline|airways|\b[a-z]{2}\s?\d{2,4}\b/.test(s)) type = 'flight';
  else if (/hotel|hostel|\binn\b|resort|lodge|airbnb|check[\s-]?in|\bstay\b/.test(s)) type = 'hotel';
  else if (/dinner|lunch|breakfast|brunch|restaurant|reservation|caf[eé]/.test(s)) type = 'meal';
  else if (/train|\bbus\b|ferry|transfer|shuttle|\brail\b|transit/.test(s)) type = 'transit';

  if (type === 'flight') {
    return {
      type, date: start.date,
      card: {
        type: 'flight', title: summary,
        depart: start.time ? start.date + 'T' + start.time : '',
        arrive: (end && end.time) ? end.date + 'T' + end.time : '',
        notes: [loc, desc].filter(Boolean).join('\n')
      },
      label: summary, include: true
    };
  }
  if (type === 'hotel') {
    const nights = end ? Math.max(1, daysBetween(start.date, end.date)) : 1;
    return {
      type, date: start.date,
      card: { type: 'hotel', title: summary, city: loc, nights, notes: desc },
      label: summary + ' — ' + nights + (nights === 1 ? ' night' : ' nights'),
      include: true
    };
  }
  if (type === 'transit') {
    return {
      type, date: start.date,
      card: { type: 'transit', title: summary, notes: [loc, desc].filter(Boolean).join('\n') },
      label: summary, include: true
    };
  }
  return {
    type, date: start.date,
    card: { type, title: summary, city: loc, time: start.time, notes: desc },
    label: summary, include: true
  };
}

function eventToCandidate(ev) {
  return classifyAndBuild(
    icsUnescape(ev.SUMMARY), icsUnescape(ev.LOCATION), icsUnescape(ev.DESCRIPTION),
    icsWhen(ev.DTSTART), icsWhen(ev.DTEND)
  );
}

export function parseICS(text) {
  const unfolded = (text || '').replace(/\r?\n[ \t]/g, '');
  const events = [];
  let cur = null;
  unfolded.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') { cur = {}; return; }
    if (trimmed === 'END:VEVENT') { if (cur) events.push(cur); cur = null; return; }
    if (!cur) return;
    const idx = line.indexOf(':');
    if (idx < 0) return;
    const name = line.slice(0, idx).split(';')[0].trim().toUpperCase();
    if (!(name in cur)) cur[name] = line.slice(idx + 1);
  });
  return events.map(eventToCandidate).filter(Boolean);
}

// ---------- IATA Bar Coded Boarding Pass (the barcode message string) ----------
// BCBP encodes the flight date as a day-of-year with no year; pick the year
// that puts the flight near the present rather than far in the past.
function julianToISO(julianStr) {
  const day = parseInt(julianStr, 10);
  if (!day || day < 1 || day > 366) return null;
  const now = new Date();
  let d = new Date(now.getFullYear(), 0, day);
  if ((now - d) / 86400000 > 30) d = new Date(now.getFullYear() + 1, 0, day);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function parseBCBP(str) {
  if (!str || (str[0] !== 'M' && str[0] !== 'S') || str.length < 47) return null;
  const pnr = str.slice(23, 30).trim();
  const from = str.slice(30, 33).trim();
  const to = str.slice(33, 36).trim();
  const carrier = str.slice(36, 39).trim();
  const flightNum = str.slice(39, 44).trim().replace(/^0+/, '');
  const date = julianToISO(str.slice(44, 47).trim());
  const seat = str.length >= 52 ? str.slice(48, 52).trim().replace(/^0+/, '') : '';
  const flightNo = (carrier + flightNum).replace(/\s+/g, '');
  if (!flightNo && !from && !to) return null;
  const notes = [];
  if (seat) notes.push('Seat ' + seat);
  if (pnr) notes.push('Confirmation ' + pnr);
  return {
    type: 'flight',
    date,
    card: {
      type: 'flight',
      title: flightNo ? 'Flight ' + flightNo : 'Flight',
      flightNo,
      originCity: from,
      destCity: to,
      notes: notes.join('\n')
    },
    label: (flightNo ? flightNo + ' · ' : '') + (from || '?') + ' → ' + (to || '?'),
    include: true
  };
}

// ---------- Apple/Google Wallet pass (.pkpass) ----------
function pkDate(s) {
  const m = (s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}

function passToCandidate(pass) {
  const org = pass.organizationName || '';
  const desc = pass.description || '';
  const barcodes = pass.barcodes || (pass.barcode ? [pass.barcode] : []);
  const msg = barcodes.length ? barcodes[0].message : '';
  const relDate = pkDate(pass.relevantDate);

  if (pass.boardingPass) {
    if (msg && /^[MS]\d/.test(msg)) {
      const bc = parseBCBP(msg);
      if (bc) {
        if (relDate) bc.date = relDate;
        if (org) bc.card.notes = [bc.card.notes, org].filter(Boolean).join('\n');
        return bc;
      }
    }
    return {
      type: 'flight', date: relDate,
      card: { type: 'flight', title: org ? org + ' flight' : 'Flight', notes: desc },
      label: (org ? org + ' — ' : '') + 'boarding pass', include: true
    };
  }
  if (pass.eventTicket) {
    return {
      type: 'activity', date: relDate,
      card: { type: 'activity', title: desc || org || 'Event', notes: org },
      label: desc || org || 'Event ticket', include: true
    };
  }
  return {
    type: 'note', date: relDate,
    card: { type: 'note', title: desc || org || 'Wallet pass', notes: org },
    label: desc || org || 'Wallet pass', include: true
  };
}

export function parsePkpass(arrayBuffer) {
  let files;
  try { files = unzipSync(new Uint8Array(arrayBuffer)); }
  catch { return []; }
  const passFile = files['pass.json'];
  if (!passFile) return [];
  let pass;
  try { pass = JSON.parse(strFromU8(passFile)); }
  catch { return []; }
  return [passToCandidate(pass)].filter(Boolean);
}

// ---------- Google Calendar API events ----------
function gcalWhen(point) {
  if (!point) return null;
  if (point.date) return { date: point.date, time: '' };
  const m = (point.dateTime || '').match(/(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  return m ? { date: m[1], time: m[2] + ':' + m[3] } : null;
}

// Keep only travel-relevant events, so ordinary calendar clutter
// (meetings, birthdays) does not flood the review screen.
export function parseGCalEvents(events) {
  return (events || [])
    .map(ev => classifyAndBuild(ev.summary, ev.location, ev.description, gcalWhen(ev.start), gcalWhen(ev.end)))
    .filter(c => c && ['flight', 'hotel', 'transit', 'meal'].includes(c.type));
}
