// AI-powered import parsing. Sends messy text to the parse-import Edge
// Function (which calls Claude) and converts the structured cards it returns
// into review-screen candidates. Callers fall back to the rule-based parser
// in import-formats.js when this throws.
import { supabase } from './supabase.js';
import { isoDate } from './dates.js';

const TYPES = ['flight', 'hotel', 'activity', 'transit', 'meal', 'note'];

function isoD(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null; }
function isoDT(s) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s || '') ? s.slice(0, 16) : '';
}

// Short human description for the review list.
function labelFor(type, card) {
  if (type === 'flight' || type === 'transit') {
    const route = [card.originCity, card.destCity].filter(Boolean).join(' → ');
    return [card.flightNo, route].filter(Boolean).join(' · ') || card.title;
  }
  if (type === 'hotel') {
    const n = card.nights || 1;
    return card.title + ' — ' + n + (n === 1 ? ' night' : ' nights');
  }
  return card.title;
}

// One AI card -> a review candidate { type, card, date, label, include }.
// Shared by the import parser and the co-planner.
export function aiCardToCandidate(c) {
  if (!c || typeof c !== 'object') return null;
  const type = TYPES.includes(c.type) ? c.type : 'note';
  const card = { type, title: (c.title || '').trim() || 'Imported item' };
  if (c.notes) card.notes = String(c.notes).trim();
  if (c.booked) card.booked = true;

  let date = isoD(c.date);

  if (type === 'flight' || type === 'transit') {
    if (c.flightNo) card.flightNo = String(c.flightNo).trim();
    if (c.originCity) card.originCity = String(c.originCity).trim();
    if (c.destCity) card.destCity = String(c.destCity).trim();
    card.depart = isoDT(c.depart);
    card.arrive = isoDT(c.arrive);
    if (!date && card.depart) date = card.depart.slice(0, 10);
  } else if (type === 'hotel') {
    if (c.city) card.city = String(c.city).trim();
    card.nights = Math.max(1, parseInt(c.nights, 10) || 1);
  } else {
    if (c.city) card.city = String(c.city).trim();
    if ((type === 'activity' || type === 'meal') && /^\d{2}:\d{2}$/.test(c.time || '')) {
      card.time = c.time;
    }
  }

  return { type, card, date, label: labelFor(type, card), include: true };
}

// Parse free text into review candidates via Claude. Throws on any failure
// (offline, function down, AI not configured) so the caller can fall back.
export async function parseWithAI(text) {
  const today = isoDate(new Date());
  let res;
  try {
    res = await supabase.functions.invoke('parse-import', {
      body: { text: 'Today is ' + today + '.\n\n' + text }
    });
  } catch {
    throw new Error('Could not reach the AI import service.');
  }
  if (res.error) throw new Error('The AI import service failed.');

  const data = res.data;
  if (!data || data.ok !== true) {
    throw new Error((data && data.error) || 'The AI could not read that text.');
  }
  return (Array.isArray(data.cards) ? data.cards : []).map(aiCardToCandidate).filter(Boolean);
}
