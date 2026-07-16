// Supabase Edge Function: place-photo
//
// Returns a real venue photo from Google Places (New) for a free-text place
// query (e.g. "Hotel Único Madrid, Calle de Claudio Coello 67, Madrid").
// Two steps: Text Search to find the place + its photo reference, then the
// Place Photo media endpoint (skipHttpRedirect=true) to get a directly-loadable
// image URL — so the API key never leaves the server. Returns
// { ok, image, attribution }. GOOGLE_PLACES_KEY is a server-side secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// COST GUARDRAIL -- see the long note in nearby-places/index.ts. Short version:
// Places API (New) quotas are "Adjustable: No", so Google will not let us set a
// daily ceiling and usage alerts only notify. This guard is the ONLY hard cap.
//
// Sizing: each invocation bills Google TWICE -- searchText (~$0.032) then photo
// media (~$0.007) ~= $0.039. 100/day ~= $3.90/day ~= $117/month. Together with
// nearby-places (~$77/month) the worst case stays inside Google's $200/month
// free credit even if both saturate daily.
//
// The client already caches per session (photoCache in src/cardview.js), so a
// card viewed repeatedly costs one call, not one per render. That in-memory
// cache is all we can do: the Maps terms forbid STORING Places content, and the
// docs are explicit that a photo name "cannot be cached" and "can expire".
const FEATURE = 'place-photo';
const USER_MONTHLY_LIMIT = 60;
const GLOBAL_DAILY_LIMIT = 100;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Reject anyone who is not a signed-in Supabase user. The public anon key
// resolves to no user, so this blocks anonymous callers (the cost-abuse
// vector), while the signed-in app passes through untouched because
// supabase.functions.invoke() always sends the user's JWT. On success returns
// the caller's id plus a service-role client for metering; on failure returns
// a Response to send back. Deliberately does not fail open -- no identity means
// no metering, and unmetered spend is the thing we are guarding against.
// Return type is inferred on purpose: annotating `admin` as
// ReturnType<typeof createClient> doesn't match the generics createClient()
// actually infers here, and TS rejects it.
async function resolveCaller(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (supabaseUrl && anonKey && serviceKey && authHeader.startsWith('Bearer ')) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await userClient.auth.getUser();
      const uid = data?.user?.id;
      if (uid) {
        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        return { uid, admin };
      }
    } catch { /* fall through to rejection */ }
  }
  return json({ ok: false, error: 'Please sign in to use this.' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('GOOGLE_PLACES_KEY');
  if (!key) return json({ ok: false, error: 'Place photos are not configured.' });

  const caller = await resolveCaller(req);
  if (caller instanceof Response) return caller;
  const { uid, admin } = caller;

  let query = '', lat: number | null = null, lng: number | null = null;
  try {
    const body = await req.json();
    query = String(body.query || '').trim().slice(0, 300);
    if (typeof body.lat === 'number' && typeof body.lng === 'number') { lat = body.lat; lng = body.lng; }
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!query) return json({ ok: true, image: '' });

  // Enforce the spend caps BEFORE calling Google. The photo is decorative, so
  // every refusal answers `image: ''` -- the same shape as "no photo found",
  // which the client already handles by quietly dropping the image. A missing
  // photo is a better outcome here than an error toast on a card the user did
  // not ask to decorate. Does NOT fail open: no metering, no spend.
  try {
    const { data: status, error } = await admin.rpc('ai_quota_check', {
      p_user_id: uid,
      p_feature: FEATURE,
      p_user_limit: USER_MONTHLY_LIMIT,
      p_global_limit: GLOBAL_DAILY_LIMIT,
    });
    if (error) throw error;
    if (status !== 'ok') return json({ ok: true, image: '' });
  } catch {
    return json({ ok: true, image: '' });
  }

  // Bias the search to the saved coordinates so an ambiguous name (e.g.
  // "Central") resolves to the place the user means, not the most globally
  // prominent one.
  const reqBody: Record<string, unknown> = { textQuery: query, maxResultCount: 1 };
  if (lat !== null && lng !== null) {
    reqBody.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 30000 } };
  }

  // 1) Find the place + its first photo reference.
  let search: Response;
  try {
    search = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.photos,places.displayName',
      },
      body: JSON.stringify(reqBody),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach Google Places.' });
  }
  // Google has now been billed for the searchText, whatever it returned, so
  // count the invocation here rather than at the end -- a run that finds no
  // photo, or fails on the media step, still cost money. Best-effort: a
  // metering hiccup must not fail a call already paid for.
  try {
    await admin.rpc('ai_quota_increment', { p_user_id: uid, p_feature: FEATURE });
  } catch { /* metering is best-effort */ }

  if (!search.ok) {
    const detail = await search.text().catch(() => '');
    return json({ ok: false, error: `Places search failed (${search.status}).`, detail: detail.slice(0, 300) });
  }

  const sdata = await search.json().catch(() => ({}));
  const place = sdata.places && sdata.places[0];
  const photo = place && place.photos && place.photos[0];
  if (!photo || !photo.name) return json({ ok: true, image: '' });

  // 2) Resolve the photo to a directly-loadable URL (key stays server-side).
  let media: Response;
  try {
    media = await fetch(
      `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=800&skipHttpRedirect=true`,
      { headers: { 'X-Goog-Api-Key': key } },
    );
  } catch {
    return json({ ok: true, image: '' });
  }
  if (!media.ok) return json({ ok: true, image: '' });

  const mdata = await media.json().catch(() => ({}));
  const attribution =
    (photo.authorAttributions && photo.authorAttributions[0] && photo.authorAttributions[0].displayName) || '';
  const name = (place.displayName && place.displayName.text) || '';
  return json({ ok: true, image: mdata.photoUri || '', attribution, name });
});
