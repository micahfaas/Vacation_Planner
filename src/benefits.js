// Benefits, Credits & Expirations Tracker — the time-sensitive perks people
// lose money on: card annual fees + recurring credits, certificates/passes,
// and points that expire. One JSONB row per user in public.benefits.
//
// Deadline push reminders are plain `watchers` rows of type 'benefit': on
// every save we delete the user's pending benefit watchers and re-create them
// from the current state (30/7/1 days before each deadline, per-item mute).
// The existing watcher-run cron delivers them to web + mobile push unchanged.
import { el, collapsible } from './dom.js';
import { supabase } from './supabase.js';
import { getUserId } from './storage.js';
import { parseISO } from './dates.js';
import { alertDialog } from './dialog.js';
import { pushReady, isSubscribed, enablePush, notificationPermission } from './push.js';

const CACHE_KEY = 'vacation_planner_benefits_';
const LEAD_DAYS = [30, 7, 1];
const CADENCES = [
  ['annual', 'Annual', 12],
  ['semiannual', 'Every 6 months', 6],
  ['quarterly', 'Quarterly', 3],
  ['monthly', 'Monthly', 1],
];
const PERK_KINDS = [
  ['freeNight', 'Free-night certificate'],
  ['companionPass', 'Companion pass'],
  ['upgradeCert', 'Upgrade certificate'],
  ['lounge', 'Lounge membership'],
  ['other', 'Other perk'],
];

function defaultBenefits() {
  return { cards: [], perks: [], pointsExpirations: [] };
}

function normalize(raw) {
  const b = defaultBenefits();
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.cards)) {
      b.cards = raw.cards.filter(Boolean).map(c => ({
        id: c.id || crypto.randomUUID(),
        name: c.name || '',
        fee: c.fee || '',
        renewalDate: c.renewalDate || '',
        remind: c.remind !== false,
        credits: (Array.isArray(c.credits) ? c.credits : []).filter(Boolean).map(cr => ({
          id: cr.id || crypto.randomUUID(),
          label: cr.label || '',
          amount: cr.amount || '',
          cadence: cr.cadence || 'annual',
          usedAmount: cr.usedAmount || '',
          resetDate: cr.resetDate || '',
          remind: cr.remind !== false,
        })),
      }));
    }
    if (Array.isArray(raw.perks)) {
      b.perks = raw.perks.filter(Boolean).map(p => ({
        id: p.id || crypto.randomUUID(),
        kind: p.kind || 'other',
        label: p.label || '',
        expiresOn: p.expiresOn || '',
        details: p.details || '',
        remind: p.remind !== false,
      }));
    }
    if (Array.isArray(raw.pointsExpirations)) {
      b.pointsExpirations = raw.pointsExpirations.filter(Boolean).map(p => ({
        id: p.id || crypto.randomUUID(),
        program: p.program || '',
        expiresOn: p.expiresOn || '',
        remind: p.remind !== false,
      }));
    }
  }
  return b;
}

let cached = defaultBenefits();

