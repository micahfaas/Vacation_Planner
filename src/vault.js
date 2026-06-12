// Travel Documents & Loyalty Vault — per-user, across all trips. The most
// sensitive data in the app, so it lives in its own public.vault table (a
// single JSONB row per user), not inside the profiles row.
//
// ISOLATION CONTRACT — do NOT break:
//   * Never import this module from share.js, coplanner.js, trip-ideas.js,
//     tripcheck.js, or anything that builds an AI prompt / edge-function body
//     / share-trip snapshot. Vault data must never leave the user's own
//     authenticated session.
// STORE-LESS CONTRACT — keep it lean:
//   * Loyalty numbers + user-attached files are the core. Do NOT add passport
//     numbers, SSNs, full card numbers, or other identity data we do not need.
import { supabase } from './supabase.js';
import { el } from './dom.js';
import { getUserId } from './storage.js';
import { createAttachmentsField } from './attachments.js';

const CACHE_KEY = 'vacation_planner_vault_';

function defaultVault() {
  return {
    loyalty: [],                                   // [{ id, program, number, label }]
    travelerIds: { ktn: '', redress: '', clear: '' },
    documents: []                                  // [{ id, name, path, size, type }]
  };
}

// Coerce any stored/loaded value into the canonical shape so the UI and any
// reader can trust the structure.
function normalize(raw) {
  const v = defaultVault();
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.loyalty)) v.loyalty = raw.loyalty.filter(Boolean);
    if (raw.travelerIds && typeof raw.travelerIds === 'object') {
      v.travelerIds.ktn = raw.travelerIds.ktn || '';
      v.travelerIds.redress = raw.travelerIds.redress || '';
      v.travelerIds.clear = raw.travelerIds.clear || '';
    }
    if (Array.isArray(raw.documents)) v.documents = raw.documents.filter(Boolean);
  }
  return v;
}

let cached = defaultVault();

