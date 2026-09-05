-- =============================================================================
-- 0183 — The Community dock badge becomes a list you can actually read.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
--
-- 0170's badge summed six DIFFERENT units of measurement:
--
--     manage       one per COMMUNITY that has work in it (two join requests in
--                  one space counted once)
--     joined       one per membership
--     communities  one per community created ANYWHERE on the platform
--     events       one per event created anywhere, relevant or not
--     broadcasts   one per SPACE that had posted (twenty announcements = 1)
--     approvals    one per approval of your own thing
--
-- so the number answered no single question. Worse, nothing rendered the items
-- behind it: the count was computed from timestamps, and "seen" was stamped by
-- merely OPENING /communities — which silenced whole categories the student had
-- not looked at, and could never be worked down deliberately. A student asking
-- "why does it say 4, and what do I do about it" had no way to find out.
--
-- ---------------------------------------------------------------------------
-- WHAT IT MEANS NOW
--
--     The Community badge is the number of concrete, unseen, relevant
--     Community updates waiting for this student.
--
-- One unit: an update. Every one of them is a row this student can open, read
-- and act on, and the badge is `count(*)` over exactly the rows the Updates
-- screen renders. If it says 6, six rows are waiting.
--
-- ---------------------------------------------------------------------------
-- WHY `notifications` IS THE CANONICAL SOURCE, AND NOT A NEW TABLE
--
-- The brief allows a purpose-built `community_updates` table. It is not needed,
-- and building one would have been the wrong call, because `notifications`
-- already provides — and has already had hardened — every property the model
-- requires:
--
--     stable id                    notifications.id
--     recipient from trusted code  create_notification() is SECURITY DEFINER,
--                                  takes the recipient from the emitting
--                                  trigger/RPC, and is revoked from every
--                                  client role (0178). There is no client path
--                                  that can address a row at another student.
--     type / created_at / read_at  columns, since 0014
--     per-user read state          read_at, with an RLS UPDATE policy scoped to
--                                  user_id = auth.uid()
--     destination                  data jsonb + notificationHref(), which is
--                                  already the app's one URL builder
--     stable subject refs          subject_post_id / subject_community_id /
--                                  subject_event_id … (0132, 0137)
--     deletion cleanup             notifications_live drops any row whose
--                                  subject has been deleted (0132/0137)
--     dedup                        the partial unique index on
--                                  (user_id, type, group_key) (0057)
--     RLS                          read and read-state write are both scoped to
--                                  the recipient (0014)
--
-- A second table would have had to reproduce all of it, and would then have to
-- be kept in step with the notification that fires for the same event — which
-- is precisely the "two independent unread records for one action" failure the
-- brief forbids. Reusing the table means the Community Updates screen and the
-- Activity panel are the SAME rows with the SAME read state: reading an item in
-- one is reading it in the other, and neither can count it twice.
--
-- What this migration adds is not storage. It is a DEFINITION — the view
-- `community_updates` — of which notifications are Community updates and when
-- one is still live. Both the badge and the list read that view, so they cannot
-- disagree.
--
-- ---------------------------------------------------------------------------
-- WHAT CREATES AN UPDATE (and what deliberately does not)
--
--   1. community_join_request      +1 per PENDING request, to each manager.
--   2. community_post_review       +1 per PENDING post, to each manager,
--                                  never to the author, actor nulled when the
--                                  post is anonymous (0118).
--   3. community_join_approved     the decision on YOUR request.
--      community_join_rejected     NEW here — 0170 notified only on approval,
--                                  so a rejected student was told nothing.
--   4. community_approved / community_rejected     your space's decision.
--   5. event_approved / event_rejected             your event's decision.
--   6. society_announcement        +1 per ANNOUNCEMENT (not per space), to
--                                  current followers and members only, never to
--                                  the author. A student who follows later gets
--                                  nothing for what was posted before: the
--                                  fan-out happens at post time, against the
--                                  follower list as it then was.
--   7. event_updated               NEW here — a material change (cancelled,
--                                  rescheduled, venue moved) to an event you
--                                  are attending or waitlisted for.
--   8. event_reminder              the 24h/1h reminder, already produced by the
--                                  `event-reminder-sweep` pg_cron job (0056).
--                                  Nothing here invents a request-time
--                                  reminder.
--
--   Also carried, because each is a decision about the reader inside a space:
--   community_post_approved / community_post_rejected, society_role /
--   society_role_removed, event_post_request, waitlist_promoted.
--
--   NEVER counted: community_message, event_message (chat — Chat has its own
--   badge), every new community or event on the platform, likes and reactions,
--   member-count drift, and anything the reader did themselves
--   (create_notification returns early when recipient = actor).
--
-- ---------------------------------------------------------------------------
-- LIVENESS — why the view, and not a cleanup job
--
-- Three of these can stop being real without anything writing to the
-- notification row:
--
--   * another manager approves the join request you were badged about;
--   * a pending post is approved before you look;
--   * you lose the officer role that made the queue yours at all.
--
-- A stored "resolved" flag would need every one of those paths to remember to
-- clear it, and the one that forgets leaves a student tapping a badge that
-- opens an empty queue. So liveness is DERIVED, in the view, from the subject
-- itself: a join-request update exists only while that request is pending AND
-- the reader can still manage that community. Nothing to keep in step, and it
-- is correct for paths that do not exist yet.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The domain, defined once.
-- ---------------------------------------------------------------------------
-- Mirrored in TypeScript by COMMUNITY_UPDATE_TYPES (src/lib/community/updates.ts),
-- which a test asserts against this list. Two copies, one of them is the
-- database's; the test is what keeps them honest.
create or replace function public.community_update_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    -- manager work
    'community_join_request',
    'community_post_review',
    'event_post_request',
    -- decisions about the reader
    'community_join_approved',
    'community_join_rejected',
    'community_approved',
    'community_rejected',
    'community_post_approved',
    'community_post_rejected',
    'society_role',
    'society_role_removed',
    -- spaces the reader follows or joined
    'society_announcement',
    -- events the reader owns or is going to
    'event_approved',
    'event_rejected',
    'event_updated',
    'event_reminder',
    'waitlist_promoted'
  ]::text[];
