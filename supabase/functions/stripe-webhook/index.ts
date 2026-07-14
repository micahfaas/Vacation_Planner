// Supabase Edge Function: stripe-webhook
//
// Stripe calls this server-to-server whenever a subscription changes. It is the
// ONLY writer of public.subscriptions: it verifies Stripe's signature, maps the
// event to a plan, and upserts the user's row — which src/entitlements.js then
// reads. A user can never set their own plan from the browser.
//
// DEPLOY NOTE: this function must be PUBLIC (Stripe cannot send a Supabase JWT),
// so deploy it with JWT verification OFF:
//     supabase functions deploy stripe-webhook --no-verify-jwt
// Security comes from Stripe's signature check below, not from a Supabase JWT.
//
// Secrets / config:
//   STRIPE_SECRET_KEY        (shared)
//   STRIPE_WEBHOOK_SECRET    whsec_... (from the Stripe webhook endpoint)
//   STRIPE_PRICE_PLUS_YEAR  STRIPE_PRICE_PLUS_MONTH
//   STRIPE_PRICE_PRO_YEAR   STRIPE_PRICE_PRO_MONTH
import Stripe from 'npm:stripe@17';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Stripe subscription.status -> our subscriptions.status enum.
function mapStatus(s: string): string {
  switch (s) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired': return 'canceled';
    default: return 'inactive'; // incomplete, paused, etc.
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!supabaseUrl || !serviceKey || !stripeKey || !webhookSecret) {
    return new Response('Server is missing required env vars.', { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw, sig!, webhookSecret, undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    return new Response(`Signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  // One-time Founding Lifetime purchase creates no subscription, so we grant it
  // from checkout.session.completed. Subscription checkouts ALSO emit this event,
  // but those are handled by the customer.subscription.* branch below, so we act
  // only on a lifetime payment and ignore everything else here.
  if (event.type === 'checkout.session.completed') {
    // deno-lint-ignore no-explicit-any
    const session = event.data.object as any;
    if (session.mode !== 'payment' || session.metadata?.kind !== 'lifetime') {
      return new Response(JSON.stringify({ received: true, ignored: 'non-lifetime checkout' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    const lifeUid: string | undefined = session.metadata?.user_id ?? session.client_reference_id ?? undefined;
    const lifeCust: string | undefined = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!lifeUid) {
      return new Response(JSON.stringify({ received: true, unattributed: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Plus forever: active + no period end (never lapses), tagged source=lifetime
    // so the checkout cap can count it.
    const { error } = await admin.from('subscriptions').upsert({
      user_id: lifeUid,
      tier: 'plus',
      status: 'active',
      source: 'lifetime',
      current_period_end: null,
      cancel_at_period_end: false,
      stripe_customer_id: lifeCust,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) return new Response(`DB upsert failed: ${error.message}`, { status: 500 });
    return new Response(JSON.stringify({ received: true, lifetime: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // We only act on subscription lifecycle events; everything else is acked.
  if (!event.type.startsWith('customer.subscription.')) {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const priceTier: Record<string, string> = {
    [Deno.env.get('STRIPE_PRICE_PLUS_YEAR') ?? '_']: 'plus',
    [Deno.env.get('STRIPE_PRICE_PLUS_MONTH') ?? '_']: 'plus',
    [Deno.env.get('STRIPE_PRICE_PRO_YEAR') ?? '_']: 'pro',
    [Deno.env.get('STRIPE_PRICE_PRO_MONTH') ?? '_']: 'pro',
  };

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // deno-lint-ignore no-explicit-any
  const evtSub = event.data.object as any;
  const subId: string = evtSub.id;

  // Stripe events can arrive OUT OF ORDER, so an older 'incomplete' status can
  // otherwise clobber a newer 'active' one. Re-fetch the subscription's current
  // truth so the event order cannot matter. ('deleted' is terminal — trust it.)
  // deno-lint-ignore no-explicit-any
  let sub: any = evtSub;
  if (event.type !== 'customer.subscription.deleted') {
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch (_e) {
      sub = evtSub; // fall back to the event payload if the re-fetch fails
    }
  }

  const customerId: string = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

  // Resolve the user: prefer the metadata we stamped at checkout, else look the
  // customer up in our own table (the checkout flow created that row first).
  let userId: string | undefined = sub.metadata?.user_id ?? evtSub.metadata?.user_id;
  if (!userId && customerId) {
    const { data } = await admin
      .from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
    userId = data?.user_id;
  }
  if (!userId) {
    // Nothing we can attribute this to; ack so Stripe doesn't retry forever.
    return new Response(JSON.stringify({ received: true, unattributed: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const priceId: string | undefined = sub.items?.data?.[0]?.price?.id;
  let tier = (priceId && priceTier[priceId]) || 'free';
  let status = mapStatus(sub.status);
  if (event.type === 'customer.subscription.deleted') {
    tier = 'free';
    status = 'canceled';
  }

  const periodEndUnix: number | undefined = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;

  const { error } = await admin.from('subscriptions').upsert({
    user_id: userId,
    tier,
    status,
    source: 'stripe',
    current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) {
    // 500 so Stripe retries; the event is idempotent (keyed by user_id).
    return new Response(`DB upsert failed: ${error.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
