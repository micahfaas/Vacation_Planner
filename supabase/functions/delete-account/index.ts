// Supabase Edge Function: delete-account
//
// Lets a signed-in user permanently delete their own account and all
// associated data. Apple App Store guideline 5.1.1(v) requires apps that
// support account creation to also offer in-app account deletion, which the
// client SDK cannot do (auth.admin.deleteUser needs the service_role key
// that must stay server-side).
//
// Auth model:
// - Caller must send Authorization: Bearer <user JWT> (their normal session)
// - We resolve the user id from that JWT, then use a separate service_role
//   client to actually delete data + the auth.users row
//
// Returns 200 { ok: true } on success; non-2xx with { error } otherwise.
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
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Server is missing Supabase env vars.' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing Authorization: Bearer token.' }, 401);
  }

  // Step 1: identify the caller from their JWT. Using the anon client with
  // the user's auth header ensures we read the JWT just like any other
  // RLS-bound request — and rejects expired / tampered tokens.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'Could not verify your session. Please sign in again.' }, 401);
  }
  const uid = userData.user.id;

  // Step 2: switch to the service-role client for the actual deletes. RLS
  // is bypassed here, but every delete is keyed to `uid`, which we already
  // verified came from a valid token.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Drop all rows the user owns. We swallow per-table errors (best effort)
  // so a stale schema reference does not block the auth-user deletion that
  // matters most — but we surface the first error in the response.
  const errors: string[] = [];

  const tryDelete = async (table: string, column = 'user_id') => {
    const { error } = await admin.from(table).delete().eq(column, uid);
    if (error) errors.push(`${table}: ${error.message}`);
  };

  await tryDelete('trips');
  await tryDelete('profiles');
  await tryDelete('push_subscriptions');

  // Step 3: delete the auth user itself. Anything that references
  // auth.users via ON DELETE CASCADE will go with it.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    return json(
      { error: `Could not delete account: ${delErr.message}`, dataErrors: errors },
      500
    );
  }

  return json({ ok: true, dataErrors: errors });
});
