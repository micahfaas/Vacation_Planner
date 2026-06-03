// Supabase Edge Function: trip-ideas
//
// Pre-trip ideation. The browser sends the traveler's available points/miles
// (already expanded by the client into which airline programs each balance can
// reach), trip length, preferred timing, home airport, and profile, plus a
// free-text note. The function answers HTTP 200 with
// { ok: true, reply, ideas } or { ok: false, error }. ANTHROPIC_API_KEY is a
// server-side secret. Modeled on the co-planner function.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// AI usage quotas (cost guardrails). Trip ideas runs Haiku (<1c/call), so it
// is cheap; limits mainly guard against runaway abuse. Enforced before the
// Anthropic call; only successful calls counted. Tunable here with a redeploy.
// See supabase/usage.sql + project_ai_cost_guardrails.
const FEATURE = 'trip-ideas';
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

// Turn a free-text origin into an authoritative "Home airport:" line so the
// model never has to guess an obscure IATA code (e.g. RDM is Redmond/Bend OR,
// not Raleigh-Durham). A bare 3-letter code is resolved against AeroDataBox;
// anything else (a city) is passed through, since the model handles those well.
async function homeAirportLine(origin: string): Promise<string> {
  const raw = (origin || '').trim();
  if (!raw) return 'Home airport: not specified';

  if (!/^[A-Za-z]{3}$/.test(raw)) return 'Home airport: ' + raw;

  const code = raw.toUpperCase();
  const key = Deno.env.get('AERODATABOX_KEY');
  if (!key) {
    return 'Home airport: ' + code +
      ' (interpret as an IATA airport code; if unsure which airport, say so rather than guessing)';
  }
  const HOST = 'aerodatabox.p.rapidapi.com';
  try {
    const res = await fetch(`https://${HOST}/airports/iata/${code}`, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
    });
    if (res.ok) {
      const a = await res.json() as {
        fullName?: string; shortName?: string; name?: string;
        municipalityName?: string; countryCode?: string; country?: { name?: string };
      };
      const name = a.fullName || a.shortName || a.name || '';
      const city = a.municipalityName || '';
      const country = (a.country && a.country.name) || a.countryCode || '';
      const parts = [name, city, country].filter(Boolean);
      if (parts.length) return 'Home airport: ' + parts.join(', ') + ' (IATA ' + code + ')';
    }
  } catch { /* fall through to the hedged code line */ }
  return 'Home airport: ' + code +
    ' (interpret as an IATA airport code; if unsure which airport, say so rather than guessing)';
}

const SYSTEM = `You are a points-savvy travel ideation assistant. The traveler has not picked a destination yet. You are given: their available points/miles (already expanded into which airline programs each balance can transfer to), how many days they have, when they want to travel, their home airport, optional preferences, and maybe a traveler profile. Suggest a handful of realistic destination ideas they could actually reach with those miles from their home airport, in that timing.

Always fill "reply": one or two warm, plain-text sentences framing the ideas. No markdown.

Fill "ideas" with 4 to 6 distinct destinations. For each idea:
- destination: the place, as "City, Country" (or a region like "Amalfi Coast, Italy"). Be specific.
- bestFor: why this destination fits the stated timing — real seasonal reasoning (weather, crowds, a notable event/festival) for that month. One or two sentences.
- redemption: a HEDGED, clearly-approximate award sketch grounded in the programs they actually hold. Name the program(s) and a rough range, and always hedge. Example: "Business class is typically around 60–90k each way via ANA or Aeroplan — your ~200k Amex would likely cover a round trip if award space opens." NEVER state an exact award price as fact. Always use words like "typically", "around", "roughly", "if space opens". If their balances clearly fall short, say so honestly.
- pitch: one or two sentences on why THEY would love it, tuned to their profile (pace, interests, who they travel with, dietary needs) when a profile is given.
- nights: a suggested number of nights as an integer, no greater than the days they have.

Rules:
- Only suggest destinations plausibly reachable on their specific programs/alliances from their home airport. Favor places their miles serve well.
- Respect the traveler profile absolutely when present (dietary needs, pace, walking tolerance, interests, who they travel with). Do not mention the profile back to them; just let it shape the picks.
- Vary the ideas — mix regions and vibes rather than five near-identical cities.
- Be honest about feasibility. Approximate is fine; fabricated precision is not.`;

const IDEA = {
  type: 'object',
  properties: {
    destination: { type: 'string' },
    bestFor: { type: 'string' },
    redemption: { type: 'string' },
    pitch: { type: 'string' },
    nights: { type: 'integer' },
  },
  required: ['destination', 'bestFor', 'redemption', 'pitch', 'nights'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    ideas: { type: 'array', items: IDEA },
  },
  required: ['reply', 'ideas'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, error: 'Trip ideas are not configured.' });

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
        return json({ ok: false, error: "You have reached this month's Trip ideas limit. It resets on the 1st." });
      }
      if (status === 'global_limit') {
        return json({ ok: false, error: 'Trip ideas is taking a breather right now — please try again later.' });
      }
    } catch {
      // Fail open: a metering hiccup should not block the feature.
    }
  }

  let context = '', origin = '';
  try {
    const body = await req.json();
    context = String(body.context || '').slice(0, 12000);
    origin = String(body.origin || '').slice(0, 120);
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!context.trim()) return json({ ok: false, error: 'No trip details were provided.' });

  const message = context + '\n' + await homeAirportLine(origin);

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
        max_tokens: 20000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: message }],
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

  let parsed: { reply?: unknown; ideas?: unknown };
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

  return json({
    ok: true,
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
  });
});
