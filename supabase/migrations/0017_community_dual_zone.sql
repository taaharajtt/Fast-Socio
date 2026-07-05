-- =============================================================================
-- FAST SOCIO — Community Dual-Zone (CR-011 / UAT-011)
-- Communities gain two distinct zones:
--   ZONE 1 (Posts): member posts require approval by the community OWNER/MOD
--     (the creator, NOT the app admin) before appearing in the feed.
--   ZONE 2 (Chat): an open real-time chat room where any member can post
--     instantly with no approval.
-- Community posts continue to reuse the posts table (+ community_id), so likes,
-- comments, and the anonymity model all carry over.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- ZONE 1: per-post moderation status. Defaults to 'approved' so the main feed
-- and all existing rows are unaffected; a trigger downgrades new community posts
-- from non-owner/mod members to 'pending'.
-- ---------------------------------------------------------------------------
create type public.post_moderation as enum ('pending', 'approved', 'rejected');

alter table public.posts
  add column if not exists moderation_status public.post_moderation not null default 'approved';

create index posts_moderation_idx
  on public.posts (community_id, moderation_status, created_at desc);

-- New community posts from ordinary members start pending; owners/moderators are
-- trusted and auto-approved. Main-feed posts (community_id null) stay approved.
create or replace function public.set_community_post_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.community_id is null then
    new.moderation_status := 'approved';
  elsif exists (
    select 1 from public.community_members m
    where m.community_id = new.community_id
      and m.user_id = new.author_id
      and m.role in ('owner', 'moderator')
  ) then
    new.moderation_status := 'approved';
  else
    new.moderation_status := 'pending';
  end if;
  return new;
end;
$$;

create trigger posts_set_community_status
  before insert on public.posts
  for each row execute function public.set_community_post_status();

-- ---------------------------------------------------------------------------
-- feed_posts view: only surface APPROVED community posts. Same column set as
-- before, so CREATE OR REPLACE is valid.
-- ---------------------------------------------------------------------------
create or replace view public.feed_posts as
select
  p.id,
  p.body,
  p.image_url,
  p.is_anonymous,
  p.community_id,
  p.like_count,
  p.comment_count,
  p.created_at,
  case when p.is_anonymous and p.author_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else p.author_id end as author_id,
  case when p.is_anonymous and p.author_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else pr.full_name end as author_name,
  case when p.is_anonymous and p.author_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else pr.avatar_url end as author_avatar,
  exists (
    select 1 from public.post_likes l
    where l.post_id = p.id and l.user_id = auth.uid()
  ) as liked_by_me
from public.posts p
join public.profiles pr on pr.id = p.author_id
where not exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
       or (b.blocker_id = p.author_id and b.blocked_id = auth.uid())
  )
  and (
    p.community_id is null
    or exists (
      select 1 from public.communities c
      where c.id = p.community_id and c.status = 'approved'
    )
  )
  and p.moderation_status = 'approved';

grant select on public.feed_posts to authenticated;

-- ---------------------------------------------------------------------------
-- community_review_posts view: the owner/moderator's pending-approval queue.
-- The base posts table has SELECT revoked, so this view (owned by the migration
-- role) is the read path. The WHERE clause restricts rows to communities the
-- caller owns or moderates. Anonymous posts keep their author hidden.
-- ---------------------------------------------------------------------------
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
  case when p.is_anonymous then null else pr.avatar_url end as author_avatar
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

-- ---------------------------------------------------------------------------
-- moderate_community_post: owner/moderator approves or rejects a pending post,
-- then the author is notified. SECURITY DEFINER so it can write the (client-
-- insert-protected) notifications row and update the SELECT-revoked posts table.
-- ---------------------------------------------------------------------------
create or replace function public.moderate_community_post(
  p_post_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_community uuid;
  v_author uuid;
begin
  select community_id, author_id into v_community, v_author
    from public.posts where id = p_post_id;

  if v_community is null then
    raise exception 'not a community post';
  end if;

  if not exists (
    select 1 from public.community_members m
    where m.community_id = v_community
      and m.user_id = me
      and m.role in ('owner', 'moderator')
  ) then
    raise exception 'not authorized';
  end if;

  update public.posts
     set moderation_status = case when p_approve then 'approved'::public.post_moderation
                                  else 'rejected'::public.post_moderation end
   where id = p_post_id
     and moderation_status = 'pending';

  -- Notify the author directly (bypasses preference gate: moderation outcomes
  -- are always delivered). Skipped for anonymous self-moderation edge cases.
  if v_author is not null then
    insert into public.notifications (user_id, actor_id, type, data)
      values (
        v_author,
        me,
        case when p_approve then 'community_post_approved' else 'community_post_rejected' end,
        jsonb_build_object('community_id', v_community, 'post_id', p_post_id)
      );
  end if;
end;
$$;

revoke all on function public.moderate_community_post(uuid, boolean) from public;
grant execute on function public.moderate_community_post(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- ZONE 2: community_chat_messages — an open member chat room, no approval.
-- ---------------------------------------------------------------------------
create table public.community_chat_messages (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities (id) on delete cascade,
  sender_id     uuid not null references public.profiles (id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now()
);

create index community_chat_messages_idx
  on public.community_chat_messages (community_id, created_at);

alter table public.community_chat_messages enable row level security;

create policy "members read community chat"
  on public.community_chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.community_members m
      where m.community_id = community_chat_messages.community_id
        and m.user_id = auth.uid()
    )
  );

create policy "members send community chat"
  on public.community_chat_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.community_members m
      where m.community_id = community_chat_messages.community_id
        and m.user_id = auth.uid()
    )
  );

-- Realtime for the chat room (RLS still gates delivery per subscriber).
alter publication supabase_realtime add table public.community_chat_messages;
