-- =============================================================================
-- FAST SOCIO — Community cover photo (UAT-019, UAT-020)
--
-- Communities gain a 16:9 cover image shown as the banner hero on the community
-- screen and on browse cards. Covers are uploaded to the existing public
-- `post-media` bucket (author-scoped path), so no new bucket/policy is needed.
-- =============================================================================

alter table public.communities
  add column if not exists cover_url text;
