-- Vacation Planner — Supabase Storage setup for read-only trip sharing.
-- Run this once in the SQL Editor (after schema.sql and storage.sql).
--
-- Shared trips are uploaded as JSON snapshots to a PUBLIC bucket, so anyone
-- with the share link can read them without signing in. Only signed-in users
-- can publish (insert/update) snapshots.

insert into storage.buckets (id, name, public)
values ('shared', 'shared', true)
on conflict (id) do update set public = true;

drop policy if exists "Signed-in users manage shared snapshots" on storage.objects;

create policy "Signed-in users manage shared snapshots"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'shared')
  with check (bucket_id = 'shared');
