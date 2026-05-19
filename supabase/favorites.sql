-- Vacation Planner — Supabase schema for cross-trip favorite places.
-- Run this once in the SQL Editor (after schema.sql).
--
-- One row per user holding a JSONB { places: [...] } pool of starred places
-- usable as templates when planning any trip.

create table if not exists public.favorites (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.favorites enable row level security;

drop policy if exists "Users read own favorites"   on public.favorites;
drop policy if exists "Users insert own favorites" on public.favorites;
drop policy if exists "Users update own favorites" on public.favorites;
drop policy if exists "Users delete own favorites" on public.favorites;

create policy "Users read own favorites"
  on public.favorites for select
  using (auth.uid() = user_id);

create policy "Users insert own favorites"
  on public.favorites for insert
  with check (auth.uid() = user_id);

create policy "Users update own favorites"
  on public.favorites for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own favorites"
  on public.favorites for delete
  using (auth.uid() = user_id);
