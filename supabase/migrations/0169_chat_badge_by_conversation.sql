-- =============================================================================
-- FAST SOCIO — The chat dock badge counts CONVERSATIONS, not messages
--
-- WHY
-- `chat_badge_count()` (migration 0166) returns the number of unread MESSAGES.
-- That is not what a chat badge means anywhere else on a phone: one friend
-- sending three lines in one thread made the dock read "3", and a student
-- opening Chat found a single unread row. The number promised three places to
-- go and delivered one.
--
-- The product rule is now: Chat badge = unread CONVERSATIONS + pending message
-- requests. Three messages in one thread count 1; one message in each of three
-- threads counts 3. Requests keep contributing one apiece, which they already
-- did — a pending request IS a distinct thing to act on.
--
-- WHAT CHANGES
-- Only the 'unread' arm. The CTE, the UNION ALL over `conversations`, and the
-- requests arm are all carried over unchanged from 0166 (see that migration for
-- why the union beats an OR, and why it cannot double-count).
--
--   before:  count(*)                    -- unread message rows
--   after:   count(distinct m.conversation_id)
--
-- THE NEW 'conversations' KEY — this is deliberate, do not "simplify" it away.
-- The result gains a `conversations` key carrying the same number as `unread`.
-- The client (src/lib/chat/badge-count.ts) treats the PRESENCE of that key as
-- the signal that it is talking to a 0169-or-later database, and falls back to
-- its own conversation-shaped query when it is absent. Without it, a client
-- deployed ahead of this migration would read 0166's message count out of
-- `unread` and render a silently wrong badge — the exact failure this migration
-- exists to remove. `unread` is kept as an alias so a 0166-era client deployed
-- against a 0169 database still gets a sane (now conversation-shaped) number
-- rather than a zero.
--
-- SECURITY — unchanged from 0166, and the reasoning there still governs:
--   * No parameters. Identity is auth.uid() only, so nobody can ask for another
--     student's counts.
--   * `set search_path = public` pins table resolution.
--   * Definer, bypassing RLS on `messages`, with the participants-only rule
--     re-implemented inline in the CTE. It must stay identical to the single
--     SELECT policy on `messages`; if that policy ever gains a branch, this
--     function needs the same branch or the badge under-counts.
--   * Exposes two integers and nothing else. EXECUTE stays revoked from public
--     and anon, granted to `authenticated` only.
--
-- BEHAVIOUR PRESERVED
-- Soft-deleted (deleted_at) and moderated (hidden) messages still count, for
-- the reason 0166 gives: a tombstone is still an unopened thread, and read_at
-- is stamped when the thread is opened either way. Collapsing to conversations
-- only makes this less visible, never wrong.
--
-- VERIFY
--   select public.chat_badge_count();
--   -- the unread arm must equal the number of threads, not messages:
--   select count(distinct m.conversation_id)
--     from public.messages m
--     join public.conversations c on c.id = m.conversation_id
--    where (c.user_low = auth.uid() or c.user_high = auth.uid())
--      and m.sender_id <> auth.uid() and m.read_at is null;
--
-- ROLLBACK
--   Re-run 0166_chat_badge_count.sql. The application falls back to a
--   conversation-shaped client-side query whenever `conversations` is missing
--   from the result, so the badge stays correct across the rollback.
-- =============================================================================

create or replace function public.chat_badge_count()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select c.id from public.conversations c where c.user_low  = (select auth.uid())
    union all
    select c.id from public.conversations c where c.user_high = (select auth.uid())
  ),
  counted as (
    select
      (
        select count(distinct m.conversation_id)
          from mine
          join public.messages m on m.conversation_id = mine.id
         where m.sender_id <> (select auth.uid())
           and m.read_at is null
      ) as conversations,
      (
        select count(*)
          from public.message_requests r
         where r.recipient_id = (select auth.uid())
           and r.status = 'pending'
      ) as requests
  )
  select jsonb_build_object(
    'conversations', conversations,
    -- Alias, kept so a pre-0169 client reading `unread` still gets the right
    -- shape of number. New clients ignore it and read `conversations`.
    'unread', conversations,
    'requests', requests
  )
  from counted;
$$;

comment on function public.chat_badge_count() is
  'Unread CONVERSATIONS + pending message requests for auth.uid(), as {"conversations":n,"unread":n,"requests":n}. Definer, identity from auth.uid() only, authenticated-execute only. See migration 0169 (supersedes 0166, which counted messages).';

revoke all on function public.chat_badge_count() from public;
revoke all on function public.chat_badge_count() from anon;
grant execute on function public.chat_badge_count() to authenticated;
