-- ===========================================================================
-- 0180 — carousel image posts (1–5 ordered images per post)
--
-- Until now a post held at most one image, in `posts.image_url`. This adds an
-- ORDERED CHILD TABLE, `post_media`, and a post-level layout mode, so a post
-- can carry up to five normalized images and the client knows the carousel's
-- geometry before it paints.
--
-- WHY A CHILD TABLE AND NOT A JSON ARRAY ON `posts`
--
--   Ordering, uniqueness, the five-image ceiling, the allowed aspect ratios and
--   "dimensions must be positive" are all constraints. In a jsonb column every
--   one of them is a convention that some future code path forgets; as columns
--   on a child table they are `check` and `unique` and cannot be forgotten.
--   The five-image ceiling in particular falls out of two constraints together:
--   `position` is `>= 0 and < 5`, and `(post_id, position)` is unique — so six
--   rows for one post is not "discouraged", it is impossible.
--
-- BACKWARD COMPATIBILITY — `posts.image_url` IS NOT DEPRECATED HERE
--
--   Every existing single-image post keeps rendering from `image_url` and is
--   NOT backfilled into `post_media`. A backfill would have to invent a stored
--   aspect ratio and pixel size for images nobody has measured, and a wrong
--   stored ratio is exactly the layout-shift bug this feature exists to avoid.
--   Legacy rows therefore stay legacy rows, and the readers fall back to
--   `image_url` when `media` is empty.
--
--   Going the other way, a NEW media post also writes slide 1's URL into
--   `image_url`. That is not redundancy for its own sake: it keeps every reader
--   that predates this migration — account-deletion cleanup, the shared-post
--   chat preview, the community review queue, an older client still running in
--   a PWA shell — showing the correct cover instead of nothing, during and
--   after the rollout. `post_media` is canonical; `image_url` is the cover.
--
-- ATOMICITY
--
--   A partially created carousel must never be visible, so the post row and its
--   media rows are written by one SECURITY DEFINER function in one statement
--   batch. `create_post_with_media` re-checks community membership itself,
--   because SECURITY DEFINER bypasses the `users create their own posts` RLS
--   policy that would otherwise enforce it. Row triggers (ban enforcement,
--   moderation status, match/mention notifications) still fire normally.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Post-level layout mode.
-- ---------------------------------------------------------------------------
--   uniform — slide 1's ratio is the viewport for every slide (centre-cropped).
--   mixed   — a square viewport; every slide is contained inside it.
alter table public.posts
  add column if not exists carousel_layout text not null default 'uniform';

do $$
begin
  alter table public.posts
    add constraint posts_carousel_layout_check
    check (carousel_layout in ('uniform', 'mixed'));
exception
  when duplicate_object then null;
end $$;


-- ---------------------------------------------------------------------------
-- 2. The ordered media rows.
-- ---------------------------------------------------------------------------
create table if not exists public.post_media (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  position   smallint not null,
  media_url  text not null,
  aspect     text not null,
  width      integer not null,
  height     integer not null,
  created_at timestamptz not null default now(),

  -- Five images per post, enforced structurally: positions are 0..4 and no two
  -- rows on one post may share a position.
  constraint post_media_position_check check ("position" >= 0 and "position" < 5),
  constraint post_media_post_position_key unique (post_id, "position"),

  -- The three ratios the composer, the cropper and the feed all agree on.
  constraint post_media_aspect_check check (aspect in ('1:1', '16:9', '9:16')),

  -- A stored size is what the client uses to reserve space before paint; a zero
  -- or negative one would mean a collapsed container.
  constraint post_media_dimensions_check check (width > 0 and height > 0),

  -- The application also checks the URL against its own storage base (which the
  -- database has no way to know); this is the shape floor beneath that.
  constraint post_media_url_check check (media_url ~ '^https?://')
);

-- The feed reads a post's media in position order, one post at a time.
create index if not exists post_media_post_position_idx
  on public.post_media (post_id, position);

alter table public.post_media enable row level security;

