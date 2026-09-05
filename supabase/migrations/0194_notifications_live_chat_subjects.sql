-- =============================================================================
-- 0194 — fix: community and event chat notifications were invisible everywhere.
--
-- WHAT WAS BROKEN, and for how long
-- `notifications_live` (0132, extended by 0137) drops any row whose payload
-- names a subject that no longer resolves. One of those clauses is
--
--     not (data ? 'message_id') or subject_message_id is not null
--
-- and `subject_message_id` is populated by 0132's linker from
--
--     select m.id from public.messages m where m.id = data->>'message_id'
--
-- `public.messages` is the DIRECT-MESSAGE table. But `community_message` and
-- `event_message` notifications also carry a `message_id`, and theirs points at
-- `community_chat_messages` / `event_messages`. That lookup never matches, so
-- `subject_message_id` stays NULL and the view discards the row.
--
-- Measured on production: 486 of 486 `community_message` notifications are
-- filtered out. Every one. They have never been renderable — not on the
-- Activity page (which reads this view), and not by migration 0192's Updates
-- inbox either, which is how this finally surfaced: 0192 routes room messages
-- to Updates, and its own verification found the inbox empty.
--
-- ---------------------------------------------------------------------------
-- THE FIX
-- The `message_id` requirement is scoped to the types where `message_id`
-- actually means a DM. For a room or event message the payload's OTHER subject
-- — `community_id` / `event_id` — is the one that matters, and those clauses
-- are unchanged and still enforced above, so a deleted community still removes
-- its notifications.
--
-- WHAT THIS GIVES UP, stated plainly: deleting a single community chat MESSAGE
-- no longer removes a notification that points at it. It cannot, because
-- nothing links the two — that is the same missing link this migration is
-- working around rather than adding. The exposure is small and bounded: those
-- notifications are grouped one-per-room (0168), they route to the room rather
-- than to the message, and the room's own membership and existence checks still
-- gate them. Adding a real `subject_community_message_id` column plus linker
-- and cascade would close it properly and is the right follow-up; it is not
-- something to bundle into a routing fix.
--
-- Everything else in the view is carried forward VERBATIM from the deployed
-- definition, fetched with pg_get_viewdef rather than copied from 0132/0137 —
-- the file that defines an object is not reliably the one running.
-- =============================================================================

-- `with (security_invoker = true)` IS LOAD-BEARING AND MUST NOT BE OMITTED.
-- CREATE OR REPLACE VIEW resets reloptions: replacing this view without the
-- clause silently drops security_invoker, the view reverts to running as its
-- owner, and RLS on `notifications` stops applying — every student can then
-- read every other student's notifications through it, and through
-- community_updates / activity_notifications, which are built on it (their own
-- invoker setting does not save them, because the inner view is what reads the
-- table). This was done by accident while writing this migration and caught by
-- 0192's verification suite; the belt-and-braces ALTER below makes the
-- property explicit even if someone edits the CREATE.
create or replace view public.notifications_live
with (security_invoker = true)
as
 select id,
    user_id,
    actor_id,
    type,
    data,
    read_at,
    created_at,
    group_key,
    group_count,
    subject_post_id,
    subject_match_post_id,
    subject_comment_id,
    subject_community_id,
    subject_event_id,
    subject_help_request_id,
    subject_conversation_id,
    subject_message_id,
    subject_announcement_id,
    subject_help_response_id
   from public.notifications n
  where (not data ? 'post_id'::text or subject_post_id is not null or subject_match_post_id is not null)
    and (not data ? 'comment_id'::text or subject_comment_id is not null)
    and (not data ? 'community_id'::text or subject_community_id is not null)
    and (not data ? 'society_id'::text or subject_community_id is not null)
    and (not data ? 'event_id'::text or subject_event_id is not null)
    and (not data ? 'request_id'::text or subject_help_request_id is not null)
    and (not data ? 'conversation_id'::text or subject_conversation_id is not null)
    -- CHANGED: only the DM types carry a message_id that names a row in
    -- `public.messages`. A room or event message's id lives in another table
    -- entirely, so requiring it here discarded every one of them.
    and (not data ? 'message_id'::text
         or type not in ('message', 'message_reaction')
         or subject_message_id is not null)
    and (not data ? 'announcement_id'::text or subject_announcement_id is not null)
    and (not data ? 'response_id'::text or subject_help_response_id is not null)
    and not (exists ( select 1
           from public.messages m
          where m.id = n.subject_message_id and m.deleted_at is not null))
    and (type <> 'match'::text or (exists ( select 1
           from public.matches mt
          where mt.user_low = least(n.user_id, nullif(n.data ->> 'user_id'::text, ''::text)::uuid)
            and mt.user_high = greatest(n.user_id, nullif(n.data ->> 'user_id'::text, ''::text)::uuid))));

-- Belt to the braces above: assert the property independently of the CREATE.
alter view public.notifications_live set (security_invoker = true);

grant select on public.notifications_live to authenticated;

comment on view public.notifications_live is
  'Notifications whose subject still exists. The message_id requirement applies only to DM types: community/event chat message ids live in other tables and previously caused every such notification to be discarded. See migrations 0132, 0137 and 0194.';

-- =============================================================================
-- VERIFY
--   select count(*) from public.notifications where type = 'community_message';
--   select count(*) from public.notifications_live where type = 'community_message';
--   -- must now be equal (they were 486 and 0).
--
--   -- and the property that must never be lost:
--   select reloptions from pg_class where relname = 'notifications_live';
--   -- must contain security_invoker=true.
--
-- ROLLBACK
--   Re-run 0137's notifications_live definition. Doing so re-hides every
--   community and event chat notification.
-- =============================================================================
