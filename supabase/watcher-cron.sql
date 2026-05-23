-- Trip Planner — schedule watcher-run (#12 booking reminders)
-- Run once in the Supabase dashboard SQL Editor, AFTER supabase/watchers.sql.
--
-- This wires pg_cron to POST the watcher-run Edge Function every 5 minutes;
-- the function finds due reminders and sends the web-push notifications.
--
-- IMPORTANT: replace <<WATCHER_CRON_SECRET>> below with the secret value you
-- set via `supabase secrets set WATCHER_CRON_SECRET=...`. It must match exactly,
-- or the function will reject the call with 401. Keep the real value out of the
-- repo — paste it only into the SQL editor.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of the job before (re)creating it.
select cron.unschedule('watcher-run')
where exists (select 1 from cron.job where jobname = 'watcher-run');

select cron.schedule(
  'watcher-run',
  '*/5 * * * *',            -- every 5 minutes; use '* * * * *' for minute precision
  $$
  select net.http_post(
    url     := 'https://erpvmsgznmyssnguhpvr.supabase.co/functions/v1/watcher-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<<WATCHER_CRON_SECRET>>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Handy checks:
--   select * from cron.job;                                  -- see the schedule
--   select * from cron.job_run_details order by start_time desc limit 10;  -- runs
--   select cron.unschedule('watcher-run');                   -- stop it
