-- =============================================================================
-- FAST SOCIO — The Community dock badge
--
-- WHY
-- The Community tab has never carried a badge. The student layout passed a
-- count under the key "/events", but "/events" is not a nav item (NAV_ITEMS has
-- "/communities"; /events is an ADOPTED_ROUTE that merely lights that tab), so
-- `badges["/events"]` was read by nothing and the number was computed on every
-- shell render and thrown away. Meanwhile the one thing that could have cleared
-- it, `touch_events_seen()` from 0045, is called by no application code at all
-- — so even had it rendered, it would have been permanently stuck.
--
-- WHAT THE BADGE MEANS
-- Grouped Community / Event / Broadcast ITEMS. Never raw messages: community
-- chat is deliberately absent, and a space that posts twenty announcements
-- contributes ONE item, not twenty. Six item kinds, summed:
--
--   manage       communities where you are a manager and something is waiting
--                on you (a pending join request, or a post in the review
--                queue). One community needing management = 1, two = 2 —
--                counted per COMMUNITY, not per queued row.
--   joined       you were approved into a community by someone else.
--   communities  a new community was created (approved, public).
--   events       a new event was created (approved, still upcoming).
--   broadcasts   a space you follow posted an announcement, collapsed to one
--                item per SPACE however many it posted.
--   approvals    an admin approved a community or an event of yours.
--
-- THE SEEN MODEL — the hard part, and why it is split in two.
--
-- A single `communities_seen_at` would have been wrong in both directions:
-- opening the hub would silence a join request waiting inside a community you
-- never opened, and opening one society would silence every other society's
-- broadcasts. So "seen" is recorded at the granularity the item belongs to:
--
--   profiles.communities_seen_at  the HUB. Covers the items visible from
--                                 /communities: new communities, new
--                                 memberships, your own approvals. Stamped by
--                                 touch_community_seen().
--   profiles.events_seen_at       events, unchanged from 0045 and reused rather
--                                 than duplicated. Stamped by the same call,
--                                 because the hub is where events are listed
--                                 today; there is no /events index page. A
--                                 future one can stamp this mark alone.
--   community_seen (per space)    one row per (user, community). Covers the
--                                 items that live INSIDE a space: its review
--                                 queue and its broadcasts. Stamped by
--                                 touch_community_space_seen(id) when that
--                                 space's page is opened, so reading one
--                                 society cannot silence another.
--
-- Every item kind is time-gated against its own mark, which is what keeps the
-- badge honest in the direction that matters most: it can never point at a
-- state the student has already looked at. A management item still unresolved
-- when you leave does NOT keep badging — you have seen it, it is on your list —
-- but a NEW request arriving afterwards badges again.
--
-- Rows the student created themselves are excluded throughout (your own
-- community, your own event, your own post, a space you joined by pressing
-- Join). A badge for something you just did is noise.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. approved_at — when an admin said yes.
--
-- `status` records the verdict but not when it landed, so "approved since you
-- last looked" was not expressible. A trigger stamps it on the transition into
-- 'approved' rather than the moderate_*() RPCs doing it, so EVERY path that
-- approves a row is covered: the admin RPCs, a future bulk tool, a hand-run fix
-- in the SQL editor. Backfilled to created_at for rows already approved, which
-- puts them safely in the past and badges nobody on deploy.
-- ---------------------------------------------------------------------------
alter table public.communities
  add column if not exists approved_at timestamptz;
alter table public.events
  add column if not exists approved_at timestamptz;

update public.communities
   set approved_at = created_at
 where status = 'approved' and approved_at is null;
update public.events
   set approved_at = created_at
 where status = 'approved' and approved_at is null;

create or replace function public.stamp_approved_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.approved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists communities_stamp_approved_at on public.communities;
create trigger communities_stamp_approved_at
  before insert or update of status on public.communities
  for each row execute function public.stamp_approved_at();

drop trigger if exists events_stamp_approved_at on public.events;
create trigger events_stamp_approved_at
  before insert or update of status on public.events
  for each row execute function public.stamp_approved_at();

-- ---------------------------------------------------------------------------
-- 2. community_members.approved_by — who let you in.
--
-- This is what separates "you were approved into a community" (badge-worthy:
-- someone acted on your request while you were away) from "you pressed Join on
-- a public space" (not badge-worthy: you were standing right there). Null for
-- every existing row and for every self-join; set only by
-- decide_community_join_request below.
-- ---------------------------------------------------------------------------
alter table public.community_members
  add column if not exists approved_by uuid
    references public.profiles (id) on delete set null;

create index if not exists community_members_user_joined_idx
  on public.community_members (user_id, joined_at desc);

