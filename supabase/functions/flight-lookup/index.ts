// Supabase Edge Function: flight-lookup
//
// Proxies AeroDataBox (RapidAPI) flight lookups so the API key never leaves
// the server. The browser calls this via supabase.functions.invoke() with
// { flightNumber, date }; the function answers with HTTP 200 and a body of
// { ok: true, flights } or { ok: false, error } so the client can branch
// on a single field. The key is read from the AERODATABOX_KEY secret.
const HOST = 'aerodatabox.p.rapidapi.com';

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
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('AERODATABOX_KEY');
  if (!key) return json({ ok: false, error: 'Flight lookup is not configured.' });

  let flightNumber = '', date = '';
  try {
    const body = await req.json();
    flightNumber = String(body.flightNumber || '').replace(/\s+/g, '').toUpperCase();
    date = String(body.date || '');
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!flightNumber || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, error: 'A flight number and date are required.' });
  }

  const url = `https://${HOST}/flights/number/` +
    `${encodeURIComponent(flightNumber)}/${encodeURIComponent(date)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
    });
  } catch {
    return json({ ok: false, error: 'Network error during flight lookup.' });
  }

  if (res.status === 404) return json({ ok: false, error: 'No flight found for that number and date.' });
  if (res.status === 401 || res.status === 403) return json({ ok: false, error: 'Flight API key was rejected.' });
  if (res.status === 429) return json({ ok: false, error: 'Flight API rate limit reached — try again later.' });
  if (!res.ok) return json({ ok: false, error: `Flight lookup failed (${res.status}).` });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return json({ ok: false, error: 'Flight lookup returned an unreadable response.' });
  }

  const flights = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as { flights?: unknown }).flights)
        ? (data as { flights: unknown[] }).flights
        : []);
  if (!flights.length) {
    return json({ ok: false, error: 'No flight found for that number and date.' });
  }

  return json({ ok: true, flights });
});
