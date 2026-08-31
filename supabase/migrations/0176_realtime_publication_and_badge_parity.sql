-- 0176 — Realtime cost, part 1: stop publishing a table nobody listens to, and
-- make the two unread definitions agree before the client starts deriving one
-- from the other.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- Measured on this database over 19.6 days (pg_stat_statements, 2026-08-31):
--
--     total database time           6.50 h
--       realtime.apply_rls          3.70 h   <-- 56.9%
--       all application queries     2.09 h       32.1%
--
-- `postgres_changes` re-evaluates row-level security once PER SUBSCRIBER for
-- every write to a published table. The cost is therefore
--
--     write rate  x  subscription count
--
-- and neither term is bounded by anything the application controls today. It is
-- already the single largest consumer of this instance, ahead of every query the
-- product actually runs, and it grows with concurrency rather than with usage.
--
-- ---------------------------------------------------------------------------
-- 1. DROP `notifications` FROM THE PUBLICATION.
--
-- Nothing subscribes to it. The full set of `postgres_changes` subscriptions in
-- the client is:
--
--     messages                 4     community_chat_messages   3
--     message_requests         2     conversations             1
--     post_comments            1     message_reactions         1
--     event_messages           1     society_announcements     1
--
-- `notifications` appears nowhere in that list, yet every insert into it — and
-- it is written by triggers on messages, comments, likes, follows and mentions,
-- so it is one of the busiest tables here — was being decoded from the WAL and
-- evaluated against the RLS policy of every connected client, to be delivered to
-- nobody. This is pure waste and removing it is free.
--
-- The Activity badge does not regress: it is computed server-side by
-- `home_bootstrap()` at render time (migration 0174) and has never had a
-- realtime subscription. Push notifications are unaffected — they go out over
-- web-push, not over the realtime socket.
--
-- NOTE FOR THE READER, deliberately NOT acted on here: `society_announcements`
-- is the mirror-image bug. `src/components/societies/announcement-thread.tsx`
-- subscribes to it, but it has never been in this publication, so that listener
-- has always received nothing and society announcements have never been live.
-- Adding it would fix that feature at the cost of the very WAL evaluation this
-- migration exists to reduce, so it is a product decision rather than a
-- performance one and is left alone until someone makes that call.

alter publication supabase_realtime drop table public.notifications;

-- ---------------------------------------------------------------------------
-- 2. ONE DEFINITION OF "UNREAD".
--
-- Two functions counted unread messages and they did not agree:
--
--   chat_badge_count()            sender_id <> me and read_at is null
--   conversation_unread_counts()  sender_id <> me and read_at is null
--                                 and hidden = false      <-- only here
--
-- So a moderated (hidden) unread message counted towards the dock badge but not
-- towards any inbox row. The dock could read "1" while the inbox showed nothing
-- unread anywhere, and tapping through would land on a thread with nothing new
-- visible in it.
--
-- `hidden = false` is the correct rule. A hidden message has been moderated away
-- and the recipient cannot see it, so it is not something they have left to
-- read; sending them to a thread to find it would be a badge that lies.
--
-- THIS IS A NO-OP FOR EVERY CURRENT USER. Verified against production before
-- writing it: `select count(*) from messages where read_at is null and hidden`
-- returns 0, out of 225 unread messages in total. Nothing anyone sees changes
-- today — the divergence would have appeared the first time a moderator hid a
-- DM, which is exactly the wrong moment to discover it.
--
-- It also has to be fixed BEFORE the client change that accompanies it: the
-- merged realtime listener derives the dock badge from the inbox payload
-- instead of issuing a second round trip for it, and that derivation is only
-- sound while the two definitions agree. `home_bootstrap()` (migration 0174)
-- composes this function rather than reimplementing it, so fixing it here fixes
-- the server-rendered badge in the same stroke.
--
-- Everything else is carried over from 0169 byte-for-byte: signature, return
-- shape, the `unread` alias kept for pre-0169 clients, STABLE, SECURITY
-- DEFINER, and the search_path pin.

create or replace function public.chat_badge_count()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
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
           -- Added in 0176 so this matches conversation_unread_counts().
           and m.hidden = false
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
$function$;

-- Grants are not re-stated: CREATE OR REPLACE preserves them, and 0169 already
-- revoked this from public/anon and granted execute to authenticated.
