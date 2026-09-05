-- =============================================================================
-- 0192 — Community → Updates becomes the inbox for everything that happens
--        inside a space, and the general Notifications page stops carrying it.
--
-- WHAT CHANGES
-- 0183/0184 made Updates the home for space DECISIONS (join requests,
-- approvals, announcements, role changes). This widens it to the whole life of
-- a space — room messages, event discussion, community posts, and the likes,
-- comments, replies and mentions that happen ON those posts — plus direct
-- messages, which the product brief asks for explicitly.
--
-- The general Notifications page keeps exactly the complement: social activity
-- on ORDINARY feed posts, Discover/matching, Campus Help, Aura and badges,
-- moderation and appeals. Nothing is deleted to achieve that; the rows are
-- ROUTED, and every one of them still exists on whichever surface owns it.
--
-- ---------------------------------------------------------------------------
-- THE HARD PART: TYPE IS NOT ENOUGH
--
-- A like on a community post and a like on a feed post are both `post_like`.
-- Routing by type alone would either drag every feed like into Updates or
-- leave community likes stranded in Notifications. The discriminator is the
-- SUBJECT: `notifications.subject_community_id` / `subject_event_id`, which
-- migration 0132's trigger already populates from the payload's community_id /
-- society_id / event_id. So a generic social type belongs to Updates exactly
-- when it carries a space subject, and to Notifications otherwise.
--
-- That rule lives in ONE function, `notification_domain()`, and both surfaces
-- ask it. There is no second list to drift.
--
-- ---------------------------------------------------------------------------
-- ONE UNREAD ROW = ONE BADGE POINT
--
-- The badge counts rows of `community_updates`; the page renders rows of
-- `community_updates`. They cannot disagree because they are the same set.
-- What makes that survivable in a busy room is GROUPING, which the partial
-- unique index on (user_id, type, group_key) has enforced since 0057:
--
--     community_message   group_key `community:<id>`   already grouped
--     event_message       group_key `event:<id>`       already grouped
--     society_announcement `society_announcement:<id>` already grouped
--     message (DM)        group_key `conversation:<id>`  ADDED HERE
--
-- Direct messages were the gap: 5,798 ungrouped rows in production. Routed to
-- Updates as-is, one busy conversation would have contributed one badge point
-- per message. notify_message now groups by conversation, so a thread is one
-- row that keeps the newest sender and carries a count — and once read, the
-- next message opens a fresh unread row, because the unique index only covers
-- rows where read_at is null.
--
-- ---------------------------------------------------------------------------
-- TRANSITION: NOBODY WAKES UP TO A HUGE BADGE
--
-- The types joining Updates already have months of history — thousands of DM
-- and room-message rows, many still unread because they were never rendered
-- anywhere. Routing them without care would hand active users a badge in the
-- hundreds on deploy.
--
-- So every EXISTING unread row that is newly joining Updates is marked read at
-- deploy, with one deliberate exception: rows that represent WORK STILL OWED —
-- join requests, post reviews and event post requests — which 0183 already
-- kept and which the liveness rules re-check anyway. Everything from before
-- this migration starts clean; everything after it behaves normally.
--
-- This shares read state with the Notifications page by design (they are the
-- same rows), so it also clears those rows' unread highlight there. For any
-- user who has ever opened /activity that is a no-op — it auto-marks all read.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The domain rule, once.
-- ---------------------------------------------------------------------------
-- Types that belong to Updates WHATEVER their subject. Extends 0183's list
-- with the conversation surfaces, community posts, and the DM family the brief
-- asks for.
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
    'community_post',
    -- conversation inside a space
    'community_message',
    'event_message',
    -- events the reader hosts or is going to
    'event_approved',
    'event_rejected',
    'event_updated',
    'event_reminder',
    'waitlist_promoted',
    'event_organizer_added',
    'event_organizer_removed',
    -- direct messages (explicit product decision, see the header)
    'message',
    'message_request',
    'message_request_accepted',
    'message_reaction'
  ]::text[];
$$;

comment on function public.community_update_types() is
  'Notification types that ALWAYS belong to Community Updates. Generic social types (post_like, comment, comment_reply, mention) belong there too when they carry a space subject — see notification_domain(). See migration 0192.';

grant execute on function public.community_update_types() to authenticated;

-- The generic social types, which live in EITHER surface depending on subject.
create or replace function public.social_notification_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['post_like', 'comment_like', 'comment', 'comment_reply', 'mention']::text[];
$$;

grant execute on function public.social_notification_types() to authenticated;

