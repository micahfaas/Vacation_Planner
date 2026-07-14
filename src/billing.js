// Billing entry points — the bridge from the in-app pricing UI to Stripe.
//
// We never ship Stripe price IDs in the client. The browser asks for a (tier,
// interval); two server-side edge functions (to be built once the Stripe
// account exists) resolve the right price and return a redirect URL:
//   - create-checkout-session -> Stripe-hosted Checkout (subscribe)
//   - create-portal-session    -> Stripe Customer Portal (manage / cancel)
// The stripe-webhook function then writes the resulting plan into
// public.subscriptions, which src/entitlements.js reads.
//
// Until BILLING_LIVE flips true (and those functions are deployed), both calls
// show a friendly "almost ready" message so the UI is fully clickable now.
import { supabase } from './supabase.js';
import { alertDialog } from './dialog.js';
import { CHECKOUT_LIVE } from './entitlements.js';
import { track } from './analytics.js';

export async function beginCheckout(tier, interval = 'year') {
  if (!CHECKOUT_LIVE) {
    return alertDialog(
      'Plus and Pro are almost ready — payments are being set up right now. ' +
      'Thanks for the interest; check back very soon!',
      { title: 'Almost ready' }
    );
  }
  track('Upgrade: Checkout Started', { tier, interval });
  try {
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { tier, interval },
    });
    if (error) throw error;
    if (!data?.url) throw new Error(data?.error || 'Could not start checkout.');
    window.location.assign(data.url);
  } catch (err) {
    alertDialog(err?.message || 'Something went wrong starting checkout.', { title: 'Checkout error' });
  }
}

// Redeem a comp / invite code. Unlike checkout, this does NOT depend on
// CHECKOUT_LIVE -- comp codes are the friends/family seeding mechanism and must
// work before Stripe is live. Returns { ok, tier } on success or { ok:false,
// error } with a user-facing message. The caller refreshes the entitlement.
export async function redeemCompCode(code) {
  try {
    const { data, error } = await supabase.functions.invoke('redeem-comp-code', {
      body: { code },
    });
    if (error) throw error;
    if (!data?.ok) return { ok: false, error: data?.error || 'That code could not be redeemed.' };
    return { ok: true, tier: data.tier };
  } catch (err) {
    return { ok: false, error: err?.message || 'Something went wrong redeeming the code.' };
  }
}

export async function openBillingPortal() {
  if (!CHECKOUT_LIVE) {
    return alertDialog('Billing management will be available once payments are live.', { title: 'Almost ready' });
  }
  try {
    const { data, error } = await supabase.functions.invoke('create-portal-session', { body: {} });
    if (error) throw error;
    if (!data?.url) throw new Error(data?.error || 'Could not open the billing portal.');
    window.location.assign(data.url);
  } catch (err) {
    alertDialog(err?.message || 'Something went wrong.', { title: 'Billing error' });
  }
}
