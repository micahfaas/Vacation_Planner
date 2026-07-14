// Supabase Edge Function: create-checkout-session
//
// Starts a Stripe-hosted Checkout for an Odynaut subscription. The signed-in
// browser calls this via supabase.functions.invoke() with { tier, interval };
// we verify the user's JWT, find-or-create their Stripe customer, and return
// { url } for the client to redirect to. Price IDs and the secret key live in
// server-side env only -- no Stripe IDs ever ship in the client.
//
// Secrets / config (set with `supabase secrets set NAME=value`):
//   STRIPE_SECRET_KEY        sk_test_... (then sk_live_... at launch)
//   STRIPE_PRICE_PLUS_YEAR   STRIPE_PRICE_PLUS_MONTH
//   STRIPE_PRICE_PRO_YEAR    STRIPE_PRICE_PRO_MONTH
//   STRIPE_PRICE_LIFETIME    one-time price for Founding Lifetime Plus
//   LIFETIME_PLUS_CAP (opt)  sold-out cap for lifetime, default 100
//   APP_URL (optional)       fallback redirect origin if no Origin header
import Stripe from 'npm:stripe@17';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// (tier, interval) -> the env var holding that Stripe price id.
const PRICE_ENV: Record<string, string> = {
  'plus:year': 'STRIPE_PRICE_PLUS_YEAR',
  'plus:month': 'STRIPE_PRICE_PLUS_MONTH',
  'pro:year': 'STRIPE_PRICE_PRO_YEAR',
  'pro:month': 'STRIPE_PRICE_PRO_MONTH',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey) {
    return json({ error: 'Server is missing required env vars.' }, 500);
  }

  // Verify the caller from their JWT (same pattern as delete-account).
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing Authorization: Bearer token.' }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'Could not verify your session. Please sign in again.' }, 401);
  }
  const uid = userData.user.id;
  const email = userData.user.email ?? undefined;

  let tier = '', interval = '';
  try {
    const body = await req.json();
    tier = String(body.tier ?? '');
    interval = String(body.interval ?? 'year');
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
  // 'lifetime' is a one-time Founding purchase (Plus forever); everything else is
  // a recurring plus/pro subscription.
  const isLifetime = tier === 'lifetime';
  if (!isLifetime && (!['plus', 'pro'].includes(tier) || !['year', 'month'].includes(interval))) {
    return json({ error: 'Unknown plan.' }, 400);
  }
  const priceId = isLifetime
    ? Deno.env.get('STRIPE_PRICE_LIFETIME')
    : Deno.env.get(PRICE_ENV[`${tier}:${interval}`]);
  if (!priceId) {
    return json({ error: 'That plan is not configured yet.' }, 500);
  }

  try {
    const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Founding Lifetime is capped. Best-effort sold-out check against the count
    // of lifetime rows already written (a tiny race right at the cap is fine for
    // a ~100 evangelist offer; we never refund someone who already paid).
    if (isLifetime) {
      const cap = parseInt(Deno.env.get('LIFETIME_PLUS_CAP') ?? '100', 10);
      const { count } = await admin.from('subscriptions')
        .select('user_id', { count: 'exact', head: true })
        .eq('source', 'lifetime');
      if ((count ?? 0) >= cap) {
        return json({ error: 'The Founding Lifetime offer is sold out — thank you!' }, 200);
      }
    }

    // Reuse the user's Stripe customer if we already have one; otherwise create
    // it (tagged with user_id so the webhook can always map back) and store it.
    const { data: subRow } = await admin
      .from('subscriptions').select('stripe_customer_id').eq('user_id', uid).maybeSingle();
    let customerId = subRow?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { user_id: uid } });
      customerId = customer.id;
      await admin.from('subscriptions').upsert(
        { user_id: uid, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    }

    const origin = req.headers.get('origin') || Deno.env.get('APP_URL') || 'https://odynaut.app';
    const session = await stripe.checkout.sessions.create({
      mode: isLifetime ? 'payment' : 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: uid,
      ...(isLifetime
        ? {
            metadata: { user_id: uid, kind: 'lifetime' },
            payment_intent_data: { metadata: { user_id: uid, kind: 'lifetime' } },
          }
        : { subscription_data: { metadata: { user_id: uid, tier } } }),
      success_url: `${origin}/?upgraded=1`,
      cancel_url: `${origin}/?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (err) {
    return json({ error: (err as Error).message || 'Could not start checkout.' }, 500);
  }
});
