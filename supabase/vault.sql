-- Vacation Planner — Supabase schema for the Travel Documents & Loyalty Vault.
-- Run this once in the SQL Editor (after schema.sql).
--
-- The most sensitive data in the app, so it lives in its OWN table (not the
-- profiles row). One row per user holding a JSONB:
--   { loyalty: [{id,program,number,label}],
--     travelerIds: { ktn, redress, clear },
--     documents: [{id,name,path,size,type}] }   (files live in the private
--                                                 `attachments` storage bucket)
--
-- ISOLATION (by design): this table is never read by the AI edge functions or
-- the share-trip snapshot. STORE-LESS: deliberately no passport number / SSN /
-- full card numbers — loyalty numbers + user-attached files are the core.

create table if not exists public.vault (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.vault enable row level security;

drop policy if exists "Users read own vault"   on public.vault;
drop policy if exists "Users insert own vault" on public.vault;
drop policy if exists "Users update own vault" on public.vault;
drop policy if exists "Users delete own vault" on public.vault;

create policy "Users read own vault"
  on public.vault for select
  using (auth.uid() = user_id);

create policy "Users insert own vault"
  on public.vault for insert
  with check (auth.uid() = user_id);

create policy "Users update own vault"
  on public.vault for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own vault"
  on public.vault for delete
  using (auth.uid() = user_id);
