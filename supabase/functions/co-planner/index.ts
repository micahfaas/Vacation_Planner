// Supabase Edge Function: co-planner
//
// An AI travel co-planner. The browser sends the active trip's state plus a
// free-text request via supabase.functions.invoke() with { prompt, context };
// the function answers HTTP 200 with { ok: true, reply, suggestions } or
// { ok: false, error }. ANTHROPIC_API_KEY is a server-side secret.
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

const SYSTEM = `You are a thoughtful, knowledgeable travel co-planner helping someone plan one specific trip. You are given the current state of their trip, followed by a request.

Always fill "reply": direct, specific, friendly advice that addresses the request — review the plan, answer the question, or explain what you are suggesting. Reference their actual cities, dates, and items. Be concrete and reasonably concise. Plain text only, no markdown.

Fill "suggestions" with cards WHENEVER the user asks for any specific recommendations — places, restaurants, cafés, bars, activities, hotels, things to do, ideas, etc. — even when they have not asked you to schedule them. The user will choose afterward whether to add each one as a trip card (on a date or to the library) or as a saved place. Only leave "suggestions" empty for purely conversational replies, e.g. a review, a critique, a clarifying question, where no concrete recommendation makes sense.

Each suggestion card has ALL of these fields; use "" / 0 / false when a field does not apply:

- type: one of "flight", "hotel", "activity", "transit", "meal", "note"
- title: the bare name of the place or activity — "Central", "Recoleta Cemetery", "Café Tortoni". Never prefix with a meal or verb like "Lunch at", "Dinner at", "Visit", "Walk through". The card's icon and time field already convey those.
- date: the day it happens or starts, as "YYYY-MM-DD". "" to leave it unplaced.
- time: start time as 24-hour "HH:MM", for activities and meals. "" otherwise.
- city: the city, for hotels / activities / meals / notes. "" otherwise.
- nights: number of nights as an integer, for hotels. 0 otherwise.
- originCity / destCity: origin and destination city names, for flights and transit. "" otherwise.
- flightNo: a flight number or carrier reference. "" otherwise.
- depart / arrive: departure and arrival as local wall-clock "YYYY-MM-DDTHH:MM", for flights and transit. "" otherwise.
- address: the venue's real street address, for activities / meals / hotels — only when you genuinely know it for a well-known place. "" otherwise. Never invent an address; the app geocodes it and builds map + website-search links from the name and address, so accuracy here matters more than completeness.
- notes: a one-line reason or tip for this suggestion.
- booked: always false for suggestions — they are proposals.

Rules:
- Suggest real, specific, well-regarded places and experiences — never generic placeholders like "a local restaurant".
- Set "date" only when the request implies a specific day; otherwise leave it "" so the card goes to the trip's card library for the user to place.
- Keep any dates within the trip's date range.
- Fill "address" only with a real, correct street address for a well-known venue; if you are not confident, leave it "". Never invent an address.
- The user's existing scheduled cards, unscheduled library cards, and saved research places are listed above. Never recommend a specific place that already appears in any of those lists — always provide fresh alternatives. If the user already has many places in a category, dig deeper into less obvious options.
- A "Traveler profile" block may appear at the top of the context — pace, walking tolerance, lodging style, who they travel with, dietary needs, interests, and free-text. Treat it as the user's standing preferences and let it shape every suggestion: respect dietary needs absolutely, match the pace and walking tolerance, lean into their stated interests, and prefer lodging that fits their style. Do not mention the profile back to them; just plan in line with it.`;

const CARD = {
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
    address: { type: 'string' },
    notes: { type: 'string' },
    booked: { type: 'boolean' },
  },
  required: [
    'type', 'title', 'date', 'time', 'city', 'nights',
    'originCity', 'destCity', 'flightNo', 'depart', 'arrive', 'address', 'notes', 'booked',
  ],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggestions: { type: 'array', items: CARD },
  },
  required: ['reply', 'suggestions'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, error: 'The AI co-planner is not configured.' });

  let prompt = '', context = '';
  try {
    const body = await req.json();
    prompt = String(body.prompt || '').slice(0, 4000);
    context = String(body.context || '').slice(0, 12000);
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!prompt.trim()) return json({ ok: false, error: 'Ask the co-planner a question first.' });

  const userMessage = (context ? context + '\n\n' : '') + 'REQUEST:\n' + prompt;

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
        model: 'claude-sonnet-4-6',
        max_tokens: 20000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: userMessage }],
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

  let parsed: { reply?: unknown; suggestions?: unknown };
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return json({ ok: false, error: 'The AI returned malformed output.' });
  }

  return json({
    ok: true,
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  });
});
