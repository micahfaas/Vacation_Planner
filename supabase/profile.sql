-- Vacation Planner — Supabase schema for the traveler profile.
-- Run this once in the SQL Editor (after schema.sql).
--
-- One row per user holding a JSONB of travel preferences. The co-planner
-- Edge Function reads it as additional context so suggestions are tailored
-- to the user — pace, lodging style, mobility, dietary needs, interests.

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users read own profile"   on public.profiles;
drop policy if exists "Users insert own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
drop policy if exists "Users delete own profile" on public.profiles;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own profile"
  on public.profiles for delete
  using (auth.uid() = user_id);
