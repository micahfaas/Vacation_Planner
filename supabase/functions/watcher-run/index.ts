// Supabase Edge Function: watcher-run
//
// Invoked on a schedule by pg_cron (see supabase/watcher-cron.sql). Finds
// booking reminders (#12) that are due and not yet sent, pushes a web
// notification to each of the owner's devices, then marks them sent. Stale
// push endpoints (404/410) are pruned.
//
// Auth: callers must send `x-cron-secret: <WATCHER_CRON_SECRET>`. Runs with the
// service-role key (auto-injected) so it can read across users.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  const secret = Deno.env.get('WATCHER_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }

  const subject = Deno.env.get('VAPID_SUBJECT') || '';
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  if (!subject || !publicKey || !privateKey) {
    return json({ ok: false, error: 'VAPID keys are not configured.' }, 500);
  }
  const vapidDetails = { subject, publicKey, privateKey };

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('watchers').select('*')
    .eq('status', 'pending').lte('fire_at', nowIso)
    .limit(100);
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!due || !due.length) return json({ ok: true, processed: 0, sent: 0 });

  let sent = 0;
  for (const w of due) {
    const { data: subs } = await supabase
      .from('push_subscriptions').select('*').eq('user_id', w.user_id);

    const payload = JSON.stringify({
      title: w.title || 'Booking reminder',
      body: w.note || 'A booking window is opening — tap to open.',
      url: w.url || './',
      tag: 'watcher-' + w.id,
    });

    for (const s of (subs || [])) {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        const details = webpush.generateRequestDetails(subscription, payload, { vapidDetails, TTL: 60 * 60 * 24 });
        const res = await fetch(details.endpoint, {
          method: details.method,
          headers: details.headers,
          body: details.body,
        });
        if (res.status === 404 || res.status === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        } else if (res.ok) {
          sent++;
        }
      } catch (_e) { /* skip this device, continue */ }
    }

    await supabase.from('watchers')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', w.id);
  }

  return json({ ok: true, processed: due.length, sent });
});
