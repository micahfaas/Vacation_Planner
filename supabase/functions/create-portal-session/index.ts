// Supabase Edge Function: create-portal-session
//
// Opens the Stripe Customer Portal so a subscriber can update payment, switch
// plans, or cancel. The signed-in browser calls this via
// supabase.functions.invoke(); we verify the JWT, look up their stored Stripe
// customer, and return { url } to redirect to.
//
// Secrets / config:
//   STRIPE_SECRET_KEY        (shared with create-checkout-session)
//   APP_URL (optional)       fallback return origin
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

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: subRow } = await admin
      .from('subscriptions').select('stripe_customer_id').eq('user_id', uid).maybeSingle();
    const customerId = subRow?.stripe_customer_id as string | undefined;
    if (!customerId) {
      return json({ error: 'No billing account yet — subscribe first.' }, 400);
    }

    const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
    const origin = req.headers.get('origin') || Deno.env.get('APP_URL') || 'https://odynaut.app';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: origin,
    });
    return json({ url: session.url });
  } catch (err) {
    return json({ error: (err as Error).message || 'Could not open the billing portal.' }, 500);
  }
});
