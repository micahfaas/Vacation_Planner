// Supabase Edge Function: trip-check
//
// Reviews a compact trip summary with Claude and returns potential issues —
// short layovers, scheduling conflicts, closures, visa risk, logistics gaps,
// ambitious day-1 plans after long-haul, etc. The browser calls this via
// supabase.functions.invoke() with { trip }; the function answers HTTP 200
// with { ok: true, issues } or { ok: false, error }. ANTHROPIC_API_KEY is a
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

const SYSTEM = `You review a traveler's planned trip and surface issues that would hurt the experience or cause real problems on the ground.

Return a JSON object: { "issues": [ ... ] }. Each issue has ALL of these fields:

- severity: "critical" (likely to break the trip — missed flight, denied boarding, visa refusal), "warning" (will hurt the experience — short layover, ambitious schedule, closed venue), or "info" (worth knowing — local tip, etiquette, weather risk).
- category: one of "timing" (layover, overlap, schedule conflict), "logistics" (transport gap, city mismatch, baggage), "closure" (venue closed on this day, holiday), "visa" (entry/transit requirements, passport rules), "weather" (forecast risk for outdoor plans), "jetlag" (day-1 plans after long-haul), "etiquette" (local norms worth noting), or "other".
- cardId: the id of the specific card this issue concerns, or "" if it spans multiple cards.
- dayDate: the YYYY-MM-DD this concerns, or "" if not day-specific.
- message: one short sentence describing the issue, in plain language.
- suggestion: one short sentence with a concrete fix or workaround. Empty string only if no useful suggestion exists.

What to check, in order of importance:
1. Layovers: <60min international or <30min domestic is risky; <45min international with terminal change is risky. Flag with the connection airport.
2. Schedule overlaps: two cards at the same time, or a meal/activity that ends after the next item starts (accounting for realistic travel time within a city).
3. Hotel/city mismatches: an activity in city X on a day the user is staying in city Y, with no transit card bridging them.
4. Hotel checkout vs late departure: if checkout is ~11am but departing flight is 9pm+, suggest day storage or a late checkout.
5. Day-of-arrival ambition: a major activity scheduled within ~4h of a long-haul arrival is risky. Mention jet lag direction (east is harder).
6. Closures: museums, attractions, restaurants that you know are typically closed on certain weekdays or that observe national holidays in the destination during the trip window.
7. Visa/passport: well-known visa requirements (e.g., ESTA for US visitors entering on visa-waiver, Schengen 90/180 rule, Brazil eVisa for some nationals, China visa, India eVisa). Mention the 6-month passport validity rule for destinations that enforce it. Do not guess the traveler's nationality — phrase as "if traveling on a US passport, you'll need X; on a UK passport, Y" only when clearly relevant.
8. Weather risk: outdoor-dependent activities during typical monsoon/hurricane/winter-storm seasons for that region.
9. Logistics: arriving by train at one station but the hotel is across town with no transit card, airport-to-hotel transport on an early-morning arrival when public transit hasn't started, etc.
10. Etiquette / payment: cash-only economies, tipping norms, dress codes for specific venues, transit-card recommendations (Suica, Oyster, Navi).

Be specific and concrete. "Your flight has a short layover" is useless; "The 35min connection at FRA on flight LH401 is below Lufthansa's minimum connection time" is useful.

Only return issues you're confident about. It is better to return fewer high-quality issues than many speculative ones. If the trip looks clean, return { "issues": [] }.

Never invent flight numbers, hotel names, or dates that the user didn't provide. Reference only what's in the trip data.`;

const SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          category: { type: 'string', enum: ['timing', 'logistics', 'closure', 'visa', 'weather', 'jetlag', 'etiquette', 'other'] },
          cardId: { type: 'string' },
          dayDate: { type: 'string' },
          message: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'category', 'cardId', 'dayDate', 'message', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, error: 'Trip check is not configured.' });

  let trip: unknown;
  try {
    const body = await req.json();
    trip = body.trip;
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!trip || typeof trip !== 'object') return json({ ok: false, error: 'No trip to check.' });

  const tripJson = JSON.stringify(trip).slice(0, 30000); // cap input

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
        messages: [{ role: 'user', content: 'Review this trip and list any issues:\n\n' + tripJson }],
      }),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach the trip-check service.' });
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

  let parsed: { issues?: unknown };
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return json({ ok: false, error: 'The AI returned malformed output.' });
  }

  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  return json({ ok: true, issues });
});
