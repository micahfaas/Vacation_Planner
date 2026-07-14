// "I have X points + Y days in Z month" → destination ideas. Pre-trip
// ideation that reuses the transfer-partner engine: the user's saved points
// balances are expanded into the airline programs they can actually reach
// (transfers.js), then sent to the trip-ideas Edge Function (Claude). Each
// idea can be turned into a real trip with one tap.
import { el } from './dom.js';
import { data, ui } from './state.js';
import { newTripId } from './storage.js';
import { render } from './render.js';
import { isoDate } from './dates.js';
import { addCard } from './cards.js';
import { supabase } from './supabase.js';
import { getPointsBalances, profileSummary } from './profile.js';
import { expandBalance, LAST_VERIFIED } from './transfers.js';
import { allowAiCall, noteAiCall } from './aiusage.js';

const ORIGIN_KEY = 'trip_ideas_origin';

function fmt(n) { return Math.round(n).toLocaleString(); }

function ratioNote(p) {
  if (p.ratio > 1) return ' (1:' + p.ratio + ' = ' + fmt(p.miles) + ')';
  return ' (' + p.ratio + '× = ' + fmt(p.miles) + ')';
}

// A text block describing what the user can fly on, with flexible currencies
// expanded into their airline partners — the heart of the #1 reuse.
function pointsContext() {
  const balances = getPointsBalances()
    .filter(b => b.name && (parseFloat(b.balance) || 0) > 0);
  if (!balances.length) return '';
  const lines = ['Points & miles available (use these to judge what is reachable):'];
  balances.forEach(b => {
    const x = expandBalance(b.name, b.balance);
    if (x.kind === 'flexible') {
      const oneToOne = x.partners.filter(p => p.ratio === 1).map(p => p.name);
      const other = x.partners.filter(p => p.ratio !== 1).map(p => p.name + ratioNote(p));
      let line = '- ' + x.name + ': ' + fmt(x.amount) + ' (flexible)';
      if (oneToOne.length) line += ' → 1:1 to ' + oneToOne.join(', ');
      if (other.length) line += '; ' + other.join(', ');
      lines.push(line);
    } else if (x.kind === 'airline') {
      lines.push('- ' + x.name + ': ' + fmt(x.amount) + ' (airline miles, ready to use)');
    } else {
      lines.push('- ' + x.name + ': ' + fmt(x.amount) + ' (not a flight transfer partner — ignore for flights)');
    }
  });
  return lines.join('\n');
}

