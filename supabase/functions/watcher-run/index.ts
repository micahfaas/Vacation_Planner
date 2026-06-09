// Supabase Edge Function: watcher-run
//
// Invoked on a schedule by pg_cron (see supabase/watcher-cron.sql). Finds
// booking reminders (#12) that are due and not yet sent, pushes a notification
// to each of the owner's devices, then marks them sent. Stale subscriptions
// are pruned.
//
// Dispatch is polymorphic on `push_subscriptions.platform`:
//   - 'web'  -> web-push (VAPID) using endpoint/p256dh/auth
//   - 'ios'/'android' -> Expo Push API using expo_push_token
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
  const vapidConfigured = Boolean(subject && publicKey && privateKey);
  const vapidDetails = vapidConfigured ? { subject, publicKey, privateKey } : null;

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

    const payload = {
      title: w.title || 'Booking reminder',
      body: w.note || 'A booking window is opening — tap to open.',
      url: w.url || './',
      tag: 'watcher-' + w.id,
      // Watcher type ('reservation' | 'benefit') so clients can deep-link to
      // the right screen. Older clients ignore the extra field.
      kind: w.type || 'reservation',
    };
    const payloadJson = JSON.stringify(payload);

    for (const s of (subs || [])) {
      const platform = s.platform || 'web';
      try {
        if (platform === 'web') {
          if (!vapidDetails || !s.endpoint) continue;
          const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
          const details = webpush.generateRequestDetails(subscription, payloadJson, { vapidDetails, TTL: 60 * 60 * 24 });
          const res = await fetch(details.endpoint, {
            method: details.method,
            headers: details.headers,
            body: details.body,
          });
          if (res.status === 404 || res.status === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', s.id);
          } else if (res.ok) {
            sent++;
          }
        } else if (platform === 'ios' || platform === 'android') {
          if (!s.expo_push_token) continue;
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip, deflate',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: s.expo_push_token,
              title: payload.title,
              body: payload.body,
              sound: 'default',
              data: { url: payload.url, tag: payload.tag, kind: payload.kind },
            }),
          });
          const result = await res.json().catch(() => null) as
            | { data?: { status: string; details?: { error?: string } } }
            | null;
          const ticket = result?.data;
          if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            await supabase.from('push_subscriptions').delete().eq('id', s.id);
          } else if (res.ok && ticket?.status === 'ok') {
            sent++;
          }
        }
      } catch (_e) { /* skip this device, continue */ }
    }

    await supabase.from('watchers')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', w.id);
  }

  return json({ ok: true, processed: due.length, sent });
});
