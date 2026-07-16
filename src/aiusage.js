// Advisory client-side monthly AI usage counter + the pre-check upgrade nudge.
//
// The SERVER (supabase/usage.sql) is the REAL quota enforcer -- Phase 2 makes it
// tier-aware. This module exists only so a Free user who is out of, say, their
// monthly co-planner asks sees a friendly upgrade nudge BEFORE we spend a
// round-trip and a Claude call, instead of a raw "quota exceeded" error.
//
// It is deliberately lightweight and best-effort: counts live in localStorage,
// keyed per user + per UTC month (matching the server's period bucket), and are
// NOT authoritative -- clearing storage resets them, and a second device won't
// see the first's count. That is fine: the server still caps the actual spend.
//
// Everything here is a no-op unless gatingActive() is true, so it changes
// nothing for current users until GATING_LIVE is flipped at launch.
import { gatingActive, aiLimitFor, currentUserId } from './entitlements.js';
import { requireUpgrade } from './upgrade.js';
import { track } from './analytics.js';

const KEY = 'vacation_planner_aiuse_';

// 'YYYY-MM' in UTC -- same bucket the server uses in usage.sql (ai_usage_user.period).
function period() {
  return new Date().toISOString().slice(0, 7);
}

function bucketKey() {
  return KEY + (currentUserId() || 'anon') + '_' + period();
}

function readBucket() {
  try {
    const raw = localStorage.getItem(bucketKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeBucket(b) {
  try { localStorage.setItem(bucketKey(), JSON.stringify(b)); } catch { /* ignore */ }
}

// This month's client-tracked call count for a feature key (e.g. 'co-planner').
export function aiUsed(feature) {
  const n = readBucket()[feature];
  return typeof n === 'number' ? n : 0;
}

// Record one successful AI call. Call this AFTER the server has accepted a call
// (i.e. after a successful response), never on failure -- mirroring the server,
// which only counts successful calls.
export function noteAiCall(feature) {
  const b = readBucket();
  b[feature] = (typeof b[feature] === 'number' ? b[feature] : 0) + 1;
  writeBucket(b);
  track('AI Used', { feature });
}

// Pre-check gate. Returns true if the call may proceed. When gating is active and
// the user is already at/over this month's client-tracked cap for `feature`,
// it shows the upgrade nudge and returns false. `highlight` is the tier to
// feature in the modal (default Plus). Call sites: `if (!allowAiCall(f)) return;`.
export function allowAiCall(feature, { reason, highlight = 'plus' } = {}) {
  if (!gatingActive()) return true;
  if (aiUsed(feature) < aiLimitFor(feature)) return true;
  requireUpgrade(reason ||
    "You've used this month's AI allowance on the free plan. Upgrade to Plus for more.",
    highlight, 'ai-limit:' + feature);
  return false;
}