// The next 12 months as { value: 'YYYY-MM', label: 'August 2026' }.
function monthOptions() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    out.push({ value, label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

function monthLabel(value) {
  const m = monthOptions().find(o => o.value === value);
  return m ? m.label : 'Flexible timing';
}

function createTripFromIdea(idea, monthValue, days) {
  const id = newTripId();
  let start;
  if (/^\d{4}-\d{2}$/.test(monthValue || '')) {
    start = new Date(monthValue + '-01T00:00:00');
  } else {
    start = new Date();
    start.setDate(start.getDate() + 30);
  }
  const span = Math.max(1, parseInt(days, 10) || 7);
  const end = new Date(start);
  end.setDate(end.getDate() + span - 1);

  data.trips[id] = {
    id, name: idea.destination || 'New trip',
    startDate: isoDate(start), endDate: isoDate(end),
    cards: {}, schedule: {}, library: [], libFilter: 'all', nextId: 1
  };
  data.activeTripId = id;
  ui.view = 'calendar';
  // Seed a note so the idea (and its redemption sketch) survives into the trip.
  addCard({
    type: 'note',
    title: 'Trip idea: ' + (idea.destination || ''),
    notes: [idea.bestFor, idea.redemption, idea.pitch].filter(Boolean).join('\n\n')
  }, { kind: 'lib' });
}

function ideaCard(idea, monthValue, days, closeAll) {
  const card = el('div', { class: 'vp-idea' });
  card.appendChild(el('div', { class: 'vp-idea-dest' }, idea.destination || 'Destination'));
  if (idea.bestFor) card.appendChild(el('div', { class: 'vp-idea-best' }, idea.bestFor));
  if (idea.redemption) {
    card.appendChild(el('div', { class: 'vp-idea-redeem' },
      el('i', { class: 'ti ti-plane-departure', 'aria-hidden': 'true' }),
      el('span', {}, idea.redemption)));
  }
  if (idea.pitch) card.appendChild(el('div', { class: 'vp-idea-pitch' }, idea.pitch));

  const foot = el('div', { class: 'vp-idea-foot' });
  const nights = parseInt(idea.nights, 10);
  if (nights > 0) foot.appendChild(el('span', { class: 'vp-idea-nights' }, nights + (nights === 1 ? ' night' : ' nights')));
  foot.appendChild(el('button', {
    type: 'button', class: 'vp-coplan-add',
    onclick: () => { createTripFromIdea(idea, monthValue, days); closeAll(); }
  }, '+ Create trip'));
  card.appendChild(foot);
  return card;
}

export function openTripIdeas() {
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-coplan' });
  const closeAll = () => bg.remove();

  m.appendChild(el('h3', {}, 'Trip ideas'));
  m.appendChild(el('div', { class: 'vp-coplan-trip' },
    'Destination ideas matched to your points, your dates, and the season.'));

  // Saved-balances summary (read-only — edited in the Plan tab).
  const balances = getPointsBalances().filter(b => b.name && (parseFloat(b.balance) || 0) > 0);
  if (balances.length) {
    const sum = balances.map(b => b.name + ' ' + fmt(b.balance)).join(' · ');
    m.appendChild(el('div', { class: 'vp-idea-balances' },
      el('strong', {}, 'Your balances: '), el('span', {}, sum),
      el('div', { class: 'vp-idea-balances-hint' }, 'Edit these in the Plan tab.')));
  } else {
    m.appendChild(el('div', { class: 'vp-idea-balances vp-idea-balances-empty' },
      'No points balances saved yet — add them in the Plan tab and ideas will be tailored to what you can redeem.'));
  }

  const form = el('div', { class: 'vp-idea-form' });
  function field(labelText, control) {
    const r = el('label', { class: 'vp-idea-field' });
    r.appendChild(el('span', {}, labelText));
    r.appendChild(control);
    form.appendChild(r);
    return control;
  }

  const daysInput = field('Days', el('input', { type: 'number', min: '1', max: '60', value: '7' }));

  const monthSel = el('select', {});
  monthSel.appendChild(el('option', { value: '' }, 'Flexible / not sure'));
  monthOptions().forEach(o => monthSel.appendChild(el('option', { value: o.value }, o.label)));
  field('When', monthSel);

  const originInput = field('Flying from',
    el('input', { type: 'text', placeholder: 'City or airport code, e.g. Bend, OR or RDM', value: localStorage.getItem(ORIGIN_KEY) || '' }));

  const prefsInput = field('Preferences (optional)',
    el('input', { type: 'text', placeholder: 'e.g. beaches, food cities, Asia, off the beaten path' }));

  m.appendChild(form);

  const out = el('div', { class: 'vp-coplan-out' });
  m.appendChild(out);

  const goBtn = el('button', { class: 'vp-save' }, 'Find ideas');
  async function go() {
    const days = parseInt(daysInput.value, 10) || 7;
    const monthValue = monthSel.value;
    const origin = originInput.value.trim();
    if (origin) localStorage.setItem(ORIGIN_KEY, origin);

    const parts = [];
    const prof = profileSummary();
    if (prof) parts.push(prof, '');
    const pts = pointsContext();
    if (pts) parts.push(pts, '');
    parts.push('Trip length: ' + days + ' days');
    parts.push('When: ' + (monthValue ? monthLabel(monthValue) : 'Flexible / open to suggestions'));
    if (prefsInput.value.trim()) parts.push('Preferences: ' + prefsInput.value.trim());
    // Origin is sent separately so the function can resolve an airport code
    // (e.g. RDM) authoritatively instead of the model guessing it.
    const context = parts.join('\n');

    if (!allowAiCall('trip-ideas',
      { reason: "You've used this month's free trip-ideas requests. Upgrade to Plus for more." })) return;
    goBtn.disabled = true;
    out.innerHTML = '';
    out.appendChild(el('div', { class: 'vp-coplan-status' }, 'Dreaming up ideas — this can take a moment…'));
    try {
      const res = await supabase.functions.invoke('trip-ideas', { body: { context, origin } });
      if (res.error) throw new Error('Trip ideas are unavailable right now.');
      const data2 = res.data;
      if (!data2 || data2.ok !== true) {
        throw new Error((data2 && data2.error) || 'Could not generate ideas.');
      }
      noteAiCall('trip-ideas');
      out.innerHTML = '';
      if (data2.reply) out.appendChild(el('div', { class: 'vp-coplan-reply' }, data2.reply));
      const ideas = Array.isArray(data2.ideas) ? data2.ideas : [];
      if (!ideas.length) {
        out.appendChild(el('div', { class: 'vp-coplan-status' }, 'No ideas came back — try different inputs.'));
      } else {
        const list = el('div', { class: 'vp-idea-list' });
        ideas.forEach(idea => list.appendChild(ideaCard(idea, monthValue, days, closeAll)));
        out.appendChild(list);
        out.appendChild(el('div', { class: 'vp-idea-foot-note' },
          'Award costs are rough estimates — verify space before booking. Transfer data as of ' + LAST_VERIFIED + '.'));
      }
    } catch (e) {
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'vp-coplan-status vp-coplan-err' }, e.message || 'Something went wrong.'));
    }
    goBtn.disabled = false;
  }
  goBtn.addEventListener('click', go);

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(el('div', {}));
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: closeAll }, 'Close'));
  right.appendChild(goBtn);
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
}
