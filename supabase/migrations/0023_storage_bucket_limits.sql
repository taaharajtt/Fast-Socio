-- =============================================================================
-- FAST SOCIO — Storage bucket hardening (audit fix P2-02)
--
-- All three public buckets were created with NO size limit and NO MIME allow-
-- list, so a client could upload arbitrary file types (incl. active content
-- like SVG/HTML) and unbounded sizes (storage/cost abuse). Supabase enforces
-- file_size_limit and allowed_mime_types server-side on upload, independent of
-- the client-declared content-type. Existing objects are unaffected.
--
-- Buckets stay public (avatars/post images/chat media are rendered by URL). The
-- separate concern of chat-media being a *public* bucket for private DM content
-- is tracked for the Phase 5 privacy review, not here.
-- =============================================================================

-- Avatars: raster images only, 5 MB.
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
 where id = 'avatars';

-- Post media: raster images only, 10 MB.
update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
 where id = 'post-media';

-- Chat media: images + voice-note audio, 15 MB.
update storage.buckets
   set file_size_limit = 15 * 1024 * 1024,
       allowed_mime_types = array[
         'image/jpeg','image/png','image/webp','image/gif',
         'audio/webm','audio/mp4','audio/mpeg','audio/ogg'
       ]
 where id = 'chat-media';
