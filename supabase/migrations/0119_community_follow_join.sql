-- =============================================================================
-- FAST SOCIO — Community: Follow vs Join
--
-- Until now a community had ONE relationship: community_members. Following a
-- society and joining it were literally the same INSERT (see followSociety),
-- so a student who only wanted broadcasts also got a seat in the chat room.
--
-- This migration splits the two, for societies and casual chat rooms alike:
--
--   FOLLOW  community_followers — spectate. Read broadcasts, get notified.
--           Self-service: insert/delete your own row, no approval.
--   JOIN    community_members   — participate. Send chat messages, post.
--           Requested via community_join_requests and granted by the owner,
--           a community moderator, or (for a society) any officer.
--
-- Nothing about messaging RLS changes: community_chat_messages already keys
-- off community_members, so a follower simply cannot send — which is exactly
-- the rule we now surface in the UI.
--
-- Existing rows are preserved: every current member is backfilled as a
-- follower too (joining implies following), so nobody loses a broadcast.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. community_followers — the spectator relationship.
-- ---------------------------------------------------------------------------
create table if not exists public.community_followers (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists community_followers_user_idx
  on public.community_followers (user_id);

alter table public.community_followers enable row level security;
revoke all on public.community_followers from anon;
grant select, insert, delete on public.community_followers to authenticated;

drop policy if exists "followers are visible" on public.community_followers;
create policy "followers are visible"
  on public.community_followers for select to authenticated using (true);

-- Follow: only yourself, only an approved community. No approval needed.
drop policy if exists "students follow approved communities" on public.community_followers;
create policy "students follow approved communities"
  on public.community_followers for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.communities c
      where c.id = community_id and c.status = 'approved'
    )
  );

-- Unfollow: your own row. The owner is pinned (they always follow their own).
drop policy if exists "students unfollow communities" on public.community_followers;
create policy "students unfollow communities"
  on public.community_followers for delete to authenticated
  using (
    user_id = (select auth.uid())
    and not exists (
      select 1 from public.communities c
      where c.id = community_id and c.owner_id = (select auth.uid())
    )
  );

alter table public.communities
  add column if not exists follower_count integer not null default 0;

create or replace function public.sync_follower_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid := coalesce(new.community_id, old.community_id);
begin
  update public.communities
     set follower_count =
           (select count(*) from public.community_followers where community_id = cid)
   where id = cid;
  return null;
end;
$$;

drop trigger if exists community_followers_sync on public.community_followers;
create trigger community_followers_sync
  after insert or delete on public.community_followers
  for each row execute function public.sync_follower_count();

-- Backfill: a member has always implicitly followed. Do this before the
-- count refresh so follower_count lands correct in one pass.
insert into public.community_followers (community_id, user_id)
select community_id, user_id from public.community_members
on conflict do nothing;

update public.communities c
   set follower_count =
         (select count(*) from public.community_followers f where f.community_id = c.id);

-- ---------------------------------------------------------------------------
-- 2. can_manage_community(community, user) — who approves join requests and
--    removes members. Owner, a community moderator, any society officer, or
--    a platform admin. SECURITY DEFINER so policies can call it.
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_community(p_community uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (
      select 1 from public.communities c
      where c.id = p_community and c.owner_id = p_user
    )
    or exists (
      select 1 from public.community_members m
      where m.community_id = p_community
        and m.user_id = p_user
        and m.role in ('owner', 'moderator')
    )
    or exists (
      select 1 from public.society_roles r
      where r.society_id = p_community and r.user_id = p_user
    )
    or public.is_admin(p_user),
    false
  );
$$;

revoke all on function public.can_manage_community(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_manage_community(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. community_join_requests — a pending ask to participate.
--    'pending' rows are live asks; 'rejected' rows are tombstones that stop a
--    rejected student from re-spamming (they may still cancel and re-ask).
-- ---------------------------------------------------------------------------
create table if not exists public.community_join_requests (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'rejected')),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.profiles (id) on delete set null,
  primary key (community_id, user_id)
);

create index if not exists community_join_requests_community_idx
  on public.community_join_requests (community_id, status, created_at);

alter table public.community_join_requests enable row level security;
revoke all on public.community_join_requests from anon;
-- Reads are direct (the Manage tab lists them); every write goes through the
-- RPCs below except cancelling your own ask.
grant select, delete on public.community_join_requests to authenticated;

drop policy if exists "requesters and managers read join requests"
  on public.community_join_requests;
create policy "requesters and managers read join requests"
  on public.community_join_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_manage_community(community_id, (select auth.uid()))
  );

drop policy if exists "students cancel their join request"
  on public.community_join_requests;
