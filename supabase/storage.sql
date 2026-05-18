-- Vacation Planner — Supabase Storage setup for card file attachments.
-- Run this once in the SQL Editor (after schema.sql).
--
-- Files are stored privately under a per-user folder (<user-id>/...), and a
-- single policy lets each user read/write/delete only their own files.

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "Users manage own attachments" on storage.objects;

create policy "Users manage own attachments"
  on storage.objects for all
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