-- No client-facing policy, and no client-facing privileges. Reads happen
-- through the aggregated `media` column on the feed views below (which run with
-- the view owner's rights, exactly like the rest of the read path), and writes
-- happen only through `create_post_with_media`. This is the same posture as
-- `posts` itself, and it is what makes "a client cannot attach media to
-- somebody else's post" a property of the schema rather than of a policy
-- predicate that has to be right.
revoke all on public.post_media from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Atomic create: the post and every slide, or neither.
-- ---------------------------------------------------------------------------
set check_function_bodies = off;

create or replace function public.create_post_with_media(
  p_body         text,
  p_is_anonymous boolean,
  p_community_id uuid,
  p_poll_id      uuid,
  p_risk_score   smallint,
  p_media        jsonb,
  p_layout       text,
  -- The legacy single-image shape: one image, no measured dimensions. It becomes
  -- the cover and nothing else — deliberately NOT a post_media row, because that
  -- would mean inventing a stored ratio for it. Ignored when p_media is present.
  p_image_url    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  v_media  jsonb := coalesce(p_media, '[]'::jsonb);
  v_count  int;
  v_cover  text;
  v_post   uuid;
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_item   jsonb;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  if p_layout is null or p_layout not in ('uniform', 'mixed') then
    raise exception 'invalid layout';
  end if;

  if jsonb_typeof(v_media) <> 'array' then
    raise exception 'invalid media';
  end if;
  v_count := jsonb_array_length(v_media);

  if v_count > 5 then
    raise exception 'a post can have at most 5 photos';
  end if;

  -- Polls and media are mutually exclusive, on both sides of the wire.
  if p_poll_id is not null and v_count > 0 then
    raise exception 'a poll cannot carry photos';
  end if;

  -- A post must say something: text, photos, or a poll.
  if v_body is null and v_count = 0 and p_poll_id is null
     and nullif(btrim(coalesce(p_image_url, '')), '') is null then
    raise exception 'write something';
  end if;

  -- Per-item shape. The table constraints would catch all of this on insert,
  -- but raising here keeps the failure a named, translatable condition instead
  -- of a raw constraint-violation message reaching the user.
  for v_item in select * from jsonb_array_elements(v_media) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid media';
    end if;
    if coalesce(v_item ->> 'url', '') !~ '^https?://' then
      raise exception 'invalid media url';
    end if;
    if coalesce(v_item ->> 'aspect', '') not in ('1:1', '16:9', '9:16') then
      raise exception 'invalid media aspect';
    end if;
    if coalesce((v_item ->> 'width')::int, 0) <= 0
       or coalesce((v_item ->> 'height')::int, 0) <= 0 then
      raise exception 'invalid media size';
    end if;
  end loop;

  -- SECURITY DEFINER bypasses RLS, so the community rule the "users create
  -- their own posts" policy would have applied is re-applied by hand. Without
  -- this, the RPC would be a way to post into any community.
  if p_community_id is not null then
    if not exists (
      select 1
      from public.community_members m
      join public.communities c on c.id = m.community_id
      where m.community_id = p_community_id
        and m.user_id = me
        and c.status = 'approved'
    ) then
      raise exception 'not a member of that community';
    end if;
  end if;

  -- Slide 1 is the cover, and the cover is what legacy readers see. With no
  -- slides, a legacy single image is the cover instead. A poll never carries one.
  v_cover := coalesce(
    v_media -> 0 ->> 'url',
    case when p_poll_id is null then nullif(btrim(coalesce(p_image_url, '')), '') end
  );

  if v_cover is not null and v_cover !~ '^https?://' then
    raise exception 'invalid media url';
  end if;

  -- author_id is auth.uid(), never a client-supplied value.
  insert into public.posts (
    author_id, body, image_url, is_anonymous, community_id, poll_id,
    risk_score, carousel_layout
  )
  values (
    me, v_body, v_cover, coalesce(p_is_anonymous, false), p_community_id,
    p_poll_id, coalesce(p_risk_score, 0::smallint), p_layout
  )
  returning id into v_post;

  -- Positions come from array ordinality, so a client cannot send a duplicate,
  -- a gap or a negative position — it does not get to name them at all.
  if v_count > 0 then
    insert into public.post_media (post_id, position, media_url, aspect, width, height)
    select
      v_post,
      (ord - 1)::smallint,
      item ->> 'url',
      item ->> 'aspect',
      (item ->> 'width')::int,
      (item ->> 'height')::int
    from jsonb_array_elements(v_media) with ordinality as t(item, ord);
  end if;

  return v_post;
end;
$$;

revoke all on function public.create_post_with_media(text, boolean, uuid, uuid, smallint, jsonb, text, text)
  from public, anon;
grant execute on function public.create_post_with_media(text, boolean, uuid, uuid, smallint, jsonb, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Account deletion has to be able to find every object it owns.
-- ---------------------------------------------------------------------------
-- The delete-account path used to read `feed_posts.image_url`, which misses two
-- things now: slides 2..5 of a carousel, and any post that is hidden or awaiting
-- moderation (the view filters those out, so their images were never purged).
-- One definer function returns every media URL the caller's own posts reference,
-- from both storage locations, regardless of moderation state.
create or replace function public.my_post_media_urls()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select p.image_url
    from public.posts p
   where p.author_id = auth.uid()
     and p.image_url is not null
  union
  select m.media_url
    from public.post_media m
    join public.posts p on p.id = m.post_id
   where p.author_id = auth.uid();
$$;

revoke all on function public.my_post_media_urls() from public, anon;
grant execute on function public.my_post_media_urls() to authenticated;


-- ---------------------------------------------------------------------------
-- 5. delete_post now hands back the objects it orphaned.
-- ---------------------------------------------------------------------------
-- `post_media` cascades with the post, but object storage has no cascade. The
-- caller is the only thing that can purge the bytes, and after the delete the
-- URLs are gone — so they are returned by the delete itself.
--
-- The return type changes (void -> text[]), which CREATE OR REPLACE cannot do,
-- hence the drop. Same name, same single-uuid argument, same ownership rule, so
-- an older client that ignores the result is unaffected.
drop function if exists public.delete_post(uuid);

create or replace function public.delete_post(p_post_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  v_poll uuid;
  v_urls text[];
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  -- Collected BEFORE the delete: the cascade takes post_media with the post.
  select array_remove(
           array_agg(u.url),
           null
         )
    into v_urls
    from (
      select p.image_url as url
        from public.posts p
       where p.id = p_post_id and p.author_id = me and p.image_url is not null
      union
      select m.media_url
        from public.post_media m
        join public.posts p on p.id = m.post_id
       where m.post_id = p_post_id and p.author_id = me
    ) u;

  delete from public.posts
   where id = p_post_id and author_id = me
   returning poll_id into v_poll;

  if not found then
    raise exception 'post not found or not yours';
  end if;

  -- Drop the poll this post carried; post_poll_options/votes cascade from it.
  if v_poll is not null then
    delete from public.post_polls where id = v_poll;
  end if;

  return coalesce(v_urls, array[]::text[]);
end;
$$;

revoke all on function public.delete_post(uuid) from public, anon;
grant execute on function public.delete_post(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Read paths: one aggregated, ordered `media` column per post.
-- ---------------------------------------------------------------------------
-- The feed must not do one query per post to find its slides. The views
-- aggregate `post_media` into an ordered jsonb array inline, so a 20-post page
-- is still one round trip, and the array is masked by exactly the same view
-- (and therefore the same anonymity and block/mute rules) as the post itself.
--
-- Neither view is security_invoker: the base `posts` table has SELECT revoked,
-- so the owner's rights ARE the read path. Keeping reloptions null matches prod.

drop view if exists public.feed_posts;

create view public.feed_posts as
select
  p.id, p.body, p.image_url, p.is_anonymous, p.community_id, p.poll_id,
  p.like_count, p.comment_count, p.created_at, p.edited_at,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::uuid else p.author_id end as author_id,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.full_name end as author_name,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.avatar_url end as author_avatar,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.gender end as author_gender,
  (exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid()))
    as liked_by_me,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.department end as author_department,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then false else pr.verified end as author_verified,
  p.carousel_layout,
  coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'url', m.media_url,
               'aspect', m.aspect,
               'width', m.width,
               'height', m.height
             )
             order by m.position
           )
      from public.post_media m
     where m.post_id = p.id
  ), '[]'::jsonb) as media
