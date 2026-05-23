// Supabase Edge Function: og-image
//
// Best-effort website preview image. The browser cannot fetch arbitrary sites
// (CORS), so it asks this function: given a page URL, fetch it and return its
// Open Graph / Twitter card image as an absolute URL. Used by the card read
// view to show a photo for saved places. Returns { ok, image } — image is ''
// when none is found. No API key needed.
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

// Block obviously-internal targets to limit SSRF. Not exhaustive, but this is a
// personal app and the input is a user's own saved link.
function isPublicHttpUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local')) return null;
  if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return null;
  if (h === '[::1]' || h.startsWith('[fc') || h.startsWith('[fd')) return null;
  return u;
}

function findMeta(html: string, key: string): string {
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  const keyRe = new RegExp('(?:property|name)\\s*=\\s*["\']' + key + '["\']', 'i');
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    if (keyRe.test(tag)) {
      const cm = tag.match(/content\s*=\s*["']([^"']+)["']/i);
      if (cm) return cm[1].trim();
    }
  }
  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' });

  let target = '';
  try {
    const body = await req.json();
    target = String(body.url || '').slice(0, 2000);
  } catch {
    return json({ ok: false, error: 'Bad request.' });
  }
  const url = isPublicHttpUrl(target);
  if (!url) return json({ ok: true, image: '' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TripPlannerBot/1.0)', 'Accept': 'text/html' },
    });
  } catch {
    clearTimeout(timer);
    return json({ ok: true, image: '' });
  }
  clearTimeout(timer);

  const ct = res.headers.get('content-type') || '';
  if (!res.ok || !ct.includes('text/html')) return json({ ok: true, image: '' });

  // Read only the <head>-ish portion; meta tags live up top.
  const html = (await res.text()).slice(0, 200000);
  const raw = findMeta(html, 'og:image') ||
              findMeta(html, 'og:image:url') ||
              findMeta(html, 'twitter:image') ||
              findMeta(html, 'twitter:image:src');
  if (!raw) return json({ ok: true, image: '' });

  let abs = '';
  try { abs = new URL(raw, res.url || url.toString()).toString(); } catch { abs = ''; }
  if (!/^https?:\/\//i.test(abs)) return json({ ok: true, image: '' });

  return json({ ok: true, image: abs });
});
