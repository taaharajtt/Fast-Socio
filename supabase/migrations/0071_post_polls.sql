-- =============================================================================
-- FAST SOCIO — Polls on feed posts
--
-- Mirrors the community-chat poll design (mig 0045) but for the main campus feed:
-- a post may carry a poll (posts.poll_id). Individual ballots are private (a
-- voter reads only their own row); tallies come from a definer view. All writes
-- go through SECURITY DEFINER RPCs — no INSERT/UPDATE policies are opened.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.post_polls (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.profiles (id) on delete cascade,
  question    text not null check (char_length(question) between 1 and 300),
  created_at  timestamptz not null default now()
);

create table if not exists public.post_poll_options (
  id        uuid primary key default gen_random_uuid(),
  poll_id   uuid not null references public.post_polls (id) on delete cascade,
  label     text not null check (char_length(label) between 1 and 80),
  position  int  not null
);

create table if not exists public.post_poll_votes (
  poll_id    uuid not null references public.post_polls (id) on delete cascade,
  option_id  uuid not null references public.post_poll_options (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create index if not exists post_poll_options_poll_idx
  on public.post_poll_options (poll_id, position);
create index if not exists post_poll_votes_option_idx
  on public.post_poll_votes (option_id);
create index if not exists post_poll_votes_user_idx
  on public.post_poll_votes (user_id);

-- The post that carries the poll. A poll is created first, then the post row
-- references it (mirrors the community message → poll_id order).
alter table public.posts
  add column if not exists poll_id uuid references public.post_polls (id) on delete cascade;

alter table public.post_polls        enable row level security;
alter table public.post_poll_options enable row level security;
alter table public.post_poll_votes   enable row level security;

-- Polls and their options are campus-wide readable (the feed is public to every
-- signed-in student), matching feed_posts' visibility.
create policy "authenticated read post polls"
  on public.post_polls for select to authenticated using (true);
create policy "authenticated read post poll options"
  on public.post_poll_options for select to authenticated using (true);

-- A voter may read only their OWN ballot. Tallies come from post_poll_results.
create policy "users read their own post poll vote"
  on public.post_poll_votes for select to authenticated
  using (user_id = (select auth.uid()));

-- No client INSERT/UPDATE on any of the three: writes go through the RPCs below.

-- ---------------------------------------------------------------------------
-- post_poll_results: per-option tallies + whether the caller picked it. Definer
-- rights let it count ballots the caller cannot read directly.
-- ---------------------------------------------------------------------------
create or replace view public.post_poll_results as
select
  o.poll_id,
  o.id       as option_id,
  o.label,
  o.position,
  (select count(*) from public.post_poll_votes v where v.option_id = o.id) as votes,
  exists (
    select 1 from public.post_poll_votes v
    where v.option_id = o.id and v.user_id = auth.uid()
  ) as voted_by_me
from public.post_poll_options o;

grant select on public.post_poll_results to authenticated;

-- ---------------------------------------------------------------------------
-- create_post_poll: poll + options in one transaction, returning the poll id.
-- The caller (createPost server action) then inserts the post row with this
-- poll_id, keeping the app-side moderation/rate-limit path intact.
-- ---------------------------------------------------------------------------
create or replace function public.create_post_poll(
  p_question text,
  p_options  text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  v_poll  uuid;
  v_label text;
  i       int := 0;
  n       int := 0;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  if char_length(btrim(p_question)) < 1 then
    raise exception 'question is required';
  end if;

  select count(*) into n
    from unnest(p_options) o where btrim(o) <> '';
  if n < 2 or n > 6 then
    raise exception 'a poll needs 2-6 options';
  end if;

  insert into public.post_polls (creator_id, question)
    values (me, btrim(p_question))
    returning id into v_poll;

  foreach v_label in array p_options loop
    if btrim(v_label) <> '' then
      insert into public.post_poll_options (poll_id, label, position)
        values (v_poll, btrim(v_label), i);
      i := i + 1;
    end if;
  end loop;

  return v_poll;
end;
$$;

revoke all on function public.create_post_poll(text, text[]) from public;
grant execute on function public.create_post_poll(text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- vote_post_poll: one ballot per voter per poll; re-voting moves it.
-- ---------------------------------------------------------------------------
create or replace function public.vote_post_poll(p_poll_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  if not exists (
    select 1 from public.post_poll_options o
    where o.id = p_option_id and o.poll_id = p_poll_id
  ) then
    raise exception 'option does not belong to this poll';
  end if;

  insert into public.post_poll_votes (poll_id, option_id, user_id)
    values (p_poll_id, p_option_id, me)
    on conflict (poll_id, user_id)
    do update set option_id = excluded.option_id, created_at = now();
end;
$$;

revoke all on function public.vote_post_poll(uuid, uuid) from public;
grant execute on function public.vote_post_poll(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- feed_posts: expose poll_id. Drop+recreate (a view can't add a column in
-- place) from the current definition (mig 0064) — every Phase-9 visibility
-- filter is preserved verbatim; only p.poll_id is added.
-- ---------------------------------------------------------------------------
drop view if exists public.feed_posts;

create view public.feed_posts as
select
  p.id, p.body, p.image_url, p.is_anonymous, p.community_id, p.poll_id,
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
       then false else pr.verified end as author_verified
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
