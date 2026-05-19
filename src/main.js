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
const shareToken = new URLSearchParams(location.search).get('share');

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
  bootApp();
}

function bootApp() {
  document.getElementById('vp-trips-btn').addEventListener('click', openTripsMenu);
  document.getElementById('vp-export-btn').addEventListener('click', exportJSON);
  document.getElementById('vp-ics-btn').addEventListener('click', exportICS);
  document.getElementById('vp-currency-btn').addEventListener('click', openCurrencyConverter);
  document.getElementById('vp-import-btn').addEventListener('click', openImportModal);

  const accountBtn = document.getElementById('vp-account-btn');
  accountBtn.addEventListener('click', () => {
    confirmDialog('Sign out of Vacation Planner?', { confirmText: 'Sign out' })
      .then(ok => { if (ok) signOut(); });
  });

  async function showApp(user) {
    document.body.classList.remove('vp-signed-out');
    document.getElementById('vp-account-email').textContent = user.email || 'Account';
    accountBtn.hidden = false;
    root.innerHTML = '<div class="vp-loading">Loading your trips…</div>';
    await loadTrips(user.id);
    render();
  }

  function showSignedOut() {
    document.body.classList.add('vp-signed-out');
    accountBtn.hidden = true;
    renderAuthScreen();
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
