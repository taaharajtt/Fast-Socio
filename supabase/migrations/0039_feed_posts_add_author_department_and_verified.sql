-- =============================================================================
-- FAST SOCIO — profiles.verified + feed_posts exposes author dept/verified
--
-- RECOVERED into the repo during the 2026-07-18 migration-drift reconciliation.
-- This migration was applied to production out-of-band (via the Supabase MCP,
-- version 20260709113801) but never had a repo file, so a fresh replay was
-- missing the profiles.verified column that later migrations (0054, 0058, 0060,
-- …) depend on. Placed at 0039 (the only free early slot) so verified exists
-- before it is referenced. SQL is reproduced verbatim from the stored
-- statements in supabase_migrations.schema_migrations.
--
-- NOTE: a sibling out-of-band migration, "discover_candidates_add_verified"
-- (20260709114820), was intentionally NOT recovered as a repo file — it only
-- redefined get_discover_candidates to an interim shape that is fully superseded
-- by 0047/0054/0058/0060/0099/0100. Its sole lasting artifact (the verified
-- column) is created here, so the final replayed schema is identical to prod.
-- =============================================================================

-- Add a verified flag to profiles (UISpec V3 §2.7 verified badge).
alter table public.profiles
  add column if not exists verified boolean not null default false;

-- Recreate the feed_posts view exposing the author's department and verified
-- flag. Both are masked for anonymous posts exactly like the other author
-- fields, so an anonymous post can't be de-anonymised via department/verified.
-- New columns are appended after liked_by_me (CREATE OR REPLACE requires it);
-- the app reads the view with select("*") so column order is irrelevant.
create or replace view public.feed_posts as
 SELECT p.id,
    p.body,
    p.image_url,
    p.is_anonymous,
    p.community_id,
    p.like_count,
    p.comment_count,
    p.created_at,
        CASE
            WHEN p.is_anonymous AND p.author_id <> auth.uid() AND NOT is_admin(auth.uid()) THEN NULL::uuid
            ELSE p.author_id
        END AS author_id,
        CASE
            WHEN p.is_anonymous AND p.author_id <> auth.uid() AND NOT is_admin(auth.uid()) THEN NULL::text
            ELSE pr.full_name
        END AS author_name,
        CASE
            WHEN p.is_anonymous AND p.author_id <> auth.uid() AND NOT is_admin(auth.uid()) THEN NULL::text
            ELSE pr.avatar_url
        END AS author_avatar,
    (EXISTS ( SELECT 1
           FROM post_likes l
          WHERE l.post_id = p.id AND l.user_id = auth.uid())) AS liked_by_me,
        CASE
            WHEN p.is_anonymous AND p.author_id <> auth.uid() AND NOT is_admin(auth.uid()) THEN NULL::text
            ELSE pr.department
        END AS author_department,
        CASE
            WHEN p.is_anonymous AND p.author_id <> auth.uid() AND NOT is_admin(auth.uid()) THEN false
            ELSE pr.verified
        END AS author_verified
   FROM posts p
     JOIN profiles pr ON pr.id = p.author_id
  WHERE p.hidden = false AND NOT (EXISTS ( SELECT 1
           FROM blocked_users b
          WHERE b.blocker_id = auth.uid() AND b.blocked_id = p.author_id OR b.blocker_id = p.author_id AND b.blocked_id = auth.uid())) AND (p.community_id IS NULL OR (EXISTS ( SELECT 1
           FROM communities c
          WHERE c.id = p.community_id AND c.status = 'approved'::community_status))) AND p.moderation_status = 'approved'::post_moderation;
