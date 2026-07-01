-- =============================================================================
-- FAST SOCIO — Communities (Phase 5)
-- OQ-5 decision: communities are ADMIN-APPROVED. A student submits a community
-- (status = pending); an admin approves/rejects via a logged SECURITY DEFINER
-- function. Community posts reuse the posts table (+ community_id) so likes,
-- comments, and the anonymity model all carry over.
-- =============================================================================

set check_function_bodies = off;

create type public.community_status as enum ('pending', 'approved', 'rejected');
create type public.community_role as enum ('owner', 'moderator', 'member');

-- ---------------------------------------------------------------------------
-- communities
-- ---------------------------------------------------------------------------
create table public.communities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 60),
  description   text check (description is null or char_length(description) <= 500),
  avatar_url    text,
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  status        public.community_status not null default 'pending',
  member_count  integer not null default 0,
  created_at    timestamptz not null default now()
);

create index communities_status_idx on public.communities (status);
create index communities_owner_idx on public.communities (owner_id);

alter table public.communities enable row level security;

-- Approved communities are visible to all; owners and admins see their own/all.
create policy "approved communities are visible"
  on public.communities for select to authenticated
  using (status = 'approved' or owner_id = auth.uid() or public.is_admin(auth.uid()));

-- Any onboarded student may submit a community, but only as pending + self-owned.
create policy "students submit pending communities"
  on public.communities for insert to authenticated
  with check (owner_id = auth.uid() and status = 'pending');

-- Owners may edit metadata; a trigger prevents them from changing status.
create policy "owners edit their community"
  on public.communities for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.protect_community_status()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.community_moderation', true) = '1' then
    return new; -- trusted approve/reject path
  end if;
  if auth.role() = 'authenticated' then
    new.status := old.status; -- non-admins cannot change status
  end if;
  return new;
end;
$$;

create trigger communities_protect_status
  before update on public.communities
  for each row execute function public.protect_community_status();

-- ---------------------------------------------------------------------------
-- community_members
-- ---------------------------------------------------------------------------
create table public.community_members (
  community_id  uuid not null references public.communities (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          public.community_role not null default 'member',
  joined_at     timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index community_members_user_idx on public.community_members (user_id);

alter table public.community_members enable row level security;

create policy "members are visible"
  on public.community_members for select to authenticated using (true);

-- Join: only yourself, only as a plain member, only approved communities.
create policy "students join approved communities"
  on public.community_members for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'member'
    and exists (
      select 1 from public.communities c
      where c.id = community_id and c.status = 'approved'
    )
  );

-- Leave: remove your own membership (owners cannot leave their community).
create policy "members leave communities"
  on public.community_members for delete to authenticated
  using (
    user_id = auth.uid()
    and not exists (
      select 1 from public.communities c
      where c.id = community_id and c.owner_id = auth.uid()
    )
  );

create or replace function public.sync_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid := coalesce(new.community_id, old.community_id);
begin
  update public.communities
     set member_count = (select count(*) from public.community_members where community_id = cid)
   where id = cid;
  return null;
end;
$$;

create trigger community_members_sync
  after insert or delete on public.community_members
  for each row execute function public.sync_member_count();

-- On creation, the owner joins as 'owner'.
create or replace function public.add_community_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.community_members (community_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict do nothing;
  return null;
end;
$$;

create trigger communities_add_owner
  after insert on public.communities
  for each row execute function public.add_community_owner();

-- ---------------------------------------------------------------------------
-- posts: scope to a community (null = main campus feed).
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists community_id uuid references public.communities (id) on delete cascade;

create index posts_community_idx on public.posts (community_id, created_at desc);

-- Replace the insert policy: community posts require membership of an approved
-- community; main-feed posts (community_id null) are unchanged.
drop policy if exists "users create their own posts" on public.posts;
create policy "users create their own posts"
  on public.posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      community_id is null
      or exists (
        select 1
        from public.community_members m
        join public.communities c on c.id = m.community_id
        where m.community_id = posts.community_id
          and m.user_id = auth.uid()
          and c.status = 'approved'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- feed_posts view: expose community_id; hide posts in non-approved communities.
-- Dropped + recreated because column order changes (can't CREATE OR REPLACE).
-- ---------------------------------------------------------------------------
drop view if exists public.feed_posts;
create view public.feed_posts as
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
  );

grant select on public.feed_posts to authenticated;

-- ---------------------------------------------------------------------------
-- Admin moderation: approve / reject with audit logging.
-- ---------------------------------------------------------------------------
create or replace function public.moderate_community(
  p_community_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  perform set_config('app.community_moderation', '1', true);
  update public.communities
     set status = case when p_approve then 'approved'::public.community_status
                       else 'rejected'::public.community_status end
   where id = p_community_id;
  perform set_config('app.community_moderation', '0', true);

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id,
            case when p_approve then 'approve_community' else 'reject_community' end,
            'community', p_community_id, null);
end;
$$;

revoke all on function public.moderate_community(uuid, boolean) from public;
grant execute on function public.moderate_community(uuid, boolean) to authenticated;
