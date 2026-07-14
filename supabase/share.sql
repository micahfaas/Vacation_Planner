-- Vacation Planner — Supabase Storage setup for read-only trip sharing.
-- Run this once in the SQL Editor (after schema.sql and storage.sql).
--
-- Shared trips are uploaded as JSON snapshots to a PUBLIC bucket, so anyone
-- with the share link can read them without signing in (public reads bypass RLS).
--
-- Snapshots are stored under a per-user folder (<user-id>/<token>.json), and the
-- policy below scopes every AUTHENTICATED operation to the owner's own folder.
-- That means a signed-in user can only publish/update/delete/list THEIR OWN
-- shares -- they cannot enumerate, read the object list of, overwrite, or delete
-- anyone else's. (Public link reads still work via the public bucket URL.)
-- Same per-user-folder model as the private 'attachments' bucket.

insert into storage.buckets (id, name, public)
values ('shared', 'shared', true)
on conflict (id) do update set public = true;

drop policy if exists "Signed-in users manage shared snapshots" on storage.objects;

create policy "Users manage own shared snapshots"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'shared' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'shared' and (storage.foldername(name))[1] = auth.uid()::text);
