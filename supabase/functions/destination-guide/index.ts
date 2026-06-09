// Supabase Edge Function: destination-guide
//
// Generates a per-trip "know before you go" cheat sheet with Claude: entry
// requirements, health basics, money + tipping, plugs, emergency numbers,
// transit, typical weather for the dates, and key phrases — one guide per
// destination country on the trip. The client calls this via
// supabase.functions.invoke() with { places, startDate, endDate,
// passportCountry? } and caches the result on the trip, so a guide is
// generated once per trip unless the user refreshes it.
//
// PRIVACY: input is only the destination list + dates + an OPTIONAL
// passport-country string the user types in the guide dialog. Nothing is read
// from the vault (travel documents) — see the isolation contract in vault.js.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// AI usage quotas (cost guardrails). Haiku, <1c/call; same limits as the
// other Haiku features. Enforced before the Anthropic call; only successful
// calls are counted. See supabase/usage.sql + project_ai_cost_guardrails.
const FEATURE = 'destination-guide';
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

const SYSTEM = `You write a compact, practical "know before you go" cheat sheet for travelers.

You are given the trip's destination cities/places, the travel dates, and sometimes the traveler's passport country. Group the destinations by COUNTRY and return one guide per country (a city list like "Madrid, Sevilla, Granada" is one guide for Spain).

Skip the traveler's HOME country: when the passport country is given and some listed cities are in it (typically the departure airports at the start and end of the trip), do not write a guide for that country. Likewise, when one or two cities from a different country than the rest look like mere transit/origin points, focus on the main destination. Only write a home-country guide if every place on the trip is in it.

Return JSON: { "guides": [ ... ] }. Each guide has ALL of these string fields (2-4 short sentences each, plain language, no markdown):

- destination: the country name, plus the covered cities in parentheses when helpful.
- entry: visa/entry requirements and passport-validity rules. If a passport country was provided, answer for that nationality specifically. If not, cover the common cases briefly (e.g. "US/UK/EU passports: ..."). Mention e-visas/ESTA/ETIAS-style pre-registrations where they apply for the travel dates.
- health: recommended/required vaccinations for typical tourism, and whether tap water is safe to drink.
- money: the currency, typical card acceptance vs cash needs, and tipping norms (restaurants, taxis).
- power: plug type letter(s) and voltage, and whether US/EU/UK devices need an adapter or converter.
- emergency: the emergency phone number(s) (police/ambulance), and any useful tourist-police or embassy note.
- transit: how people get around (metro/taxi apps/rail), the transit card or app worth getting, and one practical tip.
- weather: typical weather for these specific dates (season, temperature range in both °F and °C, rain likelihood) and what to pack for it.
- phrases: 4-6 essential phrases with simple pronunciation if the language is not English; if English-speaking, say so and note any useful local terms.

Rules:
- Be concrete and current-best-knowledge, but conservative: for entry/visa/health facts, prefer well-established rules over guesses.
- Never invent specific fees, processing times, or rule changes you are not sure about — say "check the official source" instead.
- Keep the whole thing tight: this is a cheat sheet, not an article.`;

const SCHEMA = {
  type: 'object',
  properties: {
    guides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          destination: { type: 'string' },
          entry: { type: 'string' },
          health: { type: 'string' },
          money: { type: 'string' },
          power: { type: 'string' },
          emergency: { type: 'string' },
          transit: { type: 'string' },
          weather: { type: 'string' },
          phrases: { type: 'string' },
        },
        required: ['destination', 'entry', 'health', 'money', 'power', 'emergency', 'transit', 'weather', 'phrases'],
        additionalProperties: false,
      },
    },
  },
  required: ['guides'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, error: 'Destination guide is not configured.' });

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
        return json({ ok: false, error: "You have reached this month's Destination guide limit. It resets on the 1st." });
      }
      if (status === 'global_limit') {
        return json({ ok: false, error: 'Destination guide is taking a breather right now — please try again later.' });
      }
    } catch {
      // Fail open: a metering hiccup should not block the feature.
    }
  }

  let places: string[] = [];
  let startDate = '';
  let endDate = '';
  let passportCountry = '';
  try {
    const body = await req.json();
    places = Array.isArray(body.places) ? body.places.map((p: unknown) => String(p)).slice(0, 40) : [];
    startDate = String(body.startDate || '').slice(0, 10);
    endDate = String(body.endDate || '').slice(0, 10);
    passportCountry = String(body.passportCountry || '').slice(0, 60);
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!places.length) return json({ ok: false, error: 'No destinations to write a guide for.' });

  const lines = [
    'Destinations: ' + places.join(', '),
    'Travel dates: ' + (startDate && endDate ? startDate + ' to ' + endDate : 'not set'),
  ];
  if (passportCountry) lines.push('Traveler passport country: ' + passportCountry);
  const prompt = 'Write the cheat sheet for this trip:\n\n' + lines.join('\n');

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
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach the destination-guide service.' });
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

  let parsed: { guides?: unknown };
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

  const guides = Array.isArray(parsed.guides) ? parsed.guides : [];
  return json({ ok: true, guides });
});
