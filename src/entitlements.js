// Entitlements & feature gating. A user's plan (free | plus | pro) is the single
// source of truth for which features and limits they get.
//
// TRUST MODEL: the plan is WRITTEN server-side only -- by the stripe-webhook
// edge function (service role) into public.subscriptions. The client only READS
// it (RLS lets a user read their own row), so the browser can never grant
// itself Pro. We cache the resolved tier in localStorage so gates still work
// offline, mirroring the vault/benefits load pattern.
//
// LIMITS ARE CONFIG, NOT CODE: the TIERS table below is the ONE place the
// free/Plus/Pro split lives. Tuning the product (how many free trips, vault
// items, AI calls) is a one-line change here -- no feature code is touched.
// The server (supabase/usage.sql) remains the real enforcer for AI quotas;
// these client numbers drive in-app messaging and pre-checks.
import { supabase } from './supabase.js';
import { getUserId } from './storage.js';

const CACHE_KEY = 'vacation_planner_tier_';
const DEFAULT_TIER = 'free';

// Two launch switches, intentionally separate so we can test real checkout in
// Stripe test mode WITHOUT yet enforcing limits on current free users:
//   CHECKOUT_LIVE — do the upgrade buttons call Stripe (true) or show an
//                   "almost ready" message (false)? Flip true once the Stripe
//                   edge functions are deployed and configured.
//   GATING_LIVE   — are the free-plan limits enforced? Flip true at public
//                   launch, and first seed existing users a 'comp' subscriptions
//                   row so they are never suddenly capped.
export const CHECKOUT_LIVE = false;  // flip to true at launch (with LIVE Stripe keys)
export const GATING_LIVE = false;
export function gatingActive() { return GATING_LIVE; }

// AI feature keys match the FEATURE strings in the edge functions / usage.sql.
export const TIERS = {
  free: {
    label: 'Explorer',
    trips: 2,
    vaultItems: 5,
    benefitsReminders: false,        // can view the tracker, can't arm reminders
    transferAdvisor: 'basic',
    awardSearch: false,
    ai: { 'co-planner': 3, 'trip-ideas': 3, 'destination-guide': 1, 'trip-journal': 1, 'trip-check': 5 },
  },
  plus: {
    label: 'Plus',
    trips: Infinity,
    vaultItems: Infinity,
    benefitsReminders: true,
    transferAdvisor: 'full',
    awardSearch: false,
    ai: { 'co-planner': 50, 'trip-ideas': 30, 'destination-guide': 30, 'trip-journal': 20, 'trip-check': 60 },
  },
  pro: {
    label: 'Pro',
    trips: Infinity,
    vaultItems: Infinity,
    benefitsReminders: true,
    transferAdvisor: 'full',
    awardSearch: true,
    ai: { 'co-planner': 150, 'trip-ideas': 100, 'destination-guide': 100, 'trip-journal': 60, 'trip-check': 200 },
  },
};

let currentTier = DEFAULT_TIER;

function readCache(uid) {
  try {
    const raw = localStorage.getItem(CACHE_KEY + uid);
    return raw && TIERS[raw] ? raw : null;
  } catch { return null; }
}

function writeCache(uid, tier) {
  try { localStorage.setItem(CACHE_KEY + uid, tier); } catch { /* ignore */ }
}

// A subscription counts only if it is live (active/trialing/comp) and has not
// lapsed past the paid-through date. Mirrors public.current_tier() in SQL.
function resolveTier(row) {
  if (!row) return DEFAULT_TIER;
  if (!['active', 'trialing', 'comp'].includes(row.status)) return DEFAULT_TIER;
  if (row.current_period_end && new Date(row.current_period_end).getTime() < Date.now()) {
    return DEFAULT_TIER;
  }
  return TIERS[row.tier] ? row.tier : DEFAULT_TIER;
}

// Load on sign-in (called from main.js showApp, alongside loadVault etc.).
// Falls back to the cached tier if the network/DB is unavailable.
export async function loadEntitlement(uid) {
  currentTier = readCache(uid) || DEFAULT_TIER;
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('tier, status, current_period_end')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) throw error;
    currentTier = resolveTier(data);
    writeCache(uid, currentTier);
  } catch (e) {
    console.warn('Entitlement load failed; using cached tier.', e);
  }
  return currentTier;
}

export function getTier() { return currentTier; }
export function tierConfig() { return TIERS[currentTier] || TIERS[DEFAULT_TIER]; }
export function isPaid() { return currentTier === 'plus' || currentTier === 'pro'; }
export function isPro() { return currentTier === 'pro'; }

// Numeric limit for a counted resource ('trips' | 'vaultItems'). May be Infinity.
export function limitFor(resource) {
  const v = tierConfig()[resource];
  return typeof v === 'number' ? v : 0;
}

// Boolean feature flag ('benefitsReminders' | 'awardSearch').
export function hasFeature(flag) {
  return Boolean(tierConfig()[flag]);
}

// Monthly AI cap for a feature key (matches the edge-function FEATURE names).
export function aiLimitFor(feature) {
  const ai = tierConfig().ai || {};
  return typeof ai[feature] === 'number' ? ai[feature] : 0;
}

// True if adding one more of `resource` (current count `have`) is within the
// plan's limit. Gating call sites use this, then show an upgrade nudge if false.
export function canAdd(resource, have) {
  return have < limitFor(resource);
}

// Convenience for call sites that already hold the user id elsewhere.
export function currentUserId() { return getUserId(); }
