-- =============================================================================
-- FAST SOCIO — Make chat-media private (audit fix P5-01, P0)
--
-- chat-media was a PUBLIC bucket with a SELECT policy open to the `public` role,
-- so anyone with the anon key could LIST every conversation folder and DOWNLOAD
-- every DM image and voice note (verified: fetched a real voice note with only
-- the anon key, no auth). Fix: make the bucket private and restrict object
-- SELECT to participants of the conversation named in the object path
-- (chat-media/<conversation_id>/<file>). Reads now go through short-lived signed
-- URLs generated for participants; the public CDN path no longer serves these
-- objects. avatars and post-media stay public (inherently public content).
--
-- Upload/delete policies are unchanged (already participant/owner scoped).
-- Existing objects keep their path, so both legacy rows (which stored a full
-- public URL) and new rows (which store just the path) resolve via the app's
-- read-time signing helper.
-- =============================================================================

update storage.buckets set public = false where id = 'chat-media';

-- Replace the public-readable policy with participant-only SELECT.
drop policy if exists "chat media is publicly readable" on storage.objects;

create policy "participants read chat media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.user_low = auth.uid() or c.user_high = auth.uid())
    )
  );
