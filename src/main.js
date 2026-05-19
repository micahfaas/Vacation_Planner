// App entry: gate on the Supabase session, wire the header, boot the planner.
import './styles.css';
import { supabase } from './supabase.js';
import { renderAuthScreen, signOut } from './auth.js';
import { loadTrips } from './storage.js';
import { render } from './render.js';
import { exportJSON, importJSON } from './io.js';
import { exportICS } from './ics.js';
import { openTripsMenu } from './trips.js';

document.getElementById('vp-trips-btn').addEventListener('click', openTripsMenu);
document.getElementById('vp-export-btn').addEventListener('click', exportJSON);
document.getElementById('vp-ics-btn').addEventListener('click', exportICS);
document.getElementById('vp-import-btn').addEventListener('click', () => document.getElementById('vp-import-file').click());
document.getElementById('vp-import-file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) importJSON(f);
  e.target.value = '';
});

const accountBtn = document.getElementById('vp-account-btn');
accountBtn.addEventListener('click', () => {
  if (confirm('Sign out of Vacation Planner?')) signOut();
});

const root = document.getElementById('vp-root');

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
