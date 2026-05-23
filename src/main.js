// App entry: gate on the Supabase session, wire the header, boot the planner.
// A ?share=<token> URL skips the gate and renders a read-only shared trip.
import './styles.css';
import { supabase } from './supabase.js';
import { renderAuthScreen, signOut } from './auth.js';
import { loadTrips } from './storage.js';
import { render } from './render.js';
import { exportJSON } from './io.js';
import { exportICS } from './ics.js';
import { openCurrencyConverter } from './currency.js';
import { openTripsMenu } from './trips.js';
import { loadSharedTrip, renderSharedTrip } from './share.js';
import { confirmDialog } from './dialog.js';
import { openImportModal } from './importer.js';
import { openCoPlanner } from './coplanner.js';
import { openWatchers } from './watchers.js';
import { loadProfile, openProfileDialog } from './profile.js';
import { loadFavorites } from './favorites.js';
import { el } from './dom.js';

// Register the service worker for offline support (production builds only,
// so it never interferes with the Vite dev server's hot reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  });
}

// Escape closes the top-most open modal.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modals = document.querySelectorAll('.vp-modal-bg');
  if (modals.length) modals[modals.length - 1].remove();
});

const root = document.getElementById('vp-root');
const params = new URLSearchParams(location.search);
const shareToken = params.get('share');

// PWA share target — text or a link shared into the app from another app.
let pendingShare = [params.get('shared_title'), params.get('shared_text'), params.get('shared_url')]
  .filter(Boolean).join('\n') || null;

if (shareToken) {
  document.body.classList.add('vp-shared');
  root.innerHTML = '<div class="vp-loading">Loading shared trip…</div>';
  loadSharedTrip(shareToken)
    .then(trip => renderSharedTrip(trip))
    .catch(() => {
      root.innerHTML = '<div class="vp-loading">This shared trip could not be found, ' +
        'or sharing was turned off.</div>';
    });
} else {
  if (pendingShare) history.replaceState({}, '', location.pathname);
  bootApp();
}

function bootApp() {
  document.getElementById('vp-trips-btn').addEventListener('click', openTripsMenu);
  document.getElementById('vp-export-btn').addEventListener('click', exportJSON);
  document.getElementById('vp-ics-btn').addEventListener('click', exportICS);
  document.getElementById('vp-currency-btn').addEventListener('click', openCurrencyConverter);
  document.getElementById('vp-import-btn').addEventListener('click', openImportModal);
  document.getElementById('vp-coplan-btn').addEventListener('click', openCoPlanner);
  document.getElementById('vp-reminders-btn').addEventListener('click', openWatchers);

  const accountBtn = document.getElementById('vp-account-btn');
  accountBtn.addEventListener('click', () => openAccountMenu(accountBtn));

  async function showApp(user) {
    document.body.classList.remove('vp-signed-out');
    document.getElementById('vp-account-email').textContent = user.email || 'Account';
    accountBtn.hidden = false;
    root.innerHTML = '<div class="vp-loading">Loading your trips…</div>';
    await Promise.all([loadTrips(user.id), loadProfile(user.id), loadFavorites(user.id)]);
    render();
    if (pendingShare) {
      const text = pendingShare;
      pendingShare = null;
      openImportModal({ text });
    }
  }

  function showSignedOut() {
    document.body.classList.add('vp-signed-out');
    accountBtn.hidden = true;
    renderAuthScreen();
  }

  function openAccountMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    const bg = el('div', {
      class: 'vp-menu-bg',
      onclick: e => { if (e.target === bg) bg.remove(); }
    });
    const menu = el('div', {
      class: 'vp-menu',
      style: {
        top: (rect.bottom + 6) + 'px',
        right: (window.innerWidth - rect.right) + 'px'
      }
    });
    function item(label, icon, fn) {
      const b = el('button', { class: 'vp-menu-item' },
        el('i', { class: 'ti ' + icon }), el('span', {}, label));
      b.addEventListener('click', () => { bg.remove(); fn(); });
      return b;
    }
    menu.appendChild(item('About me', 'ti-user', openProfileDialog));
    menu.appendChild(item('Sign out', 'ti-logout', () => {
      confirmDialog('Sign out of Trip Planner?', { confirmText: 'Sign out' })
        .then(ok => { if (ok) signOut(); });
    }));
    bg.appendChild(menu);
    document.body.appendChild(bg);
  }

  // onAuthStateChange fires immediately with the current session, then again on
  // sign-in/out. Dedupe by user id so token refreshes don't re-fetch trips.
  let currentUserId;
  supabase.auth.onAuthStateChange((event, session) => {
    const uid = session && session.user ? session.user.id : null;
    if (uid === currentUserId) return;
    currentUserId = uid;
    if (uid) showApp(session.user);
    else showSignedOut();
  });
}
