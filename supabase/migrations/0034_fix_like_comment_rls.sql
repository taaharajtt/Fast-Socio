-- =============================================================================
-- FAST SOCIO — Fix like/comment RLS "permission denied for table posts" (UAT-002, UAT-009)
--
-- Root cause: the block-guard WITH CHECK policies on post_likes and
-- post_comments (added in 0025, kept in 0032) evaluate
--   (select author_id from public.posts where id = post_id)
-- INLINE in the policy expression. That subquery runs as the INVOKER
-- (`authenticated`), but 0008 revoked SELECT on public.posts from
-- authenticated (posts are read only through the feed_posts view for
-- anonymity). So every like/comment insert raised
--   "permission denied for table posts"
-- which surfaced as:
--   * UAT-002 — the optimistic like rolls back a moment later (insert failed).
--   * UAT-009 — "permission on commenting on posts is denied".
--
-- Fix: read the post author through a SECURITY DEFINER helper so the invoker
-- never touches the posts table directly. Behavior (block guard) is unchanged.
-- =============================================================================

set check_function_bodies = off;

-- Author of a post, resolved with definer rights so RLS policy expressions can
-- use it without needing SELECT on public.posts.
create or replace function public.post_author(p_post_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select author_id from public.posts where id = p_post_id;
$$;

revoke all on function public.post_author(uuid) from public;
grant execute on function public.post_author(uuid) to authenticated;

-- ---- post_comments insert guard ------------------------------------------
alter policy "users create their own comments" on public.post_comments
  with check (
    author_id = (select auth.uid())
    and not public.is_blocked((select auth.uid()), public.post_author(post_id))
  );

-- ---- post_likes insert guard ---------------------------------------------
alter policy "users insert their own likes" on public.post_likes
  with check (
    user_id = (select auth.uid())
    and not public.is_blocked((select auth.uid()), public.post_author(post_id))
  );