function readCache(uid) {
  try {
    const raw = localStorage.getItem(CACHE_KEY + uid);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch { return null; }
}

function writeCache(uid, v) {
  try { localStorage.setItem(CACHE_KEY + uid, JSON.stringify(v)); } catch { /* ignore */ }
}

export async function loadVault(uid) {
  cached = readCache(uid) || defaultVault();
  try {
    const { data, error } = await supabase
      .from('vault').select('data').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (data && data.data) {
      cached = normalize(data.data);
      writeCache(uid, cached);
    }
  } catch (e) {
    console.warn('Vault load failed; using cache.', e);
  }
  return cached;
}

export function getVault() { return normalize(cached); }

export async function saveVault(next) {
  const uid = getUserId();
  cached = normalize(next);
  writeCache(uid, cached);
  if (!uid) return;
  const { error } = await supabase.from('vault').upsert({
    user_id: uid, data: cached, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

// ---------- UI ----------
// Small "Copy" button next to a value. Uses the browser clipboard API only —
// no dependency, no data leaves the page.
function copyButton(getText) {
  const btn = el('button', {
    type: 'button', class: 'vp-vault-copy', title: 'Copy', 'aria-label': 'Copy'
  }, el('i', { class: 'ti ti-copy' }));
  btn.addEventListener('click', async () => {
    const text = (getText() || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.innerHTML;
      btn.textContent = 'Copied';
      btn.classList.add('vp-vault-copied');
      setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('vp-vault-copied'); }, 1200);
    } catch { /* clipboard blocked — ignore */ }
  });
  return btn;
}

function loyaltyRow(entry, onRemove) {
  const row = el('div', { class: 'vp-vault-loyalty-row' });
  const program = el('input', {
    type: 'text', class: 'vp-vault-prog', value: entry.program || '',
    placeholder: 'Program (e.g. United MileagePlus)'
  });
  const number = el('input', {
    type: 'text', class: 'vp-vault-num', value: entry.number || '',
    placeholder: 'Member number', autocomplete: 'off', autocapitalize: 'off',
    autocorrect: 'off', spellcheck: 'false'
  });
  const rm = el('button', {
    type: 'button', class: 'vp-balance-rm', title: 'Remove', 'aria-label': 'Remove',
    onclick: onRemove
  }, '×');
  row.appendChild(program);
  row.appendChild(number);
  row.appendChild(copyButton(() => number.value));
  row.appendChild(rm);
  // Expose the live inputs so getValue() can read current text.
  row._read = () => ({
    id: entry.id || crypto.randomUUID(),
    program: program.value.trim(),
    number: number.value.trim(),
    label: entry.label || ''
  });
  return row;
}

// Build the "Travel documents & IDs" section for the About-me dialog.
// Returns { el, getValue } — getValue() yields the canonical vault object.
export function createVaultSection(initial) {
  const v = normalize(initial);
  const wrap = el('div', { class: 'vp-vault' });

  // --- Loyalty programs ---
  wrap.appendChild(el('label', {}, 'Loyalty & frequent-flyer numbers'));
  const loyaltyList = el('div', { class: 'vp-vault-loyalty-list' });
  const rows = [];

  function addRow(entry) {
    const row = loyaltyRow(entry, () => {
      const i = rows.indexOf(row);
      if (i > -1) { rows.splice(i, 1); loyaltyList.removeChild(row); }
    });
    rows.push(row);
    loyaltyList.appendChild(row);
  }
  v.loyalty.forEach(addRow);
  wrap.appendChild(loyaltyList);
  const addBtn = el('button', { type: 'button', class: 'vp-balance-add' }, '+ Add a number');
  addBtn.addEventListener('click', () => addRow({}));
  wrap.appendChild(addBtn);

  // --- Trusted-traveler IDs ---
  wrap.appendChild(el('h4', { class: 'vp-profile-section' }, 'Trusted-traveler IDs'));
  function idField(labelText, value, placeholder) {
    const r = el('div', { class: 'vp-profile-row' });
    r.appendChild(el('label', {}, labelText));
    const inner = el('div', { class: 'vp-vault-id-inner' });
    const input = el('input', {
      type: 'text', value: value || '', placeholder,
      autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false'
    });
    inner.appendChild(input);
    inner.appendChild(copyButton(() => input.value));
    r.appendChild(inner);
    wrap.appendChild(r);
    return input;
  }
  const ktn = idField('Known Traveler Number (TSA PreCheck / Global Entry)',
    v.travelerIds.ktn, 'e.g. TT1234567');
  const redress = idField('Redress number', v.travelerIds.redress, 'Optional');
  const clear = idField('CLEAR member ID', v.travelerIds.clear, 'Optional');

  // --- Document files (reuse the private attachments bucket) ---
  wrap.appendChild(el('h4', { class: 'vp-profile-section' }, 'Document files'));
  wrap.appendChild(el('p', { class: 'vp-profile-sub' },
    'Passport, visa, vaccination card, insurance, ID. Files are private to your account.'));
  const docsField = createAttachmentsField(v.documents);
  wrap.appendChild(docsField.el);

  return {
    el: wrap,
    getValue: () => ({
      loyalty: rows.map(r => r._read()).filter(e => e.program || e.number),
      travelerIds: {
        ktn: ktn.value.trim(),
        redress: redress.value.trim(),
        clear: clear.value.trim()
      },
      documents: docsField.getValue()
    })
  };
}

// Re-authentication gate for opening the vault section — the web counterpart to
// the mobile biometric lock: prove it is really you before the most sensitive
// data is revealed. Email/password accounts re-enter their password; Google /
// Apple accounts (no password to re-enter, already strongly authenticated) get
// a lightweight confirm. Resolves to true when unlocked, false on cancel.
export function reauthForVault() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; bg.remove(); resolve(val); };

    const bg = el('div', { class: 'vp-modal-bg', onclick: e => { if (e.target === bg) finish(false); } });
    const m = el('div', { class: 'vp-modal vp-vault-reauth' });
    m.appendChild(el('h3', {}, 'Unlock your travel documents'));
    const sub = el('p', { class: 'vp-profile-sub' },
      'For your security, confirm it is you before viewing your loyalty numbers and document files.');
    m.appendChild(sub);
    const status = el('div', { class: 'vp-profile-status' });
    const unlock = el('button', { class: 'vp-save' }, 'Unlock');

    // State filled in once we know how the account signs in.
    let pwInput = null;
    let email = '';
    let hasPassword = false;

    const attempt = async () => {
      if (!hasPassword) { finish(true); return; }
      const pw = pwInput.value;
      if (!pw) {
        status.textContent = 'Enter your password.';
        status.classList.add('vp-profile-status-err');
        return;
      }
      unlock.disabled = true;
      status.textContent = '';
      status.classList.remove('vp-profile-status-err');
      // Verifies the password against the current account. Re-issues a session
      // for the SAME user, which main.js dedupes by user id (no UI disruption).
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) {
        status.textContent = 'That password did not match. Try again.';
        status.classList.add('vp-profile-status-err');
        unlock.disabled = false;
        return;
      }
      finish(true);
    };
    unlock.addEventListener('click', attempt);

    const actions = el('div', { class: 'vp-modal-actions' });
    const right = el('div', { class: 'vp-right' });
    right.appendChild(el('button', { onclick: () => finish(false) }, 'Cancel'));
    right.appendChild(unlock);
    actions.appendChild(right);

    // Always render the buttons synchronously so the dialog is never blank; a
    // password field is slotted in above the status line if the account uses one.
    m.appendChild(status);
    m.appendChild(actions);
    bg.appendChild(m);
    document.body.appendChild(bg);

    // Resolve the account's sign-in methods, then tailor the dialog.
    supabase.auth.getUser().then(({ data }) => {
      const user = data && data.user;
      const providers = [];
      if (user) {
        const am = user.app_metadata || {};
        if (Array.isArray(am.providers)) providers.push(...am.providers);
        else if (am.provider) providers.push(am.provider);
        if (Array.isArray(user.identities)) {
          for (const i of user.identities) if (i && i.provider) providers.push(i.provider);
        }
        email = user.email || '';
      }
      hasPassword = providers.includes('email') && !!email;
      if (hasPassword) {
        sub.textContent =
          'For your security, re-enter your password to view your loyalty numbers and document files.';
        pwInput = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
        pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
        m.insertBefore(pwInput, status);
        pwInput.focus();
      }
    });
  });
}