-- Re-declared from 0119 with ONE change: the membership insert records the
-- approver. Everything else — the authorization check, the pending-request
-- check, the follow, the tombstone delete, the notification — is carried over
-- verbatim. `approved_by` is written under definer rights; the self-only INSERT
-- policy on community_members has no say here, and students cannot set it.
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
    insert into public.community_members (community_id, user_id, role, approved_by)
      values (p_community, p_user, 'member', uid)
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
-- 3. The seen marks.
--
-- community_seen is deliberately its own table rather than a jsonb blob on
-- profiles: it is written on every space visit and read with an index lookup
-- per space, and a blob would make both a whole-row rewrite.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists communities_seen_at timestamptz;

create table if not exists public.community_seen (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  seen_at      timestamptz not null default now(),
  primary key (user_id, community_id)
);

alter table public.community_seen enable row level security;
revoke all on public.community_seen from anon;
-- Reads only, and only your own marks. Every write goes through the definer RPC
-- below, so a student cannot stamp someone else's row (which would silence
-- another person's badge) or forge a future seen_at.
grant select on public.community_seen to authenticated;

drop policy if exists "students read their own seen marks" on public.community_seen;
create policy "students read their own seen marks"
  on public.community_seen for select to authenticated
  using (user_id = (select auth.uid()));

-- Stamp the hub. Events ride along because /communities is where events are
-- listed today; keeping the column separate leaves a dedicated events page free
-- to stamp only its own mark later.
create or replace function public.touch_community_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set communities_seen_at = now(),
         events_seen_at      = now()
   where id = auth.uid();
$$;

revoke all on function public.touch_community_seen() from public, anon;
grant execute on function public.touch_community_seen() to authenticated;

