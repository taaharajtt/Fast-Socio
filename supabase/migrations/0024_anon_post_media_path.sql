-- =============================================================================
-- FAST SOCIO — De-identify post image paths (audit fix P3-01)
--
-- feed_posts nulls the author for anonymous posts but returns image_url as-is,
-- and images were uploaded to post-media/<author_id>/<uuid>. So an anonymous
-- post's image URL leaked the author's profile id (verified: an existing anon
-- post's URL contained its author_id). Fix: post images now upload under a
-- shared, non-identifying prefix post-media/shared/<uuid>. The author of a
-- non-anonymous post is still known via author_id, so a shared path is safe for
-- ALL post images and avoids the "anonymous toggled after upload" race.
--
-- This widens the post-media INSERT policy to also accept the 'shared' prefix;
-- the legacy per-user folder stays allowed for backward compatibility. No
-- UPDATE policy exists, so shared objects (random uuids) cannot be overwritten.
-- =============================================================================

drop policy if exists "users upload their own post media" on storage.objects;
create policy "users upload their own post media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[1] = 'shared'
    )
  );
