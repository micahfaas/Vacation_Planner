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

export async function beginCheckout(tier, interval = 'year') {
  if (!CHECKOUT_LIVE) {
    return alertDialog(
      'Plus and Pro are almost ready — payments are being set up right now. ' +
      'Thanks for the interest; check back very soon!',
      { title: 'Almost ready' }
    );
  }
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
