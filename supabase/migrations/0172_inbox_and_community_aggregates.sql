-- =============================================================================
-- FAST SOCIO — push two hot counts into SQL (perf audit Phase 5.2 / 5.3 / 5.4)
--
-- WHY
-- Two screens were transferring whole tables to the app server in order to
-- compute an integer per row, and both were on the tail that the perf audit
-- measured (Communities 5.9s, Chat 5.8s over 24h):
--
--   1. /communities read `community_members` with `.limit(4000)` — every
--      (community_id, user_id) pair for every space in scope — solely to count
--      how many of those members were currently online. It then made a SECOND
--      round trip for `profile_presence` on the de-duplicated user ids. Three
--      serial stages, ~4000 rows over the wire, to produce ~20 integers.
--
--   2. The chat inbox read one row per UNREAD MESSAGE (`select conversation_id`
--      with no limit at all) and counted them into a Map in JS. That query grows
--      without bound: a single busy thread that nobody has opened makes the
--      inbox slower for the rest of the app's lifetime.
--
-- Both are replaced by an aggregate that returns one row per conversation or
-- per community.
--
-- SECURITY — both functions are SECURITY INVOKER (the default), deliberately.
--
-- The precedent in this repo (0166 / 0169 `chat_badge_count`) is SECURITY
-- DEFINER with the RLS predicate re-implemented inline, and 0169 documents the
-- standing hazard that creates: "It must stay identical to the single SELECT
-- policy on `messages`; if that policy ever gains a branch, this function needs
-- the same branch or the badge under-counts."
--
-- These two functions do not need to take on that maintenance debt, because
-- neither needs to see anything the caller cannot already see:
--
--   * `messages` has exactly one SELECT policy (participants of the
--     conversation, 0006). Under invoker it applies automatically and cannot
--     drift from itself.
--
--   * `profile_presence` has a real visibility rule (0092): you see your own
--     row, or someone else's only when they publish it via profiles.show_online.
--     The application code being replaced relied on that rule and documented the
--     consequence — "an undercount, never a leak". A DEFINER function here would
--     silently START counting students who have deliberately hidden their
--     presence, turning a privacy setting into a no-op. Invoker preserves the
--     existing semantic exactly.
--
--   * `community_members` is `using (true)` for authenticated (0009), so RLS
--     costs nothing there either way.
--
-- Neither function can be used to ask about another user: #1 takes no arguments
-- and is scoped by auth.uid() through RLS, and #2's arguments are filtered by
-- RLS on the underlying tables, so passing ids you cannot see returns no rows.
--
-- INDEXES — both aggregates are already covered, no new index is needed:
--   * messages_unread_idx (0165): (conversation_id) include (sender_id)
--     where read_at is null — exactly this query's shape.
--   * community_members pkey (0009): (community_id, user_id) — supports
--     `community_id = any(...)` + `group by community_id`.
--   * profile_presence pkey (0092): (id) — the join key.
--
-- VERIFY
--   select * from public.conversation_unread_counts();
--   -- must agree with the per-thread count the inbox used to compute:
--   select conversation_id, count(*) from public.messages
--    where sender_id <> auth.uid() and read_at is null and not hidden
--    group by conversation_id;
--
--   select * from public.community_active_counts(
--     array(select id from public.communities limit 5), now() - interval '5 min');
--
-- ROLLBACK
--   drop function if exists public.conversation_unread_counts();
--   drop function if exists public.community_active_counts(uuid[], timestamptz);
--   The application falls back to its previous client-side counting whenever
--   either call errors, so a rollback needs no coordinated deploy.
-- =============================================================================

-- 1. Unread messages per conversation, for the chat inbox.
--
-- No parameters: the caller's identity is auth.uid() via RLS on `messages`, so
-- there is nothing to pass and nothing to abuse. Output columns are named
-- `conv_id` / `unread_count` rather than `conversation_id` / `unread` because a
-- `returns table` column name is in scope inside the body and would be
-- ambiguous against the real column it selects from.
create or replace function public.conversation_unread_counts()
returns table (conv_id uuid, unread_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select m.conversation_id, count(*)::int
  from public.messages m
  where m.sender_id <> (select auth.uid())
    and m.read_at is null
    and m.hidden = false
  group by m.conversation_id;
$$;

revoke all on function public.conversation_unread_counts() from public, anon;
grant execute on function public.conversation_unread_counts() to authenticated;

-- 2. Online-member count per community, for the Communities hub.
--
-- `p_since` is passed in rather than computed here so the online window stays
-- defined in ONE place — src/lib/time.ts ONLINE_WINDOW_MS, which the client also
-- uses to render the same dot. Hard-coding an interval here would let the two
-- drift and make a member "online" on the server and offline in the UI.
create or replace function public.community_active_counts(
  p_community_ids uuid[],
  p_since timestamptz
)
returns table (cid uuid, active_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select cm.community_id, count(*)::int
  from public.community_members cm
  join public.profile_presence pp on pp.id = cm.user_id
  where cm.community_id = any(p_community_ids)
    and pp.last_seen_at > p_since
  group by cm.community_id;
$$;

revoke all on function public.community_active_counts(uuid[], timestamptz) from public, anon;
grant execute on function public.community_active_counts(uuid[], timestamptz) to authenticated;
