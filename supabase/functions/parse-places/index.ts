// Supabase Edge Function: parse-places
//
// Turns a traveler's free-text research (often pasted from a chat — a list of
// cafés, restaurants, bars, attractions, shops, lodging, etc.) into structured
// Place entries for the Places library. The browser calls this via
// supabase.functions.invoke() with { text }; the function answers HTTP 200
// with { ok: true, places } or { ok: false, error }. ANTHROPIC_API_KEY is a
// server-side secret.
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

const SYSTEM = `You extract places of interest from a traveler's research notes — restaurants, cafés, bars, attractions, shops, lodging, and similar — often pasted from a chat or article.

Return a JSON object: { "places": [ ... ] }. Each place has ALL of these fields:

- name: the place's name.
- category: one of "restaurant", "cafe", "bar", "cocktail", "attraction", "shop", "lodging", "other".
- address: the full street address including the city, if you know it for this well-known place. "" otherwise. Never invent an address.
- notes: a concise one- or two-sentence description — what it is, why it's notable, any tips from the source text.

Rules:
- The text is often a markdown or bulleted list: lines may start with -, *, •, ▪, or a number, names may be wrapped in ** for bold, and links may appear as [text](url). Treat each bullet or line as a candidate place, and NEVER include markdown or bullet characters (*, _, #, •, -, backticks) in the name or notes — output clean plain text.
- Extract every distinct place mentioned. Do not merge or skip places.
- Choose categories carefully: "cafe" is for coffee shops; "bar" for bars and pubs; "cocktail" is for cocktail bars specifically; "attraction" for sights, museums, parks, tours; "shop" for stores and markets; "lodging" for hotels/hostels/Airbnbs; "other" only if none of the above fit.
- Fill "address" only with a real, complete street address you are confident about — include the city. If you are not sure, leave it "". Never guess.
- If the text contains no places, return { "places": [] }.`;

const SCHEMA = {
  type: 'object',
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: ['restaurant', 'cafe', 'bar', 'cocktail', 'attraction', 'shop', 'lodging', 'other'] },
          address: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['name', 'category', 'address', 'notes'],
        additionalProperties: false,
      },
    },
  },
  required: ['places'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, error: 'AI import is not configured.' });

  let text = '';
  try {
    const body = await req.json();
    text = String(body.text || '');
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!text.trim()) return json({ ok: false, error: 'No text to read.' });
  text = text.slice(0, 20000);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 8000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: text }],
      }),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach the AI service.' });
  }

  if (res.status === 401 || res.status === 403) return json({ ok: false, error: 'AI key was rejected.' });
  if (res.status === 429) return json({ ok: false, error: 'AI rate limit reached — try again shortly.' });
  if (!res.ok) return json({ ok: false, error: `AI request failed (${res.status}).` });

  let data: { content?: Array<{ type?: string; text?: string }> };
  try {
    data = await res.json();
  } catch {
    return json({ ok: false, error: 'Unreadable AI response.' });
  }

  const block = (data.content || []).find((b) => b && b.type === 'text');
  if (!block || !block.text) return json({ ok: false, error: 'The AI returned no result.' });

  let parsed: { places?: unknown };
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return json({ ok: false, error: 'The AI returned malformed output.' });
  }

  const places = Array.isArray(parsed.places) ? parsed.places : [];
  return json({ ok: true, places });
});
