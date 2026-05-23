// Transfer-partner advisor (static). Maps the user's free-text points
// balances and a draft's free-text award programs onto a curated graph of
// flexible bank currencies → airline programs, so the Plan sidebar can say
// "you hold Chase UR, which transfers 1:1 into the United miles this leg
// needs." Flights-only by design; data lives in data/transfer-partners.json.
import data from './data/transfer-partners.json';

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Build alias → entry lookups once. Aliases are sorted longest-first so the
// most specific match wins (e.g. "amex mr" before "amex").
function buildIndex(entries) {
  const rows = [];
  entries.forEach(e => {
    const aliases = [e.name, ...(e.aliases || [])].map(norm).filter(Boolean);
    aliases.forEach(a => rows.push({ alias: a, entry: e }));
  });
  rows.sort((x, y) => y.alias.length - x.alias.length);
  return rows;
}

const PROGRAM_INDEX = buildIndex(data.programs);
const CURRENCY_INDEX = buildIndex(data.currencies);
const PROGRAM_BY_ID = new Map(data.programs.map(p => [p.id, p]));

// Match free text against an index. Exact normalized hit first, otherwise the
// longest alias that appears as a whole-word run inside the text.
function match(text, index) {
  const t = norm(text);
  if (!t) return null;
  for (const { alias, entry } of index) {
    if (t === alias) return entry;
  }
  for (const { alias, entry } of index) {
    const re = new RegExp('(^| )' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($| )');
    if (re.test(t)) return entry;
  }
  return null;
}

export function matchProgram(text) {
  return match(text, PROGRAM_INDEX);
}

export function matchCurrency(text) {
  return match(text, CURRENCY_INDEX);
}

export function programName(id) {
  const p = PROGRAM_BY_ID.get(id);
  return p ? p.name : id;
}

export function ratioLabel(ratio) {
  if (ratio === 1) return '1:1';
  if (ratio > 1) return '1:' + ratio;
  // ratio < 1 — express as a clean "n:m" where possible (0.75 → 4:3).
  if (ratio === 0.8) return '5:4';
  if (ratio === 0.75) return '4:3';
  return '1:' + ratio;
}

// Currencies that transfer into a given program id, resolved against the
// caller's held balances. Returns the matching balance plus transfer terms.
// heldCurrencies: [{ balance, currency }] where currency is a data entry.
export function transfersInto(programId, heldCurrencies) {
  const out = [];
  heldCurrencies.forEach(({ balance, currency }) => {
    const partner = (currency.partners || []).find(p => p.program === programId);
    if (partner) out.push({ balance, currency, ratio: partner.ratio, speed: partner.speed });
  });
  return out;
}

// The airline programs a currency can reach, with effective miles for a
// given balance. amount is the held point balance.
export function reachableFrom(currency, amount) {
  const bal = parseFloat(amount) || 0;
  return (currency.partners || []).map(p => ({
    programId: p.program,
    name: programName(p.program),
    ratio: p.ratio,
    speed: p.speed,
    miles: Math.floor(bal * p.ratio)
  }));
}

// Classify one saved balance for prompt context: a flexible bank currency
// (expandable into airline programs), an airline program already usable, or
// something off-graph (e.g. a hotel currency — flights-only, so noted as such).
export function expandBalance(name, amount) {
  const bal = parseFloat(amount) || 0;
  const currency = matchCurrency(name);
  if (currency) {
    return { kind: 'flexible', name: currency.name, amount: bal, partners: reachableFrom(currency, bal) };
  }
  const program = matchProgram(name);
  if (program) {
    return { kind: 'airline', name: program.name, amount: bal };
  }
  return { kind: 'unknown', name: String(name || '').trim(), amount: bal };
}

export const LAST_VERIFIED = data.lastVerified;
