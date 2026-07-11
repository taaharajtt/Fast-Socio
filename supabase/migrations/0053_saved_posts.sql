-- =============================================================================
-- FAST SOCIO — Refactor Phase 3b: saved posts (bookmarks).
--
-- Adds a private per-user bookmark on any post. Additive: a new saved_posts
-- table, a saved_by_me flag threaded through the feed_posts view and the
-- get_ranked_feed RPC (symmetric with the existing liked_by_me), so the feed
-- can render the bookmark state and a "Saved" list can filter on it.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. saved_posts — one row per (user, post). Private to the user.
-- ---------------------------------------------------------------------------
create table public.saved_posts (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index saved_posts_user_idx on public.saved_posts (user_id, created_at desc);

alter table public.saved_posts enable row level security;

-- A user fully manages only their own bookmarks; nobody else can see them.
create policy "users read own saved posts"
  on public.saved_posts for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "users add own saved posts"
  on public.saved_posts for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "users remove own saved posts"
  on public.saved_posts for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. feed_posts view — add saved_by_me (mirrors liked_by_me). Same leading
--    columns/order as 0052; only appends the new flag.
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
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::smallint else pr.semester end as author_semester,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::integer else pr.aura_score end as author_aura,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text[] else pr.interests end as author_interests,
  (exists (select 1 from saved_posts s where s.post_id = p.id and s.user_id = auth.uid()))
    as saved_by_me
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
-- 3. get_ranked_feed — return type gains saved_by_me. Return signature changes,
--    so drop + recreate (CREATE OR REPLACE can't alter OUT columns). Body is
--    the 0052 scoring, unchanged, plus f.saved_by_me passed through.
-- ---------------------------------------------------------------------------
drop function if exists public.get_ranked_feed(integer, double precision, uuid);

create function public.get_ranked_feed(
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
  saved_by_me      boolean,
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
      f.author_department, f.author_verified, f.saved_by_me,
      (
        3.0 * (1.0 / (1.0 + (extract(epoch from now() - f.created_at) / 3600.0) / 12.0))
        + 1.2 * ln(1 + f.like_count + 2 * f.comment_count)
        + 0.8 * (case when f.author_department is not null
                       and f.author_department = (select department from me) then 1 else 0 end)
        + 0.5 * (case when f.author_semester is not null
                       and f.author_semester = (select semester from me) then 1 else 0 end)
        + 0.4 * coalesce((
            select count(*) from unnest(coalesce(f.author_interests, '{}')) ai
            where ai = any (coalesce((select interests from me), '{}'))
          ), 0)
        + 0.5 * ln(1 + greatest(coalesce(f.author_aura, 0), 0))
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
    author_verified, saved_by_me, rank_score
  from scored
  where p_cursor_score is null
     or (rank_score, id) < (p_cursor_score, p_cursor_id)
  order by rank_score desc, id desc
  limit greatest(1, least(p_limit, 50));
$$;

grant execute on function public.get_ranked_feed(integer, double precision, uuid) to authenticated;
revoke execute on function public.get_ranked_feed(integer, double precision, uuid) from public, anon;
