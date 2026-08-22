-- =============================================================================
-- FAST SOCIO — Scope the chat badge counts (perf audit F6b, Phase 3)
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
-- entirely to the RLS policy "participants read conversation messages", which
-- is an EXISTS against `conversations`. So the planner's job is "find every row
-- in the whole messages table with read_at is null, then test each one against
-- the policy" — work proportional to the app's total unread volume rather than
-- to the asking user's.
--
-- Migration 0152 added messages_unread_idx to make that survivable. This
-- migration fixes the shape: drive the query FROM the caller's conversations,
-- where the caller IS an indexed column, instead of scanning messages and
-- filtering by policy afterwards.
--
-- WHY THE UNION ALL RATHER THAN AN `OR`
-- `where user_low = me or user_high = me` tends to defeat both of the existing
-- indexes (conversations_user_low_idx / _user_high_idx) or force a BitmapOr.
-- Two index scans unioned is the shape that reliably uses each one.
--
-- It cannot double-count. `conversations` carries `check (user_low < user_high)`
-- and `unique (user_low, user_high)`, so a single row can never have the same
-- user on both sides — the two branches are disjoint by construction.
--
-- SECURITY — this is SECURITY DEFINER, so read the scoping carefully.
-- It bypasses RLS on `messages` and re-implements the visibility rule inline.
-- The `where user_low = auth.uid() or user_high = auth.uid()` in the CTE is
-- character-for-character the same condition as the policy's EXISTS clause
-- (see 0006_chat.sql:55-63 and 0032_rls_initplan_perf.sql:88-90). It takes NO
-- user parameter — the identity is always auth.uid(), so one student cannot ask
-- for another's counts. It returns two integers and nothing else: no ids, no
-- message content, no indication of WHO sent anything.
--
-- If the messages SELECT policy ever gains another branch (an admin bypass, a
-- new room type), this function must gain the same branch or the badge will
-- silently under-count. As of 0155 there is exactly one SELECT policy on
-- `messages` and it is participants-only — verified across all 154 prior
-- migrations.
--
-- BEHAVIOUR PRESERVED DELIBERATELY
-- Soft-deleted messages (deleted_at is not null, migration 0045) are still
-- counted, because the query this replaces counted them. A tombstone is still
-- an unopened thread, and read_at is stamped when the thread is opened either
-- way. Changing that would silently move everyone's badge number, which is a
-- product decision and not this migration's to make.
--
-- VERIFY — the new count must equal the old one for the same user:
--   select public.chat_badge_count();
--   -- against the queries it replaces:
--   select (select count(*) from messages
--            where sender_id <> auth.uid() and read_at is null) as unread,
--          (select count(*) from message_requests
--            where recipient_id = auth.uid() and status = 'pending') as requests;
--
--   -- and the plan should no longer scan messages (see audit §4 Q1):
--   explain (analyze, buffers) select public.chat_badge_count();
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

revoke all on function public.chat_badge_count() from public;
grant execute on function public.chat_badge_count() to authenticated;
