-- Trip Planner — booking reminders (#12) + web-push subscriptions
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- watchers:           reservation-window reminders. The watcher-run Edge
--                     Function (service role) scans these for ones due now and
--                     pushes a notification, then marks them sent.
-- push_subscriptions: one row per browser/device the user enabled push on.
--
-- RLS lets each user CRUD only their own rows; the service-role key used by the
-- watcher-run function bypasses RLS so it can read across users when firing.

create table if not exists public.watchers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       text not null default 'reservation',
  title      text not null,
  note       text not null default '',
  url        text not null default '',
  trip_id    text not null default '',
  fire_at    timestamptz not null,
  status     text not null default 'pending',   -- pending | sent | dismissed
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);

create index if not exists watchers_user_id_idx on public.watchers (user_id);
-- The cron scan filters on (status, fire_at); a partial index keeps it cheap.
create index if not exists watchers_due_idx
  on public.watchers (fire_at) where status = 'pending';

alter table public.watchers enable row level security;

drop policy if exists "Users read own watchers"   on public.watchers;
drop policy if exists "Users insert own watchers" on public.watchers;
drop policy if exists "Users update own watchers" on public.watchers;
drop policy if exists "Users delete own watchers" on public.watchers;

create policy "Users read own watchers"
  on public.watchers for select using (auth.uid() = user_id);
create policy "Users insert own watchers"
  on public.watchers for insert with check (auth.uid() = user_id);
create policy "Users update own watchers"
  on public.watchers for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own watchers"
  on public.watchers for delete using (auth.uid() = user_id);


create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users read own subs"   on public.push_subscriptions;
drop policy if exists "Users insert own subs" on public.push_subscriptions;
drop policy if exists "Users delete own subs" on public.push_subscriptions;

create policy "Users read own subs"
  on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "Users insert own subs"
  on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "Users delete own subs"
  on public.push_subscriptions for delete using (auth.uid() = user_id);
