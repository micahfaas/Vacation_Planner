-- Vacation Planner — Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Each trip is stored as a single JSONB document owned by one user.
-- Row-Level Security ensures a user can only ever see or change their own trips.

create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists trips_user_id_idx on public.trips (user_id);

alter table public.trips enable row level security;

drop policy if exists "Users read own trips"   on public.trips;
drop policy if exists "Users insert own trips" on public.trips;
drop policy if exists "Users update own trips" on public.trips;
drop policy if exists "Users delete own trips" on public.trips;

create policy "Users read own trips"
  on public.trips for select
  using (auth.uid() = user_id);

create policy "Users insert own trips"
  on public.trips for insert
  with check (auth.uid() = user_id);

create policy "Users update own trips"
  on public.trips for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own trips"
  on public.trips for delete
  using (auth.uid() = user_id);
