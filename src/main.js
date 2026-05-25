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
import { startTour, tourSeen } from './tour.js';
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

// PWA share target — photos. The service worker stashes shared images in a
// cache and redirects here with ?shared_photos=<n>; we drain them after the
// active trip loads (see showApp).
let pendingSharedPhotoCount = parseInt(params.get('shared_photos') || '0', 10) || 0;

// Read and remove the photos the service worker stashed for a share.
async function drainSharedPhotos() {
  const files = [];
  try {
    const cache = await caches.open('trip-planner-shared');
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('X-Filename') || 'photo.jpg');
      files.push(new File([blob], name, { type: blob.type || 'image/jpeg' }));
      await cache.delete(req);
    }
  } catch { /* no cache / not supported */ }
  return files;
}

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
  if (pendingShare || pendingSharedPhotoCount) history.replaceState({}, '', location.pathname);
  bootApp();
}

function bootApp() {
  document.getElementById('vp-trips-btn').addEventListener('click', openTripsMenu);
  document.getElementById('vp-import-btn').addEventListener('click', openImportModal);
  document.getElementById('vp-coplan-btn').addEventListener('click', openCoPlanner);

  // Secondary actions tucked behind a "More" dropdown to keep the bar clean.
  const moreBtn = document.getElementById('vp-more-btn');
  moreBtn.addEventListener('click', () => popupMenu(moreBtn, [
    ['Booking reminders', 'ti-bell', openWatchers],
    ['Currency converter', 'ti-coins', openCurrencyConverter],
    ['Export JSON', 'ti-download', exportJSON],
    ['Export to calendar', 'ti-calendar-down', exportICS],
    ['Replay walkthrough', 'ti-route', () => startTour(true)],
  ]));

  const accountBtn = document.getElementById('vp-account-btn');
  accountBtn.addEventListener('click', () => popupMenu(accountBtn, [
    ['About me', 'ti-user', openProfileDialog],
    ['Sign out', 'ti-logout', () =>
      confirmDialog('Sign out of Odynaut?', { confirmText: 'Sign out' })
        .then(ok => { if (ok) signOut(); })],
  ]));

  async function showApp(user) {
    document.body.classList.remove('vp-signed-out');
    document.getElementById('vp-account-email').textContent = user.email || 'Account';
    accountBtn.hidden = false;
    root.innerHTML = '<div class="vp-loading">Loading your trips…</div>';
    await Promise.all([loadTrips(user.id), loadProfile(user.id), loadFavorites(user.id)]);
    render();
    // First-time walk-through (skipped if a share/photo import is pending).
    if (!tourSeen() && !pendingShare && !pendingSharedPhotoCount) {
      startTour(false);
    }
    if (pendingShare) {
      const text = pendingShare;
      pendingShare = null;
      openImportModal({ text });
    }
    if (pendingSharedPhotoCount) {
      pendingSharedPhotoCount = 0;
      const files = await drainSharedPhotos();
      if (files.length) {
        const { ingestSharedPhotos } = await import('./journal.js');
        ingestSharedPhotos(files);
      }
    }
  }

  function showSignedOut() {
    document.body.classList.add('vp-signed-out');
    accountBtn.hidden = true;
    renderAuthScreen();
  }

  // Generic dropdown anchored under a header button. items: [[label, icon, fn]].
  function popupMenu(anchor, items) {
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
    items.forEach(([label, icon, fn]) => {
      const b = el('button', { class: 'vp-menu-item' },
        el('i', { class: 'ti ' + icon }), el('span', {}, label));
      b.addEventListener('click', () => { bg.remove(); fn(); });
      menu.appendChild(b);
    });
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
