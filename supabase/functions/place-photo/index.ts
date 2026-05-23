// Supabase Edge Function: place-photo
//
// Returns a real venue photo from Google Places (New) for a free-text place
// query (e.g. "Hotel Único Madrid, Calle de Claudio Coello 67, Madrid").
// Two steps: Text Search to find the place + its photo reference, then the
// Place Photo media endpoint (skipHttpRedirect=true) to get a directly-loadable
// image URL — so the API key never leaves the server. Returns
// { ok, image, attribution }. GOOGLE_PLACES_KEY is a server-side secret.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('GOOGLE_PLACES_KEY');
  if (!key) return json({ ok: false, error: 'Place photos are not configured.' });

  let query = '';
  try {
    const body = await req.json();
    query = String(body.query || '').trim().slice(0, 300);
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!query) return json({ ok: true, image: '' });

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
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
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
  return json({ ok: true, image: mdata.photoUri || '', attribution });
});
