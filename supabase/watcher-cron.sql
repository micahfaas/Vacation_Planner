-- Trip Planner — schedule watcher-run (#12 booking reminders)
-- Run once in the Supabase dashboard SQL Editor, AFTER supabase/watchers.sql.
--
-- This wires pg_cron to POST the watcher-run Edge Function every 5 minutes;
-- the function finds due reminders and sends notifications (web + mobile).
--
-- TWO things must be in the headers for the call to succeed:
--   1. Authorization: Bearer <project anon key>
--      Supabase edge gateway rejects calls with 401
--      UNAUTHORIZED_NO_AUTH_HEADER before the function code runs if missing.
--      The anon key is the public client key from Project Settings -> API ->
--      anon public. It IS safe in this SQL (it is also shipped in every web
--      and mobile client).
--   2. x-cron-secret: <WATCHER_CRON_SECRET>
--      The function's own auth check (watcher-run/index.ts). Must match the
--      value set via `supabase secrets set WATCHER_CRON_SECRET=...`. Keep this
--      out of git -- paste it only into the SQL editor.

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
      'Authorization', 'Bearer <<SUPABASE_ANON_KEY>>',
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