from posts p
join profiles pr on pr.id = p.author_id
where p.hidden = false
  and not exists (
    select 1 from blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
       or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
  and (not pr.shadow_banned or p.author_id = auth.uid())
  and not exists (
    select 1 from muted_users mu
    where mu.muter_id = auth.uid() and mu.muted_id = p.author_id)
  and (p.community_id is null
       or exists (select 1 from communities c
                  where c.id = p.community_id and c.status = 'approved'::community_status))
  and p.moderation_status = 'approved'::post_moderation;

grant select on public.feed_posts to authenticated;


-- The society/community manager's pending-post queue. Same shape as 0127 plus
-- the cover-relevant columns, appended at the end so CREATE OR REPLACE is legal
-- and the view's existing grants survive.
create or replace view public.community_review_posts as
select
  p.id,
  p.community_id,
  p.body,
  p.image_url,
  p.is_anonymous,
  p.created_at,
  case when p.is_anonymous then null else p.author_id end as author_id,
  case when p.is_anonymous then null else pr.full_name end as author_name,
  case when p.is_anonymous then null else pr.avatar_url end as author_avatar,
  case when p.is_anonymous then null else pr.gender end as author_gender,
  p.carousel_layout,
  coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'url', m.media_url,
               'aspect', m.aspect,
               'width', m.width,
               'height', m.height
             )
             order by m.position
           )
      from public.post_media m
     where m.post_id = p.id
  ), '[]'::jsonb) as media