function readCache(uid) {
  try {
    const raw = localStorage.getItem(CACHE_KEY + uid);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch { return null; }
}

function writeCache(uid, b) {
  try { localStorage.setItem(CACHE_KEY + uid, JSON.stringify(b)); } catch { /* ignore */ }
}

export async function loadBenefits(uid) {
  cached = readCache(uid) || defaultBenefits();
  try {
    const { data, error } = await supabase
      .from('benefits').select('data').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (data && data.data) {
      cached = normalize(data.data);
      writeCache(uid, cached);
    }
  } catch (e) {
    console.warn('Benefits load failed; using cache.', e);
  }
  return cached;
}

export async function saveBenefits(next) {
  const uid = getUserId();
  cached = normalize(next);
  writeCache(uid, cached);
  if (!uid) return;
  const { error } = await supabase.from('benefits').upsert({
    user_id: uid, data: cached, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

// ---------- deadline math ----------
// Calendar-aware month stepping (Jan 31 + 1mo -> Feb 28), kept local since
// dates.js only has day arithmetic.
function addMonths(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const day = Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate());
  x.setDate(day);
  return x;
}

// Roll a (possibly past) date forward by `months` steps until it is today or
// later. Returns a Date, or null for blank/invalid input.
function nextOccurrence(dateStr, months) {
  if (!dateStr) return null;
  let d = parseISO(dateStr);
  if (!d || isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (!months) return d.getTime() >= today.getTime() ? d : null; // one-shot date
  let guard = 0;
  while (d.getTime() < today.getTime() && guard++ < 600) d = addMonths(d, months);
  return d;
}

function cadenceMonths(cadence) {
  const row = CADENCES.find(c => c[0] === cadence);
  return row ? row[2] : 12;
}

function fmtDay(d) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function daysAway(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// Every upcoming deadline across the tracker, sorted soonest-first. Each:
// { date: Date, title, note, remind, periodMonths } — shared by the dashboard
// list and the watcher generator so they can never disagree.
export function upcomingDeadlines(b) {
  const out = [];
  (b.cards || []).forEach(c => {
    const renew = nextOccurrence(c.renewalDate, 12);
    if (renew && c.name) {
      out.push({
        date: renew, remind: c.remind, periodMonths: 12,
        title: c.name + ' annual fee',
        note: (c.fee ? '$' + c.fee + ' ' : '') + 'renews ' + fmtDay(renew) + ' — cancel or downgrade before then if it is not earning its keep.',
      });
    }
    (c.credits || []).forEach(cr => {
      const reset = nextOccurrence(cr.resetDate, cadenceMonths(cr.cadence));
      if (reset && cr.label) {
        const left = (parseFloat(cr.amount) || 0) - (parseFloat(cr.usedAmount) || 0);
        out.push({
          date: reset, remind: cr.remind, periodMonths: cadenceMonths(cr.cadence),
          title: cr.label + (c.name ? ' (' + c.name + ')' : ''),
          note: (left > 0 ? '$' + left + ' left — ' : '') + 'use it before it resets ' + fmtDay(reset) + '.',
        });
      }
    });
  });
  (b.perks || []).forEach(p => {
    const exp = nextOccurrence(p.expiresOn, 0);
    if (exp && p.label) {
      out.push({
        date: exp, remind: p.remind, periodMonths: 0,
        title: p.label,
        note: 'Expires ' + fmtDay(exp) + (p.details ? ' — ' + p.details : '') + '.',
      });
    }
  });
  (b.pointsExpirations || []).forEach(p => {
    const exp = nextOccurrence(p.expiresOn, 0);
    if (exp && p.program) {
      out.push({
        date: exp, remind: p.remind, periodMonths: 0,
        title: p.program + ' points expiring',
        note: 'They expire ' + fmtDay(exp) + ' — any earn or redemption usually resets the clock.',
      });
    }
  });
  out.sort((a, z) => a.date.getTime() - z.date.getTime());
  return out;
}

// ---------- push reminder sync ----------
// Replace all of the user's pending benefit watchers with rows derived from
// the current state: 30/7/1 days before each deadline (skipping leads longer
// than the credit's own cadence, and anything already in the past).
export async function regenerateBenefitWatchers(b) {
  const uid = getUserId();
  if (!uid) return 0;
  const del = await supabase.from('watchers').delete()
    .eq('user_id', uid).eq('type', 'benefit').eq('status', 'pending');
  if (del.error) throw del.error;

  const rows = [];
  upcomingDeadlines(b).forEach(d => {
    if (!d.remind) return;
    LEAD_DAYS.forEach(lead => {
      if (d.periodMonths && lead >= d.periodMonths * 28) return; // lead longer than the cycle
      const fire = new Date(d.date.getTime() - lead * 86400000);
      fire.setUTCHours(17, 0, 0, 0); // ~9am Pacific / noon Eastern
      if (fire.getTime() <= Date.now()) return;
      rows.push({
        user_id: uid, type: 'benefit',
        title: d.title + (lead === 1 ? ' — tomorrow' : ' — in ' + lead + ' days'),
        note: d.note, url: '', trip_id: '',
        fire_at: fire.toISOString(),
      });
    });
  });
  if (rows.length) {
    const ins = await supabase.from('watchers').insert(rows.slice(0, 200));
    if (ins.error) throw ins.error;
  }
  return rows.length;
}

// ---------- UI ----------
function bellToggle(initial) {
  let on = initial !== false;
  const btn = el('button', { type: 'button', class: 'vp-bnf-bell', title: 'Push reminders for this item' });
  function render() {
    btn.innerHTML = '';
    btn.appendChild(el('i', { class: 'ti ' + (on ? 'ti-bell' : 'ti-bell-off') }));
    btn.classList.toggle('vp-bnf-bell-off', !on);
  }
  btn.addEventListener('click', () => { on = !on; render(); });
  render();
  return { el: btn, get: () => on };
}

function rmBtn(onRemove) {
  return el('button', {
    type: 'button', class: 'vp-balance-rm', title: 'Remove', 'aria-label': 'Remove', onclick: onRemove
  }, '×');
}

function creditRow(cr, onRemove) {
  const row = el('div', { class: 'vp-bnf-credit' });
  const label = el('input', { type: 'text', value: cr.label || '', placeholder: 'Credit — e.g. Airline incidental' });
  const amount = el('input', { type: 'number', min: '0', value: cr.amount || '', placeholder: '$' });
  const used = el('input', { type: 'number', min: '0', value: cr.usedAmount || '', placeholder: 'used' });
  const cadence = el('select', {});
  CADENCES.forEach(([v, lbl]) => {
    const o = el('option', { value: v }, lbl);
    if (v === (cr.cadence || 'annual')) o.selected = true;
    cadence.appendChild(o);
  });
  const reset = el('input', { type: 'date', value: cr.resetDate || '' });
  const bell = bellToggle(cr.remind);
  const top = el('div', { class: 'vp-bnf-credit-top' }, label, amount, bell.el, rmBtn(onRemove));
  const bottom = el('div', { class: 'vp-bnf-credit-bottom' },
    el('label', {}, 'Used', used), el('label', {}, 'Cycle', cadence), el('label', {}, 'Resets', reset));
  row.appendChild(top);
  row.appendChild(bottom);
  row._read = () => ({
    id: cr.id || crypto.randomUUID(),
    label: label.value.trim(), amount: amount.value, cadence: cadence.value,
    usedAmount: used.value, resetDate: reset.value, remind: bell.get(),
  });
  return row;
}

function cardBlock(c, onRemove) {
  const block = el('div', { class: 'vp-bnf-card' });
  const name = el('input', { type: 'text', value: c.name || '', placeholder: 'Card — e.g. Amex Platinum' });
  const fee = el('input', { type: 'number', min: '0', value: c.fee || '', placeholder: 'Fee $' });
  const renewal = el('input', { type: 'date', value: c.renewalDate || '' });
  const bell = bellToggle(c.remind);
  block.appendChild(el('div', { class: 'vp-bnf-card-top' }, name, fee, bell.el, rmBtn(onRemove)));
  block.appendChild(el('div', { class: 'vp-bnf-card-renew' }, el('label', {}, 'Fee renews', renewal)));

  const creditList = el('div', { class: 'vp-bnf-credits' });
  const creditRows = [];
  function addCredit(cr) {
    const row = creditRow(cr, () => {
      const i = creditRows.indexOf(row);
      if (i > -1) { creditRows.splice(i, 1); creditList.removeChild(row); }
    });
    creditRows.push(row);
    creditList.appendChild(row);
  }
  (c.credits || []).forEach(addCredit);
  block.appendChild(creditList);
  const addCr = el('button', { type: 'button', class: 'vp-balance-add' }, '+ Add a credit');
  addCr.addEventListener('click', () => addCredit({}));
  block.appendChild(addCr);

  block._read = () => ({
    id: c.id || crypto.randomUUID(),
    name: name.value.trim(), fee: fee.value, renewalDate: renewal.value,
    remind: bell.get(), credits: creditRows.map(r => r._read()).filter(cr => cr.label),
  });
  return block;
}

function perkRow(p, onRemove) {
  const row = el('div', { class: 'vp-bnf-perk' });
  const kind = el('select', {});
  PERK_KINDS.forEach(([v, lbl]) => {
    const o = el('option', { value: v }, lbl);
    if (v === (p.kind || 'other')) o.selected = true;
    kind.appendChild(o);
  });
  const label = el('input', { type: 'text', value: p.label || '', placeholder: 'e.g. Marriott 35k free night' });
  const expires = el('input', { type: 'date', value: p.expiresOn || '' });
  const details = el('input', { type: 'text', value: p.details || '', placeholder: 'Details (optional) — e.g. cap, where it works' });
  const bell = bellToggle(p.remind);
  row.appendChild(el('div', { class: 'vp-bnf-perk-top' }, label, bell.el, rmBtn(onRemove)));
  row.appendChild(el('div', { class: 'vp-bnf-perk-bottom' },
    el('label', {}, 'Type', kind), el('label', {}, 'Expires', expires)));
  row.appendChild(details);
  row._read = () => ({
    id: p.id || crypto.randomUUID(),
    kind: kind.value, label: label.value.trim(), expiresOn: expires.value,
    details: details.value.trim(), remind: bell.get(),
  });
  return row;
}

function pointsRow(p, onRemove) {
  const row = el('div', { class: 'vp-bnf-points' });
  const program = el('input', { type: 'text', value: p.program || '', placeholder: 'Program — e.g. American AAdvantage' });
  const expires = el('input', { type: 'date', value: p.expiresOn || '' });
  const bell = bellToggle(p.remind);
  row.appendChild(program);
  row.appendChild(expires);
  row.appendChild(bell.el);
  row.appendChild(rmBtn(onRemove));
  row._read = () => ({
    id: p.id || crypto.randomUUID(),
    program: program.value.trim(), expiresOn: expires.value, remind: bell.get(),
  });
  return row;
}

// Generic "list of rows + add button" scaffolding shared by the sections.
function rowList(items, makeRow, addLabel) {
  const wrap = el('div', { class: 'vp-bnf-list' });
  const rows = [];
  function add(item) {
    const row = makeRow(item, () => {
      const i = rows.indexOf(row);
      if (i > -1) { rows.splice(i, 1); wrap.removeChild(row); }
    });
    rows.push(row);
    wrap.appendChild(row);
  }
  items.forEach(add);
  const addBtn = el('button', { type: 'button', class: 'vp-balance-add' }, addLabel);
  addBtn.addEventListener('click', () => add({}));
  return { wrap, addBtn, read: () => rows.map(r => r._read()) };
}

export async function openBenefits() {
  const uid = getUserId();
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-benefits' });

  m.appendChild(el('h3', {}, 'Benefits & credits'));
  m.appendChild(el('p', { class: 'vp-profile-sub' },
    'Track card fees, credits, certificates, and expiring points — with push reminders 30, 7, and 1 days before each deadline. Use the bell to mute any item.'));

  // Same enable-notifications banner as Booking reminders.
  const banner = el('div', { class: 'vp-watch-banner' });
  m.appendChild(banner);
  (async function refreshBanner() {
    banner.innerHTML = '';
    const ready = await pushReady();
    if (!ready) {
      banner.appendChild(el('div', { class: 'vp-watch-note' },
        notificationPermission() === 'unsupported'
          ? 'This browser can’t do push notifications. Deadlines will still show here.'
          : 'Push needs the installed/deployed app — enable it there. Deadlines will still show here.'));
      return;
    }
    if (await isSubscribed()) return;
    const btn = el('button', { class: 'vp-save' }, 'Enable notifications');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await enablePush(); banner.innerHTML = ''; }
      catch (e) { await alertDialog(e.message || 'Could not enable notifications.'); btn.disabled = false; }
    });
    banner.appendChild(el('div', { class: 'vp-watch-note' }, 'Turn on notifications to get the deadline reminders:'));
    banner.appendChild(btn);
  })();

  const body = el('div', { class: 'vp-bnf-body' }, el('div', { class: 'vp-watch-empty' }, 'Loading…'));
  m.appendChild(body);

  const status = el('div', { class: 'vp-profile-status' });
  const saveBtn = el('button', { class: 'vp-save' }, 'Save');
  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(status);
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  right.appendChild(saveBtn);
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);

  const b = await loadBenefits(uid);
  body.innerHTML = '';

  // ---- Expiring soon ----
  const soon = upcomingDeadlines(b).slice(0, 6);
  if (soon.length) {
    body.appendChild(el('h4', { class: 'vp-profile-section' }, 'Expiring soon'));
    soon.forEach(d => {
      const n = daysAway(d.date);
      const chip = el('span', {
        class: 'vp-bnf-days' + (n <= 7 ? ' vp-bnf-days-hot' : '')
      }, n <= 0 ? 'today' : n + 'd');
      body.appendChild(el('div', { class: 'vp-bnf-soon' },
        chip,
        el('div', { class: 'vp-bnf-soon-main' },
          el('div', { class: 'vp-bnf-soon-title' }, d.title),
          el('div', { class: 'vp-bnf-soon-note' }, fmtDay(d.date)))));
    });
  }

  // ---- editable sections (collapsible, teal-highlight when open) ----
  const cardsSec = collapsible('Cards & credits', b.cards.length > 0);
  const cards = rowList(b.cards, cardBlock, '+ Add a card');
  cardsSec.body.appendChild(cards.wrap);
  cardsSec.body.appendChild(cards.addBtn);
  body.appendChild(cardsSec.el);

  const perksSec = collapsible('Certificates & perks', b.perks.length > 0);
  const perks = rowList(b.perks, perkRow, '+ Add a perk');
  perksSec.body.appendChild(perks.wrap);
  perksSec.body.appendChild(perks.addBtn);
  body.appendChild(perksSec.el);

  const ptsSec = collapsible('Points expirations', b.pointsExpirations.length > 0);
  const pts = rowList(b.pointsExpirations, pointsRow, '+ Add a program');
  ptsSec.body.appendChild(pts.wrap);
  ptsSec.body.appendChild(pts.addBtn);
  body.appendChild(ptsSec.el);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    status.textContent = '';
    status.classList.remove('vp-profile-status-err');
    try {
      const next = normalize({
        cards: cards.read().filter(c => c.name),
        perks: perks.read().filter(p => p.label),
        pointsExpirations: pts.read().filter(p => p.program),
      });
      await saveBenefits(next);
      const count = await regenerateBenefitWatchers(next);
      status.textContent = count ? count + ' reminders scheduled.' : '';
      bg.remove();
    } catch (e) {
      status.textContent = 'Could not save — ' + (e.message || e) +
        '. Make sure supabase/benefits.sql has been run in your Supabase project.';
      status.classList.add('vp-profile-status-err');
      saveBtn.disabled = false;
    }
  });
}
