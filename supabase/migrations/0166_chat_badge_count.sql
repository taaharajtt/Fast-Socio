-- =============================================================================
-- FAST SOCIO — Scope the chat badge counts (DM realtime work, Phase 6)
--
-- WHY
-- The dock's chat badge is the sum of two counts, issued as two separate
-- PostgREST requests from the student layout and AGAIN from <DockRealtime/> on
-- every messages/message_requests event:
--
--   messages:          count(*) where sender_id <> me and read_at is null
--   message_requests:  count(*) where recipient_id = me and status = 'pending'
--
-- The second is fine — message_requests_recipient_idx covers it. The first is
-- the problem: it has NO predicate scoping it to the caller. Scoping is left
-- entirely to the RLS policy "participants read conversation messages", an
-- EXISTS against `conversations`. So the planner's job is "find every row in
-- the whole messages table with read_at is null, then test each one against the
-- policy" — work proportional to the app's TOTAL unread volume rather than to
-- the asking user's.
--
-- Migration 0165 added messages_unread_idx to make that survivable. This
-- migration fixes the shape: drive the query FROM the caller's conversations,
-- where the caller IS an indexed column, instead of scanning messages and
-- filtering by policy afterwards.
--
-- WHY THE UNION ALL RATHER THAN AN `OR`
-- `where user_low = me or user_high = me` tends to defeat both existing indexes
-- (conversations_user_low_idx / _user_high_idx) or force a BitmapOr. Two index
-- scans unioned is the shape that reliably uses each one.
--
-- It cannot double-count. `conversations` carries `check (user_low < user_high)`
-- and `unique (user_low, user_high)` (0006_chat.sql), so a single row can never
-- have the same user on both sides — the two branches are disjoint by
-- construction.
--
-- SECURITY — this is SECURITY DEFINER, so read the scoping carefully.
--
--   * It takes NO parameters. Identity comes exclusively from auth.uid(), so
--     one student cannot ask for another's counts. There is no argument to
--     tamper with and nothing to forge.
--   * `set search_path = public` pins resolution, so no schema on the caller's
--     search_path can shadow `conversations`, `messages` or `message_requests`
--     with a lookalike.
--   * It bypasses RLS on `messages` and re-implements the visibility rule
--     inline. The `where user_low = auth.uid() or user_high = auth.uid()` in the
--     CTE is the same condition as the policy's EXISTS clause (0006_chat.sql
--     lines 55-63, rewritten in 0032_rls_initplan_perf.sql lines 88-90). As of
--     0165 there is exactly one SELECT policy on `messages` and it is
--     participants-only — verified across all 164 prior migrations, including
--     0160, which REMOVED the unrestricted admin DM read rather than adding one.
--     If that policy ever gains another branch, this function must gain the same
--     branch or the badge will silently under-count.
--   * It exposes the MINIMUM: two integers. No ids, no message bodies, no
--     per-conversation breakdown, nothing about who sent anything. A caller
--     learns only their own two numbers, which they are already entitled to.
--   * EXECUTE is revoked from public and granted only to `authenticated`, so
--     anon cannot call it at all.
--
-- BEHAVIOUR PRESERVED DELIBERATELY
-- Soft-deleted messages (deleted_at is not null, migration 0045) and moderated
-- ones (hidden = true, P3-03) are still COUNTED, because the two queries this
-- replaces counted them. A tombstone is still an unopened thread, and read_at is
-- stamped when the thread is opened either way. Changing that would silently
-- move everyone's badge number, which is a product decision and not this
-- migration's to make. (Note the /chat inbox's PER-CONVERSATION unread count in
-- inbox-data.ts does exclude hidden rows; the two have always differed here and
-- this migration does not change either.)
--
-- VERIFY — the new count must equal the old one for the same user:
--   select public.chat_badge_count();
--   -- against the queries it replaces:
--   select (select count(*) from messages
--            where sender_id <> auth.uid() and read_at is null) as unread,
--          (select count(*) from message_requests
--            where recipient_id = auth.uid() and status = 'pending') as requests;
--
--   -- and the plan should no longer scan messages:
--   explain (analyze, buffers) select public.chat_badge_count();
--
-- ROLLBACK
--   drop function if exists public.chat_badge_count();
-- The application code falls back to the two original queries when the function
-- is absent (src/lib/chat/badge-count.ts), so dropping it degrades cost without
-- breaking the badge.
-- =============================================================================

create or replace function public.chat_badge_count()
returns jsonb
language sql
stable
security definer
set search_path = public
-- `(select auth.uid())` rather than a bare call, matching the convention
-- migration 0032 applied across every policy: the scalar subquery is hoisted to
-- an InitPlan and evaluated once instead of per row.
as $$
  with mine as (
    select c.id from public.conversations c where c.user_low  = (select auth.uid())
    union all
    select c.id from public.conversations c where c.user_high = (select auth.uid())
  )
  select jsonb_build_object(
    'unread', (
      select count(*)
        from mine
        join public.messages m on m.conversation_id = mine.id
       where m.sender_id <> (select auth.uid())
         and m.read_at is null
    ),
    'requests', (
      select count(*)
        from public.message_requests r
       where r.recipient_id = (select auth.uid())
         and r.status = 'pending'
    )
  );
$$;

comment on function public.chat_badge_count() is
  'Unread DMs + pending message requests for auth.uid(), as {"unread":n,"requests":n}. Definer, identity from auth.uid() only, authenticated-execute only. See migration 0166.';

revoke all on function public.chat_badge_count() from public;
revoke all on function public.chat_badge_count() from anon;
grant execute on function public.chat_badge_count() to authenticated;
