// Privacy-first analytics (Plausible). We count a SMALL set of business events
// -- the upgrade funnel and a couple of activation moments -- with NO cookies,
// NO personal data, and NO cross-site tracking (Plausible's defaults). Event
// props are always small and non-personal (tier names, intervals, feature keys),
// NEVER emails, trip contents, or free text.
//
// Completely DARK until ANALYTICS_LIVE is true: nothing loads and nothing is
// sent, so no one is tracked until you create the Plausible account and flip it.
//
// TO GO LIVE:
//   1. Register the app's domain as a "site" in Plausible (plausible.io).
//   2. Set PLAUSIBLE_DOMAIN below to exactly that site name.
//   3. Set ANALYTICS_LIVE = true and redeploy.
// One-file provider swap: to move to PostHog later, only this file changes --
// the track() call sites stay the same.

export const ANALYTICS_LIVE = false;                 // flip true once Plausible is set up
const PLAUSIBLE_DOMAIN = 'odynaut.com';              // must match the Plausible "site" name
const PLAUSIBLE_SRC = 'https://plausible.io/js/script.js';

let loaded = false;

function ensureLoaded() {
  if (loaded || !ANALYTICS_LIVE || typeof document === 'undefined') return;
  loaded = true;
  // Queue shim so track() calls made before the script finishes loading are kept.
  window.plausible = window.plausible || function () {
    (window.plausible.q = window.plausible.q || []).push(arguments);
  };
  const s = document.createElement('script');
  s.defer = true;
  s.src = PLAUSIBLE_SRC;
  s.setAttribute('data-domain', PLAUSIBLE_DOMAIN);
  document.head.appendChild(s);
}

// Load Plausible once at startup (records the visit pageview). Call from app init.
export function initAnalytics() {
  ensureLoaded();
}

// Record one business event. `props` must be small and non-personal. No-op until
// analytics is live, and it must NEVER throw into the app.
export function track(event, props) {
  if (!ANALYTICS_LIVE) return;
  try {
    ensureLoaded();
    window.plausible(event, props ? { props } : undefined);
  } catch { /* analytics must never break the app */ }
}
