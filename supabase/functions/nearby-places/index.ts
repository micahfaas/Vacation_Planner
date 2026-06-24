// Supabase Edge Function: nearby-places
//
// Given { lat, lng, radius? (m), category? } returns up to 20 nearby venues
// from Google Places (New) "Nearby Search". The Google API key stays
// server-side. Used by the Odynaut mobile "Near me" feature.
//
// Returns { ok, places: [{ name, address, lat, lng, category }] }.
// Maps Google place types onto Odynaut's PLACE_CATEGORIES enum so the mobile
// app can save them directly.
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

// Google place types -> Odynaut place categories. Order matters: first match
// wins. Categories are: staying|restaurant|cafe|bar|cocktail|attraction|shop
// |lodging|other.
const TYPE_MAP: Array<[string, string]> = [
  ['cafe', 'cafe'],
  ['coffee_shop', 'cafe'],
  ['bakery', 'cafe'],
  ['night_club', 'cocktail'],
  ['bar', 'bar'],
  ['restaurant', 'restaurant'],
  ['meal_takeaway', 'restaurant'],
  ['meal_delivery', 'restaurant'],
  ['food', 'restaurant'],
  ['lodging', 'lodging'],
  ['hotel', 'lodging'],
  ['shopping_mall', 'shop'],
  ['store', 'shop'],
  ['clothing_store', 'shop'],
  ['book_store', 'shop'],
  ['tourist_attraction', 'attraction'],
  ['museum', 'attraction'],
  ['art_gallery', 'attraction'],
  ['park', 'attraction'],
  ['amusement_park', 'attraction'],
  ['zoo', 'attraction'],
  ['aquarium', 'attraction'],
];

// When a specific category is requested, narrow the Google search to those types.
const REVERSE_TYPE_MAP: Record<string, string[]> = {
  cafe: ['cafe', 'coffee_shop', 'bakery'],
  bar: ['bar'],
  cocktail: ['bar', 'night_club'],
  restaurant: ['restaurant', 'meal_takeaway'],
  lodging: ['lodging'],
  staying: ['lodging'],
  shop: ['store', 'shopping_mall'],
  attraction: ['tourist_attraction', 'museum', 'art_gallery', 'park'],
};

function categoryFor(types: string[] | undefined): string {
  if (!types || !types.length) return 'other';
  for (const [g, ours] of TYPE_MAP) if (types.includes(g)) return ours;
  return 'other';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('GOOGLE_PLACES_KEY');
  if (!key) return json({ ok: false, error: 'Place search is not configured.' });

  const denied = await requireUser(req);
  if (denied) return denied;

  let lat = 0, lng = 0, radius = 1500, category = '';
  try {
    const body = await req.json();
    lat = Number(body.lat);
    lng = Number(body.lng);
    if (typeof body.radius === 'number' && body.radius > 100 && body.radius <= 5000) radius = body.radius;
    if (typeof body.category === 'string') category = body.category;
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ ok: false, error: 'lat and lng are required numbers.' });
  }

  const reqBody: Record<string, unknown> = {
    maxResultCount: 20,
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
  };
  if (category && REVERSE_TYPE_MAP[category]) {
    reqBody.includedTypes = REVERSE_TYPE_MAP[category];
  }

  let res: Response;
  try {
    res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types,places.id',
      },
      body: JSON.stringify(reqBody),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach Google Places.' });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ ok: false, error: `Nearby search failed (${res.status}).`, detail: detail.slice(0, 300) });
  }

  const data = await res.json().catch(() => ({})) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      types?: string[];
    }>;
  };
  const out = (data.places || []).map((p) => ({
    googlePlaceId: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    category: categoryFor(p.types),
  })).filter((p) => p.name);

  return json({ ok: true, places: out });
});