create policy "students cancel their join request"
  on public.community_join_requests for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. request_community_join — ask to participate. Following is implied by
--    asking (you clearly want the broadcasts), so it also follows.
--    Returns 'joined' | 'pending' | 'rejected'.
-- ---------------------------------------------------------------------------
create or replace function public.request_community_join(p_community uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_status text;
  v_owner  uuid;
  m        record;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select owner_id into v_owner
    from public.communities where id = p_community and status = 'approved';
  if v_owner is null then
    raise exception 'community not found';
  end if;

  if exists (
    select 1 from public.community_members
    where community_id = p_community and user_id = uid
  ) then
    return 'joined';
  end if;

  -- Asking implies spectating.
  insert into public.community_followers (community_id, user_id)
    values (p_community, uid)
    on conflict do nothing;

  insert into public.community_join_requests (community_id, user_id, status)
    values (p_community, uid, 'pending')
    on conflict (community_id, user_id) do nothing
    returning status into v_status;

  if v_status is null then
    -- A row already existed: report its state rather than reviving a rejection.
    select status into v_status from public.community_join_requests
      where community_id = p_community and user_id = uid;
    return coalesce(v_status, 'pending');
  end if;

  -- Tell everyone who can act on it.
  for m in
    select distinct x.user_id from (
      select v_owner as user_id
      union
      select cm.user_id from public.community_members cm
        where cm.community_id = p_community and cm.role in ('owner', 'moderator')
      union
      select sr.user_id from public.society_roles sr
        where sr.society_id = p_community
    ) x
  loop
    perform public.create_notification(
      m.user_id, uid, 'community_join_request', 'communities',
      jsonb_build_object('community_id', p_community)
    );
  end loop;

  return 'pending';
end;
$$;

revoke all on function public.request_community_join(uuid)
  from public, anon, authenticated;
grant execute on function public.request_community_join(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. decide_community_join_request — owner/moderator/officer approves or
--    rejects. Approving inserts the membership under definer rights (the
--    self-only INSERT policy on community_members cannot do this).
-- ---------------------------------------------------------------------------
create or replace function public.decide_community_join_request(
  p_community uuid,
  p_user      uuid,
  p_approve   boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if not public.can_manage_community(p_community, uid) then
    raise exception 'not authorized';
  end if;
  if not exists (
    select 1 from public.community_join_requests
    where community_id = p_community and user_id = p_user and status = 'pending'
  ) then
    raise exception 'no pending request';
  end if;

  if p_approve then
    insert into public.community_members (community_id, user_id, role)
      values (p_community, p_user, 'member')
      on conflict do nothing;
    insert into public.community_followers (community_id, user_id)
      values (p_community, p_user)
      on conflict do nothing;
    delete from public.community_join_requests
      where community_id = p_community and user_id = p_user;
    perform public.create_notification(
      p_user, uid, 'community_join_approved', 'communities',
      jsonb_build_object('community_id', p_community)
    );
  else
    update public.community_join_requests
       set status = 'rejected', decided_at = now(), decided_by = uid
     where community_id = p_community and user_id = p_user;
  end if;
end;
$$;

revoke all on function public.decide_community_join_request(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.decide_community_join_request(uuid, uuid, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. remove_community_member — kick. Managers only; the owner is immovable and
--    a manager may not kick another manager. Removing participation leaves the
--    follow intact (they can still spectate, like any outsider).
-- ---------------------------------------------------------------------------
create or replace function public.remove_community_member(
  p_community uuid,
  p_user      uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  v_owner uuid;
begin
  if not public.can_manage_community(p_community, uid) then
    raise exception 'not authorized';
  end if;
  select owner_id into v_owner from public.communities where id = p_community;
  if p_user = v_owner then
    raise exception 'the owner cannot be removed';
  end if;
  if p_user <> uid and public.can_manage_community(p_community, p_user)
     and not public.is_admin(uid) then
    raise exception 'cannot remove another manager';
  end if;

  delete from public.community_members
    where community_id = p_community and user_id = p_user;
end;
$$;

revoke all on function public.remove_community_member(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Broadcasts reach FOLLOWERS, not just members — that is what following is
--    for. Members are backfilled as followers above, so this is a superset of
--    the old behaviour and no existing recipient loses a notification.
-- ---------------------------------------------------------------------------
create or replace function public.notify_society_members(
  p_society uuid,
  p_actor   uuid,
  p_type    text,
  p_data    jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  for m in
    select user_id from public.community_followers where community_id = p_society
    union
    select user_id from public.community_members where community_id = p_society
  loop
    perform public.create_notification(m.user_id, p_actor, p_type, 'communities', p_data);
  end loop;
end;
$$;

revoke all on function public.notify_society_members(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