-- Stamp ONE space. No user parameter — scoped to auth.uid() — so it can only
-- ever mark the caller's own row.
create or replace function public.touch_community_space_seen(p_community uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.community_seen (user_id, community_id, seen_at)
  select auth.uid(), p_community, now()
   where auth.uid() is not null
  on conflict (user_id, community_id)
    do update set seen_at = now();
$$;

revoke all on function public.touch_community_space_seen(uuid) from public, anon;
grant execute on function public.touch_community_space_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. community_badge_count() — the whole badge in one round trip.
--
-- Same contract as chat_badge_count(): no parameters, identity from auth.uid()
-- only, returns a jsonb breakdown. The breakdown is returned rather than just
-- the sum because it is what makes the number debuggable in production — "why
-- does it say 4" is answerable without reconstructing six queries by hand. The
-- client sums it, so the dock and the RPC cannot drift on what counts.
--
-- SECURITY — definer, and it reads across other students' rows to do its
-- counting, so what it EXPOSES is the thing to check. It returns six integers.
-- No ids, no names, no bodies, no per-space breakdown. Every count is already
-- derivable by the caller through ordinary RLS-permitted reads: the review
-- queue is readable by managers (0119), approved communities and upcoming
-- events are readable by everyone, announcements are readable by followers. It
-- is definer for cost and for the inline manager check, not to widen reach.
--
-- `set search_path = public` pins resolution. EXECUTE is revoked from public
-- and anon and granted to `authenticated` only.
--
-- The epoch fallback (`coalesce(mark, 'epoch')`) means a student who has never
-- opened a surface sees everything currently live as new, which is the correct
-- first-run behaviour and matches how the events badge behaved in 0045.
-- ---------------------------------------------------------------------------
create or replace function public.community_badge_count()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      (select auth.uid()) as uid,
      coalesce(
        (select p.communities_seen_at from public.profiles p
          where p.id = (select auth.uid())),
        'epoch'::timestamptz
      ) as hub_seen,
      coalesce(
        (select p.events_seen_at from public.profiles p
          where p.id = (select auth.uid())),
        'epoch'::timestamptz
      ) as events_seen
  ),
  -- Spaces the caller manages, each with its own mark.
  --
  -- Driven from the caller's OWN rows — owned communities, owner/moderator
  -- memberships, society officer roles — rather than `where
  -- can_manage_community(c.id, uid)` over every approved community. The
  -- readable version scans the whole table and calls a definer function per
  -- row; this one is three index lookups on columns the caller appears in
  -- (communities_owner_idx, community_members_user_idx, society_roles).
  --
  -- It intentionally omits the `is_admin` branch that can_manage_community()
  -- has. An admin can manage every community, so including it would badge them
  -- for the entire platform's queues — that is the admin dashboard's job, not
  -- the student dock's.
  manageable as (
    select c.id from public.communities c
     where c.owner_id = (select uid from me) and c.status = 'approved'
    union
    select m.community_id from public.community_members m
     where m.user_id = (select uid from me)
       and m.role in ('owner', 'moderator')
    union
    select r.society_id from public.society_roles r
     where r.user_id = (select uid from me)
  ),
  managed as (
    select g.id,
           coalesce(
             (select s.seen_at from public.community_seen s
               where s.user_id = (select uid from me) and s.community_id = g.id),
             'epoch'::timestamptz
           ) as seen_at
      from manageable g
  ),
  -- Spaces the caller follows. Members follow implicitly: 0119 pins the row for
  -- owners and inserts it for approved joiners.
  followed as (
    select f.community_id as id,
           coalesce(
             (select s.seen_at from public.community_seen s
               where s.user_id = f.user_id and s.community_id = f.community_id),
             'epoch'::timestamptz
           ) as seen_at
      from public.community_followers f
     where f.user_id = (select uid from me)
  )
  select jsonb_build_object(
    'manage', (
      -- One item per COMMUNITY, however many things are queued inside it.
      select count(*) from managed g
       where exists (
               select 1 from public.community_join_requests r
                where r.community_id = g.id
                  and r.status = 'pending'
                  and r.created_at > g.seen_at
             )
          or exists (
               select 1 from public.posts p
                where p.community_id = g.id
                  and p.moderation_status = 'pending'
                  and p.author_id <> (select uid from me)
                  and p.created_at > g.seen_at
             )
    ),
    'joined', (
      select count(*) from public.community_members m
       where m.user_id = (select uid from me)
         -- Someone else let you in. A self-join leaves approved_by null and
         -- never badges: you were standing right there when it happened.
         and m.approved_by is not null
         and m.approved_by <> m.user_id
         and m.joined_at > (select hub_seen from me)
    ),
    'communities', (
      select count(*) from public.communities c
       where c.status = 'approved'
         and c.created_at > (select hub_seen from me)
         and c.owner_id <> (select uid from me)
         -- Discover team rooms are communities under the hood but are private
         -- to the team that formed them, and are never browsable in the hub.
         and coalesce(c.is_discover_group, false) = false
    ),
    'events', (
      select count(*) from public.events e
       where e.status = 'approved'
         and e.starts_at > now()
         and e.created_at > (select events_seen from me)
         and e.host_id <> (select uid from me)
    ),
    'broadcasts', (
      -- One item per SPACE, however many announcements it posted. This is the
      -- rule that stops a chatty society from rendering the badge meaningless.
      select count(*) from followed f
       where exists (
               select 1 from public.society_announcements a
                where a.society_id = f.id
                  and a.created_at > f.seen_at
                  and a.author_id <> (select uid from me)
             )
    ),
    'approvals', (
      select
        (select count(*) from public.communities c
          where c.owner_id = (select uid from me)
            and c.status = 'approved'
            and c.approved_at > (select hub_seen from me))
      + (select count(*) from public.events e
          where e.host_id = (select uid from me)
            and e.status = 'approved'
            and e.approved_at > (select events_seen from me))
    )
  );
$$;

comment on function public.community_badge_count() is
  'Grouped Community/Event/Broadcast items awaiting auth.uid(), as {"manage":n,"joined":n,"communities":n,"events":n,"broadcasts":n,"approvals":n}. Never counts community chat messages, and collapses many announcements from one space to one item. Definer, identity from auth.uid() only, authenticated-execute only. See migration 0170.';

revoke all on function public.community_badge_count() from public, anon;
grant execute on function public.community_badge_count() to authenticated;

-- Supporting indexes for the two per-space existence checks above.
create index if not exists posts_community_pending_idx
  on public.posts (community_id, moderation_status, created_at desc);
create index if not exists society_announcements_society_created_idx
  on public.society_announcements (society_id, created_at desc);

-- =============================================================================
-- VERIFY
--   select public.community_badge_count();
--   -- a chatty society must contribute exactly one broadcast item:
--   select count(*) from public.society_announcements where society_id = '<id>';
--   -- opening that space must clear it:
--   select public.touch_community_space_seen('<id>');
--   select public.community_badge_count();
--
-- ROLLBACK
--   drop function if exists public.community_badge_count();
--   drop function if exists public.touch_community_space_seen(uuid);
--   drop function if exists public.touch_community_seen();
--   drop table if exists public.community_seen;
--   alter table public.profiles drop column if exists communities_seen_at;
-- The application falls back to a zero badge when the RPC is absent
-- (src/lib/community/badge-count.ts), so the Community tab simply loses its
-- badge rather than breaking. `approved_at` and `approved_by` are additive and
-- safe to leave in place.
-- =============================================================================
