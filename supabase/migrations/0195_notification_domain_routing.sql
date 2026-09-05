-- =============================================================================
-- 0195 — fix: direct messages are Chat, not Community.
--
-- WHAT WENT WRONG
-- Migration 0192 turned Community → Updates into "the inbox for everything that
-- happens inside a space" and, in the same stroke, put the DIRECT MESSAGE
-- family into `community_update_types()`:
--
--     'message', 'message_request', 'message_request_accepted',
--     'message_reaction'
--
-- Those four types have nothing to do with a community. A one-to-one chat is a
-- Chat conversation; it already has a dock badge (`chat_badge_count()`, derived
-- from `messages.read_at`), a per-conversation unread count, and a Requests
-- surface. Routing their NOTIFICATION rows into Updates put private chat
-- traffic on a community screen and, worse, into the Community dock badge: five
-- unread DMs and three unread community updates rendered as 8.
--
-- The mistake was in the type LIST, not in the routing machinery — 0192's own
-- insight (that a `post_like` belongs to whichever surface its SUBJECT belongs
-- to) was right and is kept. This migration removes the DM family from the
-- community list and gives the domain rule a third answer instead of folding
-- chat into one of the other two.
--
-- ---------------------------------------------------------------------------
-- THE DOMAIN RULE NOW HAS FOUR ANSWERS, AND A CONVERSATION SUBJECT
--
--   'community_updates'      → Community → Updates
--   'chat'                   → Chat (DMs, requests, reactions)
--   'general_notifications'  → the Notifications page and the bell
--   'system'                 → delivered as a cold-open modal, never a list row
--
-- and the function takes `p_conversation` as a fourth argument, because the
-- brief's rule is about the SUBJECT rather than the word "message":
--
--   * a conversation subject, with no community/event subject  → chat
--   * a community/society subject, or a community chat message → community
--   * an event subject with event discussion                   → community
--
-- The type lists stay authoritative for the types we already emit; the
-- conversation-subject clause is what catches anything future that reuses a
-- generic type inside a Chat conversation. Nothing routes on a URL or on
-- display copy.
--
-- The three-argument `notification_domain(text, uuid, uuid)` is DROPPED at the
-- end, after both views stop referring to it, so no caller can accidentally
-- keep asking the version that cannot see a conversation.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT CHANGED
--
--  * DM notification rows are NOT deleted. They keep their history and simply
--    stop being claimed by Community.
--  * `notify_message`'s conversation `group_key` (added by 0192) is KEPT. It is
--    correct on its own terms — one thread is one row — and reverting it would
--    churn rows for no gain.
--  * Chat's unread model is untouched: it has always been `messages.read_at`
--    and `message_requests.status`, never notification rows, so nothing 0192
--    did to notification read state could have moved the Chat badge.
--
-- WHAT CANNOT BE UNDONE, stated plainly: 0192 section 8 marked every unread row
-- newly joining Updates as read, DM notification rows included. That timestamp
-- is not recoverable and this migration does not fabricate one. It cost
-- nothing a user can see — those rows are not rendered on any surface, and the
-- Chat badge never read them.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The Chat family, named once.
-- ---------------------------------------------------------------------------
create or replace function public.chat_notification_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'message',
    'message_request',
    'message_request_accepted',
    'message_reaction'
  ]::text[];
$$;

comment on function public.chat_notification_types() is
  'Notification types whose subject is a private Chat conversation. They belong to Chat and must never appear in Community Updates or in the Community badge. See migration 0195.';

grant execute on function public.chat_notification_types() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The community list, with the DM family removed.
-- ---------------------------------------------------------------------------
-- Community-domain CONVERSATION stays: a community chat room, an event
-- discussion and a society broadcast are group conversations inside a space,
-- and they are Community even though their UI resembles chat.
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
    -- conversation inside a space (NOT chat: these live on the room, the
    -- society and the event, and raise no Chat badge)
    'community_message',
    'event_message',
    -- events the reader hosts or is going to
    'event_approved',
    'event_rejected',
    'event_updated',
    'event_reminder',
    'waitlist_promoted',
    'event_organizer_added',
    'event_organizer_removed'
  ]::text[];
$$;

comment on function public.community_update_types() is
  'Notification types that ALWAYS belong to Community Updates. Generic social types (post_like, comment, comment_reply, mention) belong there too when they carry a space subject — see notification_domain(). The direct-message family was removed here; it belongs to Chat. See migrations 0192 and 0195.';

grant execute on function public.community_update_types() to authenticated;

-- The generic social types, unchanged from 0192: EITHER surface, by subject.
create or replace function public.social_notification_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['post_like', 'comment_like', 'comment', 'comment_reply', 'mention']::text[];
$$;

