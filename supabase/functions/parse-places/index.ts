// Supabase Edge Function: parse-places
//
// Turns a traveler's free-text research (often pasted from a chat — a list of
// cafés, restaurants, bars, attractions, shops, lodging, etc.) into structured
// Place entries for the Places library. The browser calls this via
// supabase.functions.invoke() with { text }; the function answers HTTP 200
// with { ok: true, places } or { ok: false, error }. ANTHROPIC_API_KEY is a
// server-side secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// AI usage quotas (cost guardrails). parse-places runs Haiku (<1c/call); the
// limits mainly guard against runaway abuse. Enforced before the Anthropic
// call; only successful calls counted. Tunable here with a redeploy. See
// supabase/usage.sql + project_ai_cost_guardrails.
const FEATURE = 'parse-places';
const USER_MONTHLY_LIMIT = 30;
const GLOBAL_DAILY_LIMIT = 150;

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
- category: one of "restaurant", "cafe", "coffee", "bakery", "dessert", "bar", "brewery", "wine", "cocktail", "attraction", "viewpoint", "park", "museum", "market", "shop", "lodging", "other".
- address: the full street address including the city, if you know it for this well-known place. "" otherwise. Never invent an address.
- notes: a concise one- or two-sentence description — what it is, why it's notable, any tips from the source text.

Rules:
- The text is often a markdown or bulleted list: lines may start with -, *, •, ▪, or a number, names may be wrapped in ** for bold, and links may appear as [text](url). Treat each bullet or line as a candidate place, and NEVER include markdown or bullet characters (*, _, #, •, -, backticks) in the name or notes — output clean plain text.
- Extract every distinct place mentioned. Do not merge or skip places.
- Choose categories carefully: "cafe" = sit-down cafés and brunch spots; "coffee" = dedicated specialty coffee, espresso bars, and roasters; "bakery" = bakeries and patisseries; "dessert" = ice cream, gelato, and dessert shops; "bar" = general bars and pubs; "brewery" = breweries and taprooms; "wine" = wine bars; "cocktail" = cocktail bars specifically; "attraction" = general sights and tours; "viewpoint" = scenic overlooks and lookouts; "park" = parks, gardens, beaches, and nature; "museum" = museums and galleries; "market" = food markets and night markets; "shop" = stores; "lodging" = hotels/hostels/Airbnbs; "other" only if none fit.
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
          category: { type: 'string', enum: ['restaurant', 'cafe', 'coffee', 'bakery', 'dessert', 'bar', 'brewery', 'wine', 'cocktail', 'attraction', 'viewpoint', 'park', 'museum', 'market', 'shop', 'lodging', 'other'] },
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

  // Identify the caller (from their JWT) and enforce usage quotas before
  // spending on the model. Fails open if Supabase identity/metering is
  // unavailable, so the feature never breaks on an infra hiccup.
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';

  let uid: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;
  if (supabaseUrl && anonKey && serviceKey && authHeader.startsWith('Bearer ')) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData } = await userClient.auth.getUser();
      uid = userData?.user?.id ?? null;
      admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch {
      admin = null;
    }
  }

  if (admin) {
    try {
      const { data: status } = await admin.rpc('ai_quota_check', {
        p_user_id: uid,
        p_feature: FEATURE,
        p_user_limit: USER_MONTHLY_LIMIT,
        p_global_limit: GLOBAL_DAILY_LIMIT,
      });
      if (status === 'user_limit') {
        return json({ ok: false, error: "You have reached this month's import limit. It resets on the 1st." });
      }
      if (status === 'global_limit') {
        return json({ ok: false, error: 'Import is taking a breather right now — please try again later.' });
      }
    } catch {
      // Fail open: a metering hiccup should not block the feature.
    }
  }

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

  // Successful call — count it against the quotas (best effort).
  if (admin) {
    try {
      await admin.rpc('ai_quota_increment', { p_user_id: uid, p_feature: FEATURE });
    } catch { /* metering is best-effort */ }
  }

  const places = Array.isArray(parsed.places) ? parsed.places : [];
  return json({ ok: true, places });
});
