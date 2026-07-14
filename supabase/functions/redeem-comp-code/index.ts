// Supabase Edge Function: redeem-comp-code
//
// Authenticated. The signed-in browser calls this via supabase.functions.invoke()
// with { code }. We verify the caller's JWT, then redeem atomically through the
// public.redeem_comp_code() SQL function using the service-role key (which is the
// ONLY writer of public.subscriptions / public.comp_codes). A user can never
// grant themselves a plan or bump a code's counter from the browser.
//
// DEPLOY NOTE: this is authenticated, so deploy it NORMALLY (JWT verification ON):
//     supabase functions deploy redeem-comp-code
//
// Secrets / config (already present for the other functions):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Apply supabase/comp_codes.sql once before this function will work.
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

// Redemption failure reasons -> user-facing copy.
const REASON_MSG: Record<string, string> = {
  invalid: "That code isn't valid.",
  inactive: 'That code is no longer active.',
  expired: 'That code has expired.',
  used_up: 'That code has reached its redemption limit.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Server is missing required env vars.' }, 500);
  }

  // Verify the caller from their JWT (same pattern as create-checkout-session).
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

  let code = '';
  try {
    const body = await req.json();
    code = String(body.code ?? '');
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
  if (!code.trim()) return json({ ok: false, error: 'Enter a code.' });

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc('redeem_comp_code', {
      p_user_id: uid,
      p_code: code,
    });
    if (error) {
      return json({ error: 'Could not redeem the code right now. Please try again.' }, 500);
    }
    // data is the jsonb returned by the SQL function.
    const result = (data ?? {}) as { ok?: boolean; tier?: string; reason?: string };
    if (!result.ok) {
      return json({ ok: false, error: REASON_MSG[result.reason ?? ''] || "That code can't be redeemed." });
    }
    return json({ ok: true, tier: result.tier });
  } catch (err) {
    return json({ error: (err as Error).message || 'Something went wrong.' }, 500);
  }
});