grant execute on function public.social_notification_types() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE ROUTING RULE, with chat as a first-class answer.
-- ---------------------------------------------------------------------------
create or replace function public.notification_domain(
  p_type         text,
  p_community    uuid,
  p_event        uuid,
  p_conversation uuid
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    -- Admin broadcasts are a cold-open modal, not a row in any list.
    when p_type = 'announcement' then 'system'

    -- Chat, by type. Checked BEFORE the community list so the two can never
    -- both claim a row even if a future edit puts a type in both.
    when p_type = any (public.chat_notification_types()) then 'chat'

    -- Community, by type: space lifecycle, space conversation, events.
    when p_type = any (public.community_update_types()) then 'community_updates'

    -- Community, by subject: a like/comment/reply/mention inside a space.
    when p_type = any (public.social_notification_types())
         and (p_community is not null or p_event is not null)
      then 'community_updates'

    -- Chat, by subject. The future-proofing clause: anything that names a
    -- Chat conversation and no space is Chat, whatever its type is called.
    -- Ordered last among the positives so a space-scoped row that also
    -- happens to carry a conversation id still routes to Community.
    when p_conversation is not null
         and p_community is null and p_event is null
      then 'chat'

    else 'general_notifications'
  end;
$$;

comment on function public.notification_domain(text, uuid, uuid, uuid) is
  'Which surface owns a notification: community_updates | chat | general_notifications | system. Type alone is insufficient in both directions — a community post like and a feed post like share the type post_like, and a type containing the word "message" may be a DM or a community room post — so the SUBJECT decides. See migration 0195.';

grant execute on function public.notification_domain(text, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Liveness for Community Updates — DM branch removed.
-- ---------------------------------------------------------------------------
-- Signature is UNCHANGED (six arguments, p_conversation still accepted) so no
-- view or caller has to be re-pointed at a different arity. The DM branch is
-- gone because no DM row can reach this function any more; leaving it would be
-- dead code that reads as if Updates still carried conversations.
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
  'Is this COMMUNITY notification still live and still accessible to auth.uid()? Definer because it reads tables (posts, memberships) a student cannot select; takes no user parameter and returns only a boolean. The direct-message branch was removed in 0195 — DMs are no longer a Community domain. See migrations 0184, 0192 and 0195.';

revoke all on function public.notification_in_community_updates(text, uuid, uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.notification_in_community_updates(text, uuid, uuid, uuid, uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The surfaces, each one domain of the same rule.
-- ---------------------------------------------------------------------------
-- `with (security_invoker = true)` IS LOAD-BEARING on every view here: without
-- it the view runs as its owner and RLS on `notifications` stops scoping it,
-- so every student could read every other student's inbox. 0194 lost this by
-- accident once. The ALTERs below assert it independently of the CREATE.

create or replace view public.community_updates
with (security_invoker = true)
as
select n.*
  from public.notifications_live n
 where public.notification_domain(
         n.type, n.subject_community_id, n.subject_event_id, n.subject_conversation_id
       ) = 'community_updates'
   and public.notification_in_community_updates(
         n.type, n.actor_id, n.subject_community_id, n.subject_event_id,
         n.subject_post_id, n.subject_conversation_id);

alter view public.community_updates set (security_invoker = true);

comment on view public.community_updates is
  'The canonical Community Updates set for auth.uid(): notifications whose domain is community_updates, still live and still accessible. Direct messages and group DMs are NOT here — they are domain chat. The /communities/updates list and the dock badge both read THIS, so one unread row is exactly one badge point. See migrations 0192 and 0195.';

revoke all on public.community_updates from anon;
grant select on public.community_updates to authenticated;

create or replace view public.activity_notifications
with (security_invoker = true)
as
select n.*
  from public.notifications_live n
 where public.notification_domain(
         n.type, n.subject_community_id, n.subject_event_id, n.subject_conversation_id
       ) = 'general_notifications';

alter view public.activity_notifications set (security_invoker = true);

comment on view public.activity_notifications is
  'The general Notifications surface: platform-level activity only — feed social activity, Discover/matching, Campus Help, Aura and badges, moderation. Community-scoped rows belong to community_updates and chat rows to chat_notifications; neither is duplicated here. See migrations 0192 and 0195.';

revoke all on public.activity_notifications from anon;
grant select on public.activity_notifications to authenticated;

-- New, and mostly for verification: Chat renders from `messages` and
-- `message_requests`, not from notification rows. Naming the set makes the
-- separation assertable ("no row is on two surfaces") instead of implicit.
create or replace view public.chat_notifications
with (security_invoker = true)
as
select n.*
  from public.notifications_live n
 where public.notification_domain(
         n.type, n.subject_community_id, n.subject_event_id, n.subject_conversation_id
       ) = 'chat';

alter view public.chat_notifications set (security_invoker = true);

comment on view public.chat_notifications is
  'Notification rows whose subject is a private Chat conversation: DMs, DM requests and accepts, DM reactions. Chat itself renders from messages/message_requests and its badge comes from chat_badge_count(); this view exists so the domain split is assertable and so nothing else has to re-derive "is this a DM". See migration 0195.';

revoke all on public.chat_notifications from anon;
grant select on public.chat_notifications to authenticated;

-- The 3-argument rule cannot see a conversation and must not survive as a
-- second, wrong answer. Safe to drop now that both views ask the 4-arg one.
drop function if exists public.notification_domain(text, uuid, uuid);

-- ---------------------------------------------------------------------------
-- 6. The Community badge counts the view, and nothing else.
-- ---------------------------------------------------------------------------
-- Unchanged in body from 0192 — it was never the problem — but re-stated so
-- the guarantee reads correctly next to the corrected view.
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

comment on function public.community_badge_count() is
  'Unread Community Updates for auth.uid(). Exactly count(*) over community_updates where read_at is null — the same rows /communities/updates renders. Direct-message activity contributes zero. See migration 0195.';

revoke all on function public.community_badge_count() from public, anon;
grant execute on function public.community_badge_count() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Read RPCs stay bounded to their own surface.
-- ---------------------------------------------------------------------------
-- Both already test membership of the `community_updates` VIEW, so with DMs out
-- of the view they can no longer touch a DM row. Re-stated verbatim so the
-- corrected definition is the one this file's ROLLBACK note refers to.
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

comment on function public.mark_community_updates_read() is
  'Mark-all for Community Updates. Bounded by membership of the community_updates view, so it cannot clear a chat or a general-notification row. See migration 0195.';

revoke all on function public.mark_community_update_read(uuid) from public, anon;
revoke all on function public.mark_community_updates_read() from public, anon;
grant execute on function public.mark_community_update_read(uuid) to authenticated;
grant execute on function public.mark_community_updates_read() to authenticated;

-- The Notifications page's auto-mark-read was the LAST unscoped read action:
-- 0014 defined it as "every unread row of mine", so opening the bell's page
-- silently cleared the Community badge and every chat row too. Scope it to its
-- own domain. Announcements (domain `system`) are likewise left alone — they
-- are dismissed by the cold-open modal, which owns their read_at.
create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications n
     set read_at = now()
   where n.user_id = (select auth.uid())
     and n.read_at is null
     and public.notification_domain(
           n.type, n.subject_community_id, n.subject_event_id, n.subject_conversation_id
         ) = 'general_notifications';
$$;

comment on function public.mark_notifications_read() is
  'Mark-all for the general Notifications page. Scoped to domain general_notifications since 0195: it must not clear Community Updates, chat rows, or an undismissed announcement.';

revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The Activity bell counts its own domain.
-- ---------------------------------------------------------------------------
-- Same shape as 0192; the only change is that `activity_notifications` no
-- longer contains chat rows, so `activity_unread` cannot pick them up now that
-- they have left the community domain. `p_activity_types` remains accepted and
-- ignored — a deployed client still passes it.
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
    'activity_unread', (
      select count(*)
        from public.activity_notifications n
       where n.read_at is null
         and n.type <> 'announcement')
  );
$$;

revoke all on function public.home_bootstrap(text[]) from public, anon;
grant execute on function public.home_bootstrap(text[]) to authenticated;

-- =============================================================================
-- VERIFY
--   -- the three surfaces must PARTITION notifications_live, never overlap:
--   select count(*) from public.community_updates u
--     join public.chat_notifications c on c.id = u.id;              -- 0
--   select count(*) from public.community_updates u
--     join public.activity_notifications a on a.id = u.id;          -- 0
--   select count(*) from public.chat_notifications c
--     join public.activity_notifications a on a.id = c.id;          -- 0
--
--   -- no DM type can be in the community list:
--   select public.community_update_types() && public.chat_notification_types();
--   -- must be false.
--
--   -- badge == rendered unread rows, always:
--   select (public.community_badge_count() ->> 'updates')::int,
--          (select count(*) from public.community_updates where read_at is null);
--
--   supabase/tests/notification_domain_routing.sql exercises the whole split.
--
-- ROLLBACK
--   Re-run 0192 in full. That restores the DM family to Community Updates and
--   the unscoped mark_notifications_read(), and re-creates the 3-argument
--   notification_domain(); drop chat_notifications and
--   chat_notification_types() afterwards.
-- =============================================================================