$$;

comment on function public.community_update_types() is
  'The notification types that are Community updates (the dock''s Community badge and the /communities/updates list). Chat surfaces and platform-wide creation events are deliberately absent. See migration 0183.';

grant execute on function public.community_update_types() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. community_join_rejected — the half of the decision nobody was told about.
-- ---------------------------------------------------------------------------
-- Carried in full from 0170 (which itself carried 0119) so the authorization
-- check, the pending check, the membership insert with `approved_by`, the
-- follow and the tombstone delete are all unchanged. The only additions are the
-- rejection notification and the `community_name` payload both branches now
-- carry, so the update can name the space without a second lookup.
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
  uid    uuid := auth.uid();
  v_name text;
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

  select c.name into v_name from public.communities c where c.id = p_community;

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
      jsonb_build_object('community_id', p_community, 'community_name', v_name)
    );
  else
    update public.community_join_requests
       set status = 'rejected', decided_at = now(), decided_by = uid
     where community_id = p_community and user_id = p_user;
    -- NEW (0183). A rejected student used to be told nothing at all — their
    -- request simply stayed on screen as "pending" forever.
    perform public.create_notification(
      p_user, uid, 'community_join_rejected', 'communities',
      jsonb_build_object('community_id', p_community, 'community_name', v_name)
    );
  end if;
end;
$$;