from public.posts p
join public.profiles pr on pr.id = p.author_id
where p.community_id is not null
  and p.moderation_status = 'pending'
  and exists (
    select 1 from public.community_members m
    where m.community_id = p.community_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'moderator')
  );

grant select on public.community_review_posts to authenticated;

-- Hygiene parity with 0088: client roles get SELECT and nothing else.
revoke truncate, references, trigger on public.feed_posts from anon, authenticated;
revoke truncate, references, trigger on public.community_review_posts from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. Which of these uploaded objects is nothing pointing at?
-- ---------------------------------------------------------------------------
-- The composer uploads each cropped photo as soon as it is confirmed, so the
-- publish itself is instant. That means a draft the user abandons — or a
-- create-post that fails after some photos were stored — leaves objects in
-- storage that no row references. The client knows those URLs (they are in the
-- draft it is still holding) and asks the server to purge them.
--
-- The guard that makes this safe is here rather than in the app: a URL is only
-- ever returned as purgeable if NOTHING references it. A published photo can
-- therefore never be deleted through this path, whoever asks. Unpublished
-- object keys are random UUIDs under a shared prefix and are not discoverable
-- before they are posted, at which point this function stops returning them.
create or replace function public.unreferenced_post_media(p_urls text[])
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select u.url
    from unnest(coalesce(p_urls, array[]::text[])) as u(url)
   where u.url is not null
     and not exists (select 1 from public.posts p where p.image_url = u.url)
     and not exists (select 1 from public.post_media m where m.media_url = u.url);
$$;

revoke all on function public.unreferenced_post_media(text[]) from public, anon;
grant execute on function public.unreferenced_post_media(text[]) to authenticated;

-- `posts.image_url` and `post_media.media_url` are both probed by equality on
-- every purge request; without these the guard is two sequential scans.
create index if not exists posts_image_url_idx
  on public.posts (image_url) where image_url is not null;
create index if not exists post_media_url_idx
  on public.post_media (media_url);
