-- =============================================================================
-- FAST SOCIO — Refactor Phase 3a: deterministic feed ranking engine.
--
-- The feed was pure created_at DESC. This adds a deterministic visibility score
-- (recency decay + engagement + department/semester affinity + shared-interest
-- overlap + log-scaled author Aura − pending-report penalty) exposed as the
-- get_ranked_feed() RPC with keyset cursor pagination.
--
-- ADDITIVE: the feed_posts view keeps every existing column (anonymity, block,
-- moderation masking all unchanged) and only gains three author fields at the
-- end. The old chronological path (fetchFeedPage) still works untouched — the
-- client offers "For You" (ranked) alongside "Latest" (chronological).
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Extend feed_posts with the author signals ranking needs. Same leading
--    columns/order as the live view (required by CREATE OR REPLACE VIEW); the
--    three new fields inherit the identical anonymity mask so an anonymous
--    post never leaks its author's semester/aura/interests.
-- ---------------------------------------------------------------------------
create or replace view public.feed_posts as
select
  p.id, p.body, p.image_url, p.is_anonymous, p.community_id,
  p.like_count, p.comment_count, p.created_at,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::uuid else p.author_id end as author_id,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.full_name end as author_name,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.avatar_url end as author_avatar,
  (exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid()))
    as liked_by_me,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.department end as author_department,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then false else pr.verified end as author_verified,
  -- New (Phase 3a): masked author signals for ranking.
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::smallint else pr.semester end as author_semester,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::integer else pr.aura_score end as author_aura,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text[] else pr.interests end as author_interests
from posts p
join profiles pr on pr.id = p.author_id
where p.hidden = false
  and not exists (
    select 1 from blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
       or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
  and (p.community_id is null
       or exists (select 1 from communities c
                  where c.id = p.community_id and c.status = 'approved'::community_status))
  and p.moderation_status = 'approved'::post_moderation;

grant select on public.feed_posts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_ranked_feed — deterministic score + keyset pagination.
--    SECURITY INVOKER: reads the feed_posts view as the caller, so anonymity,
--    blocks and moderation stay enforced. Main feed only (community_id is null).
--
--    Keyset cursor on (rank_score, id): pass the last row's score+id back to get
--    the next page. Row-comparison "<" gives a stable, duplicate-free descending
--    scan. Scores drift slowly (recency term), which is fine within a scroll.
-- ---------------------------------------------------------------------------
create or replace function public.get_ranked_feed(
  p_limit         integer default 20,
  p_cursor_score  double precision default null,
  p_cursor_id     uuid default null
)
returns table (
  id               uuid,
  body             text,
  image_url        text,
  is_anonymous     boolean,
  like_count       integer,
  comment_count    integer,
  created_at       timestamptz,
  author_id        uuid,
  author_name      text,
  author_avatar    text,
  liked_by_me      boolean,
  author_department text,
  author_verified  boolean,
  rank_score       double precision
)
language sql stable security invoker set search_path = public as $$
  with me as (
    select department, semester, interests
    from public.profiles where id = auth.uid()
  ),
  scored as (
    select
      f.id, f.body, f.image_url, f.is_anonymous, f.like_count, f.comment_count,
      f.created_at, f.author_id, f.author_name, f.author_avatar, f.liked_by_me,
      f.author_department, f.author_verified,
      (
        -- Recency: 1.0 fresh, halves every ~12h. Always the dominant fresh term.
        3.0 * (1.0 / (1.0 + (extract(epoch from now() - f.created_at) / 3600.0) / 12.0))
        -- Engagement, log-scaled so a viral post can't dominate forever. Comments
        -- weigh 2x a like (they signal a real conversation).
        + 1.2 * ln(1 + f.like_count + 2 * f.comment_count)
        -- Department / semester affinity (skipped for anon posts: fields are null).
        + 0.8 * (case when f.author_department is not null
                       and f.author_department = (select department from me) then 1 else 0 end)
        + 0.5 * (case when f.author_semester is not null
                       and f.author_semester = (select semester from me) then 1 else 0 end)
        -- Shared-interest overlap count.
        + 0.4 * coalesce((
            select count(*) from unnest(coalesce(f.author_interests, '{}')) ai
            where ai = any (coalesce((select interests from me), '{}'))
          ), 0)
        -- Reputation, log-scaled to keep popularity from dominating.
        + 0.5 * ln(1 + greatest(coalesce(f.author_aura, 0), 0))
        -- Pending-report penalty: soft-demote contested content.
        - 0.3 * least(coalesce((
            select count(*) from public.reports r
            where r.target_type = 'post' and r.target_id = f.id and r.status = 'pending'
          ), 0), 5)
      )::double precision as rank_score
    from public.feed_posts f
    where f.community_id is null
  )
  select
    id, body, image_url, is_anonymous, like_count, comment_count, created_at,
    author_id, author_name, author_avatar, liked_by_me, author_department,
    author_verified, rank_score
  from scored
  where p_cursor_score is null
     or (rank_score, id) < (p_cursor_score, p_cursor_id)
  order by rank_score desc, id desc
  limit greatest(1, least(p_limit, 50));
$$;

grant execute on function public.get_ranked_feed(integer, double precision, uuid) to authenticated;
revoke execute on function public.get_ranked_feed(integer, double precision, uuid) from public, anon;
