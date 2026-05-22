// Supabase Edge Function: trip-journal
//
// Generates a day-by-day narrative journal of a completed trip using Claude.
// Input: { trip } with cards, schedule, dates, locations. Output: markdown
// the client renders as styled HTML. ANTHROPIC_API_KEY is a server-side secret.
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

const SYSTEM = `You write personal travel journals from the trip data a user has logged. The voice is warm, reflective, first-person, and specific — the way someone would write up a trip for themselves and a few close friends after returning home. Not corporate. Not a guidebook. Not a list of facts.

Return your output as plain markdown. Use this structure:

# {Trip name or "Trip to [primary destination]"}
A short opening paragraph (2–4 sentences) that sets the trip in context — who, where, when, the shape of the journey. Reference real dates as month + day ("March 14"), not ISO.

## {Date — "Day 1: March 14"}
One to three paragraphs covering what happened that day. Lean on the actual cards (flights, hotels, restaurants, activities, transit). Mention names of places, restaurants, and venues from the data — make it concrete. Note any noteworthy moments the data implies: a long-haul arrival followed by a casual first dinner, jet lag after eastbound flights, a quiet rest day, a packed sightseeing run.

## {Date — "Day 2: March 15"}
...continue for each day in the trip range...

## Looking back
A short closing paragraph that reflects on the trip as a whole — favorite stretches, what worked, what would be done differently. Reference specific moments by name. Avoid generic platitudes.

Rules:
- Use ONLY information present in the trip data. Don't invent restaurants, neighborhoods, weather, or events the user didn't log. If a day has no cards, write a one-sentence "Slow day — no plans on the books" entry rather than fabricating activity.
- Treat the "notes" field of any card as personal context the user wrote — quote or paraphrase it when relevant.
- For flights and transit, mention origin → destination by city, not flight number, unless the flight number is unusually relevant.
- For hotels, mention check-in and check-out days; don't repeat the hotel every day of the stay.
- For activities and meals, use the place names from the title or city field directly.
- Keep each day's entry to ~80–150 words. Don't pad.
- No emoji. No exclamation marks except in direct quotes from the user's notes.
- If "weather" data is included for a card, you may weave it in lightly (e.g., "a wet morning in Lisbon"). Don't list temperatures.
- If pointsCost / pointsProgram fields are present, you may mention an award redemption casually ("flew over on Aeroplan points") but don't lecture about points strategy.
- The trip data includes an ISO startDate and endDate. Generate one ## section per day in the range, in order. If a day has no cards, still include the heading with a short "slow day" line.
- End with the "## Looking back" reflection, drawn from the cards as a whole. Around 80–120 words.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, error: 'Trip journal is not configured.' });

  let trip: unknown;
  try {
    const body = await req.json();
    trip = body.trip;
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  if (!trip || typeof trip !== 'object') return json({ ok: false, error: 'No trip to write up.' });

  const tripJson = JSON.stringify(trip).slice(0, 40000);

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
        messages: [{ role: 'user', content: 'Write the journal for this trip:\n\n' + tripJson }],
      }),
    });
  } catch {
    return json({ ok: false, error: 'Could not reach the trip-journal service.' });
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
  if (!block || !block.text) return json({ ok: false, error: 'The AI returned no journal.' });

  return json({ ok: true, markdown: block.text });
});