-- THE ROUTING RULE. 'community' -> Community Updates. 'activity' -> the
-- general Notifications page. Every surface asks this and nothing re-derives
-- it, so the two can never both claim a row or both drop one.
create or replace function public.notification_domain(
  p_type      text,
  p_community uuid,
  p_event     uuid
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_type = any (public.community_update_types()) then 'community'
    -- A like/comment/reply/mention that happened inside a space.
    when p_type = any (public.social_notification_types())
         and (p_community is not null or p_event is not null) then 'community'
    else 'activity'
  end;
$$;

comment on function public.notification_domain(text, uuid, uuid) is
  'Which in-app surface owns a notification: community (Updates) or activity (Notifications). Type alone is insufficient — a community post like and a feed post like share the type post_like — so the space subject decides. See migration 0192.';

grant execute on function public.notification_domain(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Liveness / accessibility for everything now in Updates.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the reason 0184 exists: the view that calls this is
-- security_invoker (so RLS on `notifications` scopes the rows), and invoker
-- applies to every table a view touches. Several checks below read tables a
-- student cannot select — `posts` most importantly — and an invoker predicate
-- would raise 42501 for every row, killing the whole surface. Only the
-- liveness probe is elevated; row ownership is still RLS's job.
--
-- It takes NO user parameter: auth.uid() is read here, so it cannot be asked
-- "can someone else see this space".
create or replace function public.notification_in_community_updates(
  p_type         text,
  p_actor        uuid,
  p_community    uuid,
  p_event        uuid,
  p_post         uuid,
  p_conversation uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- ---- Manager work: unresolved AND still the caller's to act on. -------
    when p_type = 'community_join_request' then
      exists (select 1 from public.community_join_requests r
               where r.community_id = p_community and r.user_id = p_actor
                 and r.status = 'pending')
      and public.can_manage_community(p_community, (select auth.uid()))
    when p_type = 'community_post_review' then
      exists (select 1 from public.posts p
               where p.id = p_post and p.moderation_status = 'pending')
      and public.can_manage_community(p_community, (select auth.uid()))

    -- ---- Space conversation and content: still a member/follower. --------
    -- Leaving a space stops its traffic counting, without touching a row.
    when p_type in ('society_announcement', 'community_message', 'community_post') then
      exists (select 1 from public.community_followers f
               where f.community_id = p_community and f.user_id = (select auth.uid()))
      or exists (select 1 from public.community_members m
               where m.community_id = p_community and m.user_id = (select auth.uid()))

    -- ---- Event discussion: still going, or running it. -------------------
    when p_type = 'event_message' then
      exists (select 1 from public.event_attendees a
               where a.event_id = p_event and a.user_id = (select auth.uid()))
      or public.is_event_organizer(p_event, (select auth.uid()))

    -- ---- Direct messages: the channel must still be open. ----------------
    -- A conversation closed by an unmatch (0182) is not somewhere the reader
    -- can act, so its notifications stop counting.
    when p_type in ('message', 'message_reaction') then
      p_conversation is null
      or exists (select 1 from public.conversations c
                  where c.id = p_conversation and c.closed_at is null)

    -- ---- Space-scoped social activity: the space must still be readable. --
    when p_type = any (public.social_notification_types()) then
      (p_community is null
        or exists (select 1 from public.community_followers f
                    where f.community_id = p_community and f.user_id = (select auth.uid()))
        or exists (select 1 from public.community_members m
                    where m.community_id = p_community and m.user_id = (select auth.uid())))
      and (p_event is null
        or exists (select 1 from public.event_attendees a
                    where a.event_id = p_event and a.user_id = (select auth.uid()))
        or public.is_event_organizer(p_event, (select auth.uid())))

    -- Decisions and facts about the reader: live while their subject exists,
    -- which notifications_live already enforces.
    else true
  end;
$$;

comment on function public.notification_in_community_updates(text, uuid, uuid, uuid, uuid, uuid) is
  'Is this notification still live and still accessible to auth.uid()? Definer because it reads tables (posts, memberships) a student cannot select; takes no user parameter and returns only a boolean. See migrations 0184 and 0192.';

revoke all on function public.notification_in_community_updates(text, uuid, uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.notification_in_community_updates(text, uuid, uuid, uuid, uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The two surfaces, defined as complements of one rule.
-- ---------------------------------------------------------------------------
create or replace view public.community_updates
with (security_invoker = true)
as
select n.*
  from public.notifications_live n
 where public.notification_domain(n.type, n.subject_community_id, n.subject_event_id) = 'community'
   and public.notification_in_community_updates(
         n.type, n.actor_id, n.subject_community_id, n.subject_event_id,
         n.subject_post_id, n.subject_conversation_id);

comment on view public.community_updates is
  'The canonical Community Updates set for auth.uid(): every notification whose domain is `community`, still live and still accessible. The /communities/updates list and the dock badge both read THIS, so one unread row is exactly one badge point. security_invoker; RLS on notifications scopes the rows. See migration 0192.';

revoke all on public.community_updates from anon;
grant select on public.community_updates to authenticated;

-- The complement. The Notifications page reads this instead of filtering
-- notifications_live by a type list, because a type list cannot tell a
-- community post like from a feed post like.
create or replace view public.activity_notifications
with (security_invoker = true)
as
select n.*
  from public.notifications_live n
 where public.notification_domain(n.type, n.subject_community_id, n.subject_event_id) = 'activity';

comment on view public.activity_notifications is
  'The general Notifications surface: everything whose domain is NOT community — feed social activity, Discover, Campus Help, Aura, moderation. The exact complement of community_updates over notifications_live. See migration 0192.';

revoke all on public.activity_notifications from anon;
grant select on public.activity_notifications to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The badge, and the read RPCs, follow the view rather than a type list.
-- ---------------------------------------------------------------------------
create or replace function public.community_badge_count()
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

revoke all on function public.community_badge_count() from public, anon;
grant execute on function public.community_badge_count() to authenticated;

-- Membership of the VIEW is now the test, not `type = any(...)`: a
-- community-scoped post_like is an update even though its type is not in the
-- always-community list.
create or replace function public.mark_community_update_read(p_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = public
as $$
  with done as (
    update public.notifications n
       set read_at = now()
     where n.id = p_id
       and n.user_id = (select auth.uid())
       and n.read_at is null
       and exists (select 1 from public.community_updates u where u.id = n.id)
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
-- 5. The Activity bell counts the complement.
-- ---------------------------------------------------------------------------
-- home_bootstrap kept a `p_activity_types` parameter and filtered
-- notifications_live by it. That cannot express "feed likes but not community
-- likes", so the count now comes from activity_notifications. The parameter is
-- KEPT in the signature — a deployed client still passes it — but is no longer
-- used for the count. Dropping it would break every client mid-deploy.
create or replace function public.home_bootstrap(p_activity_types text[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'chat',      public.chat_badge_count(),
    'community', public.community_badge_count(),
    'announcements', coalesce(
      (select jsonb_agg(a order by a.created_at desc)
         from (
           select n.id, n.data, n.created_at
             from public.notifications n
            where n.user_id = (select auth.uid())
              and n.type = 'announcement'
              and n.read_at is null
            order by n.created_at desc
            limit 5
         ) a),
      '[]'::jsonb),
    -- The complement of Community Updates, so the bell and the dock badge can
    -- never both count the same row. p_activity_types is accepted and ignored.
    'activity_unread', (
      select count(*)
        from public.activity_notifications n
       where n.read_at is null
         and n.type <> 'announcement')
  );
$$;

revoke all on function public.home_bootstrap(text[]) from public, anon;
grant execute on function public.home_bootstrap(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Group direct messages by conversation.
-- ---------------------------------------------------------------------------
-- The one surface that was not grouped. Carried forward verbatim with a group
-- key added, so a thread is ONE unread row carrying the newest sender, and a
-- busy conversation is one badge point instead of forty.
create or replace function public.notify_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other uuid;
begin
  select case when c.user_low = new.sender_id then c.user_high else c.user_low end
    into other
  from public.conversations c where c.id = new.conversation_id;

  perform public.create_notification(
    other, new.sender_id, 'message', 'messages',
    jsonb_build_object('conversation_id', new.conversation_id),
    'conversation:' || new.conversation_id::text
  );
  return null;
end;
$$;

revoke all on function public.notify_message() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Indexes for the two new query shapes.
-- ---------------------------------------------------------------------------
-- Both surfaces ask "my unread rows, newest first" and then narrow by domain,
-- which is a function call and therefore not indexable. The existing partial
-- index on (user_id, type, created_at desc) where read_at is null already
-- serves the narrowing; these help the subject probes the domain rule makes.
create index if not exists notifications_subject_event_user_idx
  on public.notifications (subject_event_id, user_id)
  where subject_event_id is not null;
create index if not exists notifications_unread_user_created_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- 8. Transition — see the header. Bounded, one-off, and documented.
-- ---------------------------------------------------------------------------
-- Everything newly joining Updates that is ALREADY unread is marked read, so
-- no user meets this deploy with a badge full of history. Work still owed is
-- deliberately spared.
update public.notifications n
   set read_at = now()
 where n.read_at is null
   and public.notification_domain(n.type, n.subject_community_id, n.subject_event_id) = 'community'
   and n.type not in ('community_join_request', 'community_post_review', 'event_post_request');

-- =============================================================================
-- VERIFY
--   select public.community_badge_count();
--   select count(*) from public.community_updates where read_at is null;
--   -- must be equal, always.
--
--   -- the two surfaces must partition notifications_live, never overlap:
--   select count(*) from public.community_updates u
--     join public.activity_notifications a on a.id = u.id;   -- must be 0
--
--   supabase/tests/community_updates_inbox.sql exercises the whole routing.
--
-- ROLLBACK
--   Re-run 0183's community_update_types(), 0184's community_updates view and
--   community_update_is_live(), 0174's home_bootstrap and 0183's read RPCs,
--   then drop activity_notifications, notification_domain,
--   social_notification_types and notification_in_community_updates, and
--   restore notify_message without its group key. Read state cleared by
--   section 8 is not recoverable.
-- =============================================================================