revoke all on function public.decide_community_join_request(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.decide_community_join_request(uuid, uuid, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. event_updated — a material change to an event you are going to.
-- ---------------------------------------------------------------------------
-- MATERIAL means the answer to "should I still show up, and where, and when"
-- changed: the event was cancelled, its start or end moved, or its venue
-- changed. A retitled event, a new cover image, an edited description or a
-- changed category are COSMETIC and produce nothing — an attendee does not need
-- to be pulled back to an event page because its blurb was tidied.
--
-- ONE EDIT = ONE UPDATE. This is a row-level AFTER UPDATE trigger, so a single
-- statement that moves the time AND the venue fires it once and sends one
-- notification per recipient. The `group_key` is the event id, which makes the
-- insert idempotent under the partial unique index from 0057: a retried write,
-- or a second edit before the reader has looked, updates the existing unread
-- row rather than stacking another one.
--
-- Recipients are attendees and waitlisters only — never "everyone who can see
-- the event" — and never the person doing the editing.
create or replace function public.notify_event_material_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_change  text;
  r         record;
begin
  -- An event that is not (and was not) live has no audience to disturb.
  if old.status <> 'approved' and new.status <> 'approved' then
    return null;
  end if;

  if old.status = 'approved' and new.status <> 'approved' then
    v_change := 'cancelled';
  elsif new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at then
    v_change := 'rescheduled';
  elsif new.location is distinct from old.location then
    v_change := 'venue';
  else
    -- Cosmetic: title, description, cover, category, attendee_count, …
    return null;
  end if;

  for r in
    select a.user_id from public.event_attendees a where a.event_id = new.id
    union
    select w.user_id from public.event_waitlist w where w.event_id = new.id
  loop
    if uid is null or r.user_id <> uid then
      perform public.create_notification(
        r.user_id, uid, 'event_updated', 'events',
        jsonb_build_object(
          'event_id', new.id,
          'title', new.title,
          'change', v_change
        ),
        -- Dedup key: one unread "this event changed" per event per reader.
        'event_updated:' || new.id::text
      );
    end if;
  end loop;

  return null;
end;
$$;

drop trigger if exists events_notify_material_update on public.events;
create trigger events_notify_material_update
  after update on public.events
  for each row execute function public.notify_event_material_update();

revoke all on function public.notify_event_material_update()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. community_updates — the canonical set, for BOTH the list and the badge.
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER, so the RLS policy on `notifications` ("users read their
-- notifications", user_id = auth.uid()) is what scopes it — exactly as
-- notifications_live does. Nothing here re-implements "only my own rows", so
-- there is nothing here that can get that wrong. A direct PostgREST select
-- against this view returns the caller's rows and no one else's.
--
-- Built ON notifications_live rather than on notifications, so the subject
-- cascade (a deleted community, event, post or announcement) already applies:
-- an update never outlives the thing it points at.
create or replace view public.community_updates
with (security_invoker = true)
as
select n.*
  from public.notifications_live n
 where n.type = any (public.community_update_types())
   -- Manager work is only work while it is BOTH unresolved and still yours.
   and (
     n.type <> 'community_join_request'
     or (
       exists (
         select 1 from public.community_join_requests r
          where r.community_id = n.subject_community_id
            and r.user_id = n.actor_id
            and r.status = 'pending'
       )
       and public.can_manage_community(n.subject_community_id, n.user_id)
     )
   )
   and (
     n.type <> 'community_post_review'
     or (
       exists (
         select 1 from public.posts p
          where p.id = n.subject_post_id
            and p.moderation_status = 'pending'
       )
       and public.can_manage_community(n.subject_community_id, n.user_id)
     )
   )
   -- A broadcast is only yours while you still follow or belong to the space.
   -- Leaving a society stops its announcements counting, without touching a row.
   and (
     n.type <> 'society_announcement'
     or exists (
       select 1 from public.community_followers f
        where f.community_id = n.subject_community_id and f.user_id = n.user_id
       union all
       select 1 from public.community_members m
        where m.community_id = n.subject_community_id and m.user_id = n.user_id
     )
   );

comment on view public.community_updates is
  'The canonical Community update set for auth.uid(): community-domain notifications that are still live and still actionable. The /communities/updates list and the dock badge both read THIS, so they cannot disagree. security_invoker, so RLS on notifications scopes it. See migration 0183.';

revoke all on public.community_updates from anon;
grant select on public.community_updates to authenticated;

-- ---------------------------------------------------------------------------
-- 5. community_badge_count() — same name, same call site, new meaning.
-- ---------------------------------------------------------------------------
-- The name is kept deliberately: home_bootstrap() (0174) COMPOSES this function
-- rather than reimplementing it, so replacing the body updates the shell's
-- badge with no change to that migration and no second definition to drift.
--
-- It becomes SECURITY INVOKER. 0170's version was definer because it counted
-- across other students' rows (every new community, every space's queue). This
-- one counts only the caller's own notification rows, so invoker is both
-- sufficient and safer: the scoping is the RLS policy, not a hand-written
-- predicate that could be got wrong.
--
-- The payload keeps a `total` key and adds `updates`. An OLD client deployed
-- against this database sums 0170's six keys, finds none, and renders NO badge
-- — which is the correct failure direction (a missing badge, never a wrong
-- one) and makes the deploy order irrelevant.
drop function if exists public.community_badge_count();
create function public.community_badge_count()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'updates', (select count(*) from public.community_updates u where u.read_at is null),
    'total',   (select count(*) from public.community_updates u where u.read_at is null)
  );
$$;

comment on function public.community_badge_count() is
  'Unread Community updates for auth.uid(), as {"updates":n,"total":n} — exactly the rows /communities/updates renders unread. Never counts chat. See migration 0183 (supersedes 0170''s six-part grouped count).';

revoke all on function public.community_badge_count() from public, anon;
grant execute on function public.community_badge_count() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Read semantics.
-- ---------------------------------------------------------------------------
-- Both are SECURITY INVOKER: the UPDATE policy on `notifications` already says
-- "your own rows only", so authorization is RLS and a forged id simply matches
-- no row. Both are idempotent (`read_at is null` guard) and safe to run
-- concurrently — the worst case is one of two racing statements updating zero
-- rows.
--
-- Note what is NOT here: nothing marks updates read on page open. Opening
-- /communities clears nothing at all, which is the behaviour 0170's
-- touch_community_seen() got wrong.
create or replace function public.mark_community_update_read(p_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = public
as $$
  with done as (
    update public.notifications
       set read_at = now()
     where id = p_id
       and user_id = (select auth.uid())
       and read_at is null
       and type = any (public.community_update_types())
    returning 1
  )
  select exists (select 1 from done);
$$;

create or replace function public.mark_community_updates_read()
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with done as (
    update public.notifications n
       set read_at = now()
     where n.user_id = (select auth.uid())
       and n.read_at is null
       and n.type = any (public.community_update_types())
       -- Only what the reader can actually SEE: an item hidden by the liveness
       -- rules above is not theirs to clear, and leaving it alone means it
       -- reappears correctly if, say, an officer role is restored.
       and exists (select 1 from public.community_updates u where u.id = n.id)
    returning 1
  )
  select count(*)::int from done;
$$;

revoke all on function public.mark_community_update_read(uuid) from public, anon;
revoke all on function public.mark_community_updates_read() from public, anon;
grant execute on function public.mark_community_update_read(uuid) to authenticated;
grant execute on function public.mark_community_updates_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Indexes for the two query shapes this adds.
-- ---------------------------------------------------------------------------
-- The count and the list are both "my unread rows, of these types, newest
-- first". The existing notifications_unread_idx is (user_id) where read_at is
-- null, which already narrows well; this adds the type and the ordering column
-- so the count is index-only and the list needs no sort.
create index if not exists notifications_community_unread_idx
  on public.notifications (user_id, type, created_at desc)
  where read_at is null;

-- The liveness checks probe these directly, one row at a time.
create index if not exists community_join_requests_user_status_idx
  on public.community_join_requests (community_id, user_id, status);
create index if not exists community_followers_user_community_idx
  on public.community_followers (user_id, community_id);

-- ---------------------------------------------------------------------------
-- 8. Realtime.
-- ---------------------------------------------------------------------------
-- 0176 removed `notifications` from the publication, and was right to: nothing
-- subscribed to it, so every insert was decoded from the WAL and evaluated
-- against every connected client's RLS in order to be delivered to nobody.
--
-- That premise no longer holds. <CommunityRealtime/> subscribes to it from the
-- student shell, and it is the ONE listener the Community badge has — one
-- subscription, not one per update type, per community or per row.
--
-- The cost is real and is accepted knowingly: `notifications` is a busy table,
-- and this reinstates per-subscriber RLS evaluation on its writes. 0176's own
-- measurements bound it — the per-subscriber term is ~5% of realtime.apply_rls,
-- the rest being a fixed poll that runs with nobody connected — so one more
-- subscribed table is a small fraction of that 5%, in exchange for the badge
-- being live at all. If that ratio ever changes, the lever is this line.
--
-- RLS still applies to delivery, so a student's socket only ever receives their
-- own notification rows.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Transition. No backfill, and a deliberate quieting.
-- ---------------------------------------------------------------------------
-- Nothing is inserted. Every update this model counts already exists as a
-- notification, so a backfill would be a duplicate of history.
--
-- The risk runs the other way: a student who has never opened the Activity
-- panel may hold months of unread community-domain notifications, and would
-- meet the new badge reading "9+" with no way to tell what was new. So
-- everything informational and already-in-the-past is marked read at deploy —
-- once, here — leaving only work that is genuinely still WAITING:
--
--     kept unread   community_join_request, community_post_review
--                   (both re-checked for liveness by the view, so only queues
--                    that are still pending and still the reader's survive)
--     marked read   every other community type
--
-- This shares read state with the Activity panel by design (they are the same
-- rows), so it also clears those rows' unread highlight there. That is the
-- intended consequence of one record per event: /activity auto-marks everything
-- read on open anyway, so for any student who has ever opened it this is a
-- no-op.
update public.notifications
   set read_at = now()
 where read_at is null
   and type = any (public.community_update_types())
   and type not in ('community_join_request', 'community_post_review');

-- ---------------------------------------------------------------------------
-- 10. The retired seen model.
-- ---------------------------------------------------------------------------
-- `profiles.communities_seen_at`, `profiles.events_seen_at`, the
-- `community_seen` table and touch_community_seen() /
-- touch_community_space_seen() / touch_events_seen() exist only to serve 0170's
-- timestamp badge. Nothing in the application calls them after this change (the
-- three call sites in src/ are removed in the same commit).
--
-- They are NOT dropped here. This is a forward-only migration against a live
-- database, and dropping a table plus two profile columns in the same deploy
-- that changes the badge means a rollback of the app cannot restore the old
-- badge. They are inert — no trigger writes them, no query reads them — and a
-- follow-up migration can drop them once this has been live long enough to be
-- sure. Marked so the next reader knows they are dead weight, not a feature.
comment on table public.community_seen is
  'DEAD as of migration 0183: the Community badge no longer uses a seen-timestamp model. Retained only so 0170 can be rolled back to; safe to drop in a later migration.';
comment on column public.profiles.communities_seen_at is
  'DEAD as of migration 0183 (see community_seen).';

-- =============================================================================
-- VERIFY
--   select public.community_badge_count();
--   select count(*) from public.community_updates where read_at is null;
--   -- must be equal, always: the badge IS the list.
--
--   -- two pending requests in one community are two updates, not one:
--   select type, count(*) from public.community_updates
--    where read_at is null group by 1;
--
--   supabase/tests/community_updates.sql exercises the whole set.
--
-- ROLLBACK
--   Re-run 0170_community_badge.sql (it recreates community_badge_count with
--   the grouped payload), then:
--     drop view if exists public.community_updates;
--     drop function if exists public.mark_community_updates_read();
--     drop function if exists public.mark_community_update_read(uuid);
--     drop function if exists public.community_update_types();
--     drop trigger if exists events_notify_material_update on public.events;
--     drop function if exists public.notify_event_material_update();
--     alter publication supabase_realtime drop table public.notifications;
--   Read state cleared by section 9 is not recoverable, which is the one
--   irreversible part of this migration and is why it is bounded to
--   informational types.
-- =============================================================================
