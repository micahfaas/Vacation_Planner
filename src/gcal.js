// Google Calendar connect — reads upcoming events via OAuth, fully
// client-side (no server). Enabled only when VITE_GOOGLE_CLIENT_ID is set.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

export function gcalEnabled() {
  return !!CLIENT_ID;
}

// Load Google Identity Services once.
let gisPromise = null;
function loadGIS() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in.')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

// Warm the GIS script up so the OAuth popup opens promptly on click.
export function preloadGIS() {
  if (CLIENT_ID) loadGIS().catch(() => { /* retried on use */ });
}

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: resp => {
        if (resp && resp.access_token) resolve(resp.access_token);
        else reject(new Error('Google sign-in did not complete.'));
      },
      error_callback: () => reject(new Error('Google sign-in was cancelled.'))
    });
    client.requestAccessToken();
  });
}

async function fetchEvents(token) {
  const now = Date.now();
  const timeMin = new Date(now - 30 * 86400000).toISOString();
  const timeMax = new Date(now + 365 * 86400000).toISOString();
  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    + '?singleEvents=true&orderBy=startTime&maxResults=250'
    + '&timeMin=' + encodeURIComponent(timeMin)
    + '&timeMax=' + encodeURIComponent(timeMax);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('Could not read your Google Calendar (' + res.status + ').');
  const data = await res.json();
  return data.items || [];
}

// Resolves to an array of Google Calendar event objects.
export async function connectGoogleCalendar() {
  if (!CLIENT_ID) throw new Error('Google Calendar is not configured.');
  await loadGIS();
  const token = await getAccessToken();
  return fetchEvents(token);
}
