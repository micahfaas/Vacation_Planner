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

-- Trip journal photos. Same per-user-folder model as attachments, with paths
-- shaped <user-id>/<trip-id>/<photo-id>.jpg. Images are downscaled and
-- re-encoded to JPEG client-side before upload, so the 5 MB limit is a
-- guardrail against accidental full-resolution uploads, not the normal case
-- (typical compressed photo is ~300-500 KB). Private bucket — the app reads
-- via short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-photos', 'trip-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Users manage own trip photos" on storage.objects;

create policy "Users manage own trip photos"
  on storage.objects for all
  using (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);
