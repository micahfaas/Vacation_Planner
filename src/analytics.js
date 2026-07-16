// Privacy-first analytics (PostHog). We count a SMALL set of business events
// -- the upgrade funnel and a couple of activation moments -- with NO cookies,
// NO autocapture, NO session recording, and NO personal data. Event props are
// always small and non-personal (tier names, intervals, feature keys), NEVER
// emails, trip contents, or free text.
//
// Privacy posture (set in init() below):
//   cookieless_mode: 'always'  -- PostHog never writes a cookie or touches
//     localStorage. The visitor id is a rotating server-side daily hash, so
//     there is no persistent identifier and no consent banner is required.
//     REQUIRES "Cookieless server hash mode" to be ON in the PostHog project
//     (Project settings -> Web analytics). Events are dropped without it.
//   autocapture: false         -- we send only the events we write by hand.
//   disable_session_recording  -- we never record screens.
//   Tradeoff: no cross-day or cross-domain identity. Same-day funnels (modal ->
//   checkout -> purchase) still stitch. For "signed up in June, paid in July",
//   query Supabase/Stripe -- they are the authoritative source anyway.
//
// DEBUGGING NOTE (read before "fixing" this): posthog BATCHES events and flushes
// on a timer, so a capture() can take ~10-30s to reach the network. In cookieless
// mode has_opted_out_capturing() also reports TRUE and consent reads 'pending' --
// both are normal (nobody consented; it counts anonymously anyway), NOT a fault.
// Check too early and you will conclude events are blocked when they are merely
// queued, and be tempted to "fix" it with opt_in_capturing(). Don't. Verified
// end-to-end 2026-07-16: a business event fired post-init reaches PostHog (200)
// with zero cookies and zero localStorage.
//
// Completely DARK until ANALYTICS_LIVE is true AND VITE_POSTHOG_KEY is set:
// the posthog-js chunk is never even downloaded, so no one is tracked.
//
// TO GO LIVE:
//   1. Create the PostHog project; turn ON Cookieless server hash mode.
//   2. Set VITE_POSTHOG_KEY (and VITE_POSTHOG_HOST for EU) in .env and as a
//      GitHub repo variable (used by .github/workflows/deploy.yml).
//   3. Set ANALYTICS_LIVE = true and redeploy.
// One-file provider swap: only this file knows about PostHog -- the track()
// call sites stay the same.

export const ANALYTICS_LIVE = true;               // LIVE since 2026-07-16 (PostHog)

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
// US cloud by default; set VITE_POSTHOG_HOST=https://eu.i.posthog.com for EU.
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

let ph = null;        // the live posthog instance, once loaded
let loading = null;   // in-flight import, so we only load once
const pending = [];   // events fired before the import resolved

function enabled() {
  return ANALYTICS_LIVE && !!POSTHOG_KEY && typeof window !== 'undefined';
}

function ensureLoaded() {
  if (!enabled() || loading) return loading;
  loading = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        defaults: '2026-05-30',
        cookieless_mode: 'always',
        // Everything below is OFF on purpose. Several of these fall back to
        // PostHog's REMOTE config when left undefined -- i.e. a toggle in their
        // dashboard could silently switch behaviour back on. Setting them
        // explicitly here makes this file the single source of truth, so our
        // privacy claims can't drift out from under us.
        // We fire the pageview ourselves below instead of letting posthog do
        // it. Its automatic pageview NEVER fires here: we init lazily, after
        // the page has loaded, and `defaults` also rewrites this to
        // 'history_change' (SPA-navigation only). Left automatic, a plain visit
        // records nothing and "visits" reads zero forever. Off + one explicit
        // capture = exactly one pageview per load, with no double-count risk.
        capture_pageview: false,
        autocapture: false,
        capture_dead_clicks: false,       // don't watch click behaviour
        capture_heatmaps: false,
        rageclick: false,
        capture_performance: false,       // no web-vitals beacons
        disable_session_recording: true,
        disable_surveys: true,
        capture_pageleave: false,
        // We don't use feature flags; skip the extra request on every load.
        advanced_disable_flags: true,
        // Never fetch extra third-party scripts (replay/surveys/site apps).
        disable_external_dependency_loading: true,
      });
      ph = posthog;
      ph.capture('$pageview');   // see capture_pageview above -- this is the visit count
      for (const [event, props] of pending.splice(0)) ph.capture(event, props);
      return posthog;
    })
    .catch(() => { loading = null; });  // never let analytics break the app
  return loading;
}

// Load PostHog once at startup (records the visit pageview). Call from app init.
export function initAnalytics() {
  ensureLoaded();
}

// Record one business event. `props` must be small and non-personal. No-op until
// analytics is live, and it must NEVER throw into the app.
export function track(event, props) {
  if (!enabled()) return;
  try {
    ensureLoaded();
    if (ph) ph.capture(event, props);
    else pending.push([event, props]);   // flushed when the import resolves
  } catch { /* analytics must never break the app */ }
}
