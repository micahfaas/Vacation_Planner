// Traveler "about me" profile — per-user, across all trips.
// Stored as a single JSONB row in public.profiles; the co-planner reads it
// to tailor suggestions to the user's pace, style, diet, interests, etc.
import { supabase } from './supabase.js';
import { el } from './dom.js';
import { getUserId } from './storage.js';
import { CARDS as LOUNGE_CARDS, STATUSES as LOUNGE_STATUSES } from './lounges.js';
import { getVault, saveVault, createVaultSection } from './vault.js';

let cached = null;        // last-known profile JSON (null until loaded)
const CACHE_KEY = 'vacation_planner_profile_';

function defaultProfile() {
  return {
    pace: '',
    walking: '',
    lodging: '',
    travelingWith: '',
    diet: '',
    interests: '',
    about: '',
    // Free-text points/miles balances, shared across every trip. Edited from
    // the Plan tab sidebar; the running-deltas math reads them via
    // getPointsBalances() to show what a draft route would actually cost.
    pointsBalances: [],
    // Lounge access: ids reference lounge-catalog.json. lounges.js reads
    // these to filter eligible lounges on each flight card.
    loungeCards: [],
    loungeStatuses: []
  };
}

function readCache(uid) {
  try {
    const raw = localStorage.getItem(CACHE_KEY + uid);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(uid, p) {
  try { localStorage.setItem(CACHE_KEY + uid, JSON.stringify(p)); } catch { /* ignore */ }
}

export async function loadProfile(uid) {
  cached = Object.assign(defaultProfile(), readCache(uid) || {});
  try {
    const { data, error } = await supabase
      .from('profiles').select('data').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (data && data.data) {
      cached = Object.assign(defaultProfile(), data.data);
      writeCache(uid, cached);
    }
  } catch (e) {
    console.warn('Profile load failed; using cache.', e);
  }
  return cached;
}

export function getProfile() {
  return cached || defaultProfile();
}

async function saveProfile(patch) {
  const uid = getUserId();
  cached = Object.assign(defaultProfile(), cached || {}, patch);
  writeCache(uid, cached);
  if (!uid) return;
  const { error } = await supabase.from('profiles').upsert({
    user_id: uid, data: cached, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

// ---------- Points / miles balances (cross-trip) ----------
export function getPointsBalances() {
  const p = cached || defaultProfile();
  return Array.isArray(p.pointsBalances) ? p.pointsBalances : [];
}

export async function setPointsBalances(balances) {
  await saveProfile({ pointsBalances: balances });
}

// A compact text block describing the user, for the co-planner context.
// Returns '' when the user has not filled anything in.
export function profileSummary() {
  const p = cached;
  if (!p) return '';
  const PACE = { relaxed: 'relaxed pace', balanced: 'balanced pace', packed: 'packed schedule' };
  const WALK = { light: 'prefers light walking', moderate: 'comfortable with moderate walking', lots: 'happy to walk a lot' };
  const LODGE = { budget: 'budget lodging', mid: 'mid-range lodging', boutique: 'boutique stays', luxury: 'luxury stays', mixed: 'mix of lodging styles' };
  const WITH = { solo: 'travels solo', couple: 'travels as a couple', family: 'travels with family', friends: 'travels with friends' };
  const bits = [];
  if (PACE[p.pace]) bits.push(PACE[p.pace]);
  if (WALK[p.walking]) bits.push(WALK[p.walking]);
  if (LODGE[p.lodging]) bits.push(LODGE[p.lodging]);
  if (WITH[p.travelingWith]) bits.push(WITH[p.travelingWith]);
  if (p.diet) bits.push('dietary: ' + p.diet);
  const lines = [];
  if (bits.length) lines.push(bits.join('; '));
  if (p.interests) lines.push('Interests: ' + p.interests);
  if (p.about) lines.push('About: ' + p.about);
  if (!lines.length) return '';
  return 'Traveler profile:\n  ' + lines.join('\n  ');
}

// ---------- editor ----------
const SELECT_OPTIONS = {
  pace: [
    ['', '— no preference —'],
    ['relaxed', 'Relaxed — fewer things per day, room to wander'],
    ['balanced', 'Balanced'],
    ['packed', 'Packed — fit a lot in']
  ],
  walking: [
    ['', '— no preference —'],
    ['light', 'Light — avoid long walks'],
    ['moderate', 'Moderate'],
    ['lots', 'Happy to walk a lot']
  ],
  lodging: [
    ['', '— no preference —'],
    ['budget', 'Budget / hostels'],
    ['mid', 'Mid-range hotels'],
    ['boutique', 'Boutique / character stays'],
    ['luxury', 'Luxury'],
    ['mixed', 'A mix']
  ],
  travelingWith: [
    ['', '— no preference —'],
    ['solo', 'Solo'],
    ['couple', 'As a couple'],
    ['family', 'With family'],
    ['friends', 'With friends']
  ]
};

function selectField(name, value) {
  const sel = el('select', { class: 'vp-profile-sel' });
  SELECT_OPTIONS[name].forEach(([v, label]) => {
    const opt = el('option', { value: v }, label);
    if (v === value) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

// Chip-style multi-select. Renders selected items as removable chips and an
// autocomplete-style picker. Returns { el, getSelected }.
function chipMultiSelect(options, initial, placeholder) {
  const selected = new Set(initial || []);
  const wrap = el('div', { class: 'vp-chip-field' });
  const chips = el('div', { class: 'vp-chip-list' });
  const input = el('input', { type: 'text', placeholder, class: 'vp-chip-input' });
  const dropdown = el('div', { class: 'vp-chip-dropdown', style: { display: 'none' } });

  function renderChips() {
    chips.innerHTML = '';
    [...selected].forEach(id => {
      const opt = options.find(o => o.id === id);
      if (!opt) return;
      const chip = el('span', { class: 'vp-chip' });
      chip.appendChild(el('span', {}, opt.label));
      const x = el('button', {
        class: 'vp-chip-x', 'aria-label': 'Remove',
        onclick: () => { selected.delete(id); renderChips(); renderDropdown(); }
      }, '×');
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }

  function renderDropdown() {
    const q = input.value.trim().toLowerCase();
    const matches = options.filter(o =>
      !selected.has(o.id) && (!q || o.label.toLowerCase().includes(q))
    ).slice(0, 12);
    dropdown.innerHTML = '';
    if (!matches.length || (!q && document.activeElement !== input)) {
      dropdown.style.display = 'none';
      return;
    }
    matches.forEach(o => {
      const row = el('button', {
        class: 'vp-chip-option', type: 'button',
        onclick: () => {
          selected.add(o.id);
          input.value = '';
          renderChips();
          renderDropdown();
          input.focus();
        }
      }, o.label);
      dropdown.appendChild(row);
    });
    dropdown.style.display = 'block';
  }

  input.addEventListener('focus', renderDropdown);
  input.addEventListener('input', renderDropdown);
  input.addEventListener('blur', () => {
    // delay so click on dropdown item registers
    setTimeout(() => { dropdown.style.display = 'none'; }, 150);
  });

  wrap.appendChild(chips);
  const inputWrap = el('div', { class: 'vp-chip-input-wrap' });
  inputWrap.appendChild(input);
  inputWrap.appendChild(dropdown);
  wrap.appendChild(inputWrap);

  renderChips();

  return { el: wrap, getSelected: () => [...selected] };
}

export function openProfileDialog() {
  const p = getProfile();
  const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el('div', { class: 'vp-modal vp-profile' });

  m.appendChild(el('h3', {}, 'About me'));
  m.appendChild(el('p', { class: 'vp-profile-sub' },
    'A short profile that the trip co-planner uses to tailor its suggestions. Everything is optional.'));

  const form = el('div', { class: 'vp-profile-form' });

  function row(labelText, control) {
    const r = el('div', { class: 'vp-profile-row' });
    r.appendChild(el('label', {}, labelText));
    r.appendChild(control);
    form.appendChild(r);
    return control;
  }

  const pace = row('Pace', selectField('pace', p.pace));
  const walking = row('Walking', selectField('walking', p.walking));
  const lodging = row('Lodging style', selectField('lodging', p.lodging));
  const travelingWith = row('Usually traveling', selectField('travelingWith', p.travelingWith));
  const diet = row('Dietary needs',
    el('input', { type: 'text', value: p.diet || '', placeholder: 'e.g. vegetarian, no shellfish' }));
  const interests = row('Interests',
    el('textarea', { rows: 2, placeholder: 'e.g. coffee, hiking, contemporary art, live music' }, p.interests || ''));
  const about = row('Anything else',
    el('textarea', { rows: 3, placeholder: 'Anything else the co-planner should know about you' }, p.about || ''));

  m.appendChild(form);

  // ---- Lounge access ----
  m.appendChild(el('h4', { class: 'vp-profile-section' }, 'Lounge access'));
  m.appendChild(el('p', { class: 'vp-profile-sub' },
    'Pick the cards you hold and any airline elite status — the planner uses these to show which lounges you can access on each flight.'));

  const cardsField = chipMultiSelect(LOUNGE_CARDS, p.loungeCards || [], 'Search cards…');
  m.appendChild(el('label', {}, 'Cards'));
  m.appendChild(cardsField.el);

  const statusField = chipMultiSelect(LOUNGE_STATUSES, p.loungeStatuses || [], 'Search elite status…');
  m.appendChild(el('label', {}, 'Airline status'));
  m.appendChild(statusField.el);

  // ---- Travel documents & IDs (the vault) ----
  // Stored in its own table (vault.js), never in the co-planner context or any
  // share snapshot. Kept here so "your travel identity" lives in one place.
  m.appendChild(el('h4', { class: 'vp-profile-section' }, 'Travel documents & IDs'));
  m.appendChild(el('p', { class: 'vp-profile-sub' },
    'Loyalty numbers, trusted-traveler IDs, and document files — private to you, never shared or sent to the AI planner.'));
  const vaultField = createVaultSection(getVault());
  m.appendChild(vaultField.el);

  const status = el('div', { class: 'vp-profile-status' });

  const saveBtn = el('button', { class: 'vp-save' }, 'Save');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    status.textContent = '';
    try {
      await saveProfile({
        pace: pace.value,
        walking: walking.value,
        lodging: lodging.value,
        travelingWith: travelingWith.value,
        diet: diet.value.trim(),
        interests: interests.value.trim(),
        about: about.value.trim(),
        loungeCards: cardsField.getSelected(),
        loungeStatuses: statusField.getSelected()
      });
      // Vault lives in its own table — saved separately so it never rides along
      // with the AI-readable profile.
      await saveVault(vaultField.getValue());
      bg.remove();
    } catch (e) {
      status.textContent = 'Could not save — ' + (e.message || e) +
        '. Make sure supabase/profile.sql and supabase/vault.sql have been run in your Supabase project.';
      status.classList.add('vp-profile-status-err');
      saveBtn.disabled = false;
    }
  });

  const actions = el('div', { class: 'vp-modal-actions' });
  actions.appendChild(status);
  const right = el('div', { class: 'vp-right' });
  right.appendChild(el('button', { onclick: () => bg.remove() }, 'Cancel'));
  right.appendChild(saveBtn);
  actions.appendChild(right);
  m.appendChild(actions);

  bg.appendChild(m);
  document.body.appendChild(bg);
}
