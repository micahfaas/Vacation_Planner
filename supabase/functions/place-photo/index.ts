// Supabase Edge Function: place-photo
//
// Returns a real venue photo from Google Places (New) for a free-text place
// query (e.g. "Hotel Único Madrid, Calle de Claudio Coello 67, Madrid").
// Two steps: Text Search to find the place + its photo reference, then the
// Place Photo media endpoint (skipHttpRedirect=true) to get a directly-loadable
// image URL — so the API key never leaves the server. Returns
// { ok, image, attribution }. GOOGLE_PLACES_KEY is a server-side secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
// supabase.functions.invoke() always sends the user's JWT. Returns a Response
// to send back on rejection, or null when the caller is authenticated.
async function requireUser(req: Request): Promise<Response | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (supabaseUrl && anonKey && authHeader.startsWith('Bearer ')) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await userClient.auth.getUser();
      if (data?.user?.id) return null;
    } catch { /* fall through to rejection */ }
  }
  return json({ ok: false, error: 'Please sign in to use this.' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('GOOGLE_PLACES_KEY');
  if (!key) return json({ ok: false, error: 'Place photos are not configured.' });

  const denied = await requireUser(req);
  if (denied) return denied;

  let query = '', lat: number | null = null, lng: number | null = null;
  try {
    const body = await req.json();
    query = String(body.query || '').trim().slice(0, 300);
    if (typeof body.lat === 'number' && typeof body.lng === 'number') { lat = body.lat; lng = body.lng; }
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!query) return json({ ok: true, image: '' });

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
