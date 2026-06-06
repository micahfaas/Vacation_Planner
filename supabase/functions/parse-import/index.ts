// Supabase Edge Function: parse-import
//
// Uses Claude to turn messy travel text (pasted confirmation emails, extracted
// PDF text, OCR'd screenshots) into structured trip-card candidates. The
// browser calls this via supabase.functions.invoke() with { text }; the
// function answers HTTP 200 with { ok: true, cards } or { ok: false, error }.
// ANTHROPIC_API_KEY is a server-side secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// AI usage quotas (cost guardrails). parse-import runs Haiku (<1c/call); the
// limits mainly guard against runaway abuse. Enforced before the Anthropic
// call; only successful calls counted. Tunable here with a redeploy. See
// supabase/usage.sql + project_ai_cost_guardrails.
const FEATURE = 'parse-import';
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

const SYSTEM = `You extract travel bookings from messy text — confirmation emails, itineraries, e-tickets, OCR'd screenshots — and return them as structured trip cards.

Return a JSON object: { "cards": [ ... ] }. Each card has ALL of these fields; use "" / 0 / false when a field does not apply:

- type: one of "flight", "hotel", "activity", "transit", "meal", "note"
- title: a short human label, e.g. "Flight to Lima", "Hotel Boutique B&B", "Dinner at Central"
- date: the day the item happens or starts, as "YYYY-MM-DD" (the check-in day for a hotel, the departure day for a flight). "" if genuinely unknown.
- time: start time as 24-hour "HH:MM", for activities and meals. "" otherwise.
- city: the city, for hotels / activities / meals / notes. "" otherwise.
- nights: number of nights as an integer, for hotels. 0 otherwise.
- originCity / destCity: origin and destination city names, for flights and transit. "" otherwise.
- flightNo: a flight number like "AA123" (or a carrier/route reference for transit). "" otherwise.
- depart / arrive: departure and arrival as local wall-clock "YYYY-MM-DDTHH:MM", for flights and transit. "" if unknown.
- notes: confirmation numbers, addresses, seat numbers, terminals, links, and anything else useful. Keep it concise.
- booked: true if the text shows this is a confirmed or paid booking, false if it reads as tentative or a rough plan.

Rules:
- Classify by what the item is: air travel is "flight"; hotels/hostels/lodging are "hotel"; trains/buses/ferries/transfers are "transit"; restaurant reservations are "meal"; tours/tickets/sightseeing are "activity"; anything else is "note".
- Normalize every date to ISO format. The user's message begins with today's date — use it to resolve a missing year (choose the nearest sensible upcoming date) and any relative dates.
- A multi-night hotel stay is ONE card with "nights" set — never one card per night.
- A round-trip or multi-leg flight is one card PER leg.
- Copy confirmation numbers into "notes" verbatim — never invent one.
- If the text contains no travel booking at all, return { "cards": [] }.`;

const SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['flight', 'hotel', 'activity', 'transit', 'meal', 'note'] },
          title: { type: 'string' },
          date: { type: 'string' },
          time: { type: 'string' },
          city: { type: 'string' },
          nights: { type: 'integer' },
          originCity: { type: 'string' },
          destCity: { type: 'string' },
          flightNo: { type: 'string' },
          depart: { type: 'string' },
          arrive: { type: 'string' },
          notes: { type: 'string' },
          booked: { type: 'boolean' },
        },
        required: [
          'type', 'title', 'date', 'time', 'city', 'nights',
          'originCity', 'destCity', 'flightNo', 'depart', 'arrive', 'notes', 'booked',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
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
  text = text.slice(0, 20000); // cap input to bound tokens and cost

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
        max_tokens: 16000,
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

  let parsed: { cards?: unknown };
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

  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  return json({ ok: true, cards });
});
