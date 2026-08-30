-- =============================================================================
-- FAST SOCIO — database-level ban enforcement (defence in depth)
--
-- WHY THIS EXISTS
-- A ban had exactly ONE enforcement point: the redirect to /banned in
-- src/lib/supabase/middleware.ts. Verified against this database:
--
--   select count(*) from pg_policies
--    where schemaname='public' and 'authenticated' = any(roles)
--      and cmd in ('INSERT','UPDATE','DELETE','ALL')
--      and (coalesce(qual,'')||' '||coalesce(with_check,'')) ilike '%is_banned%';
--   -- 0
--
-- Zero of the 32 authenticated INSERT/UPDATE policies mention is_banned. The
-- column is used in read-side filters (feeds, leaderboard, discover hide banned
-- users from OTHERS) and in a self-escalation trigger, but nothing stopped a
-- banned account from WRITING. Any already-open tab, any client with a valid
-- JWT, or anything hitting PostgREST directly could keep posting, commenting
-- and sending DMs after being banned. For a moderation action usually taken
-- because someone is actively abusing the platform, "they must navigate for it
-- to take effect" is not enforcement.
--
-- This also removes the blocker on the cached moderation-flags cookie that was
-- deliberately NOT shipped in the perf work: caching the ban flag for 60-120s
-- was rejected precisely because the middleware was the only thing enforcing
-- it. With writes gated here, that trade becomes affordable — but it is a
-- separate change and is not made in this migration.
--
-- ---------------------------------------------------------------------------
-- WHY TRIGGERS AND NOT `alter policy`
-- ---------------------------------------------------------------------------
-- The obvious approach — appending `and not is_banned(auth.uid())` to each
-- policy's WITH CHECK — requires restating each policy's existing predicate
-- verbatim across 32 policies. That is the exact drift hazard migration 0169
-- warns about ("It must stay identical to the single SELECT policy on
-- messages; if that policy ever gains a branch, this function needs the same
-- branch"), multiplied by 32, and a transcription slip would silently WIDEN an
-- authorization rule rather than fail loudly.
--
-- A BEFORE INSERT OR UPDATE trigger composes with whatever the policy already
-- says instead of replacing it. It cannot loosen an existing rule, it needs no
-- knowledge of any predicate, and it survives future policy edits untouched.
-- Both mechanisms are enforced by the database, which is what "defence in
-- depth" requires here.
--
-- ---------------------------------------------------------------------------
-- WHY `current_user` AND NOT `auth.role()`  (this is load-bearing)
-- ---------------------------------------------------------------------------
-- Migration 0022 fixed a P1 moderation failure caused by exactly this
-- distinction: `auth.role()` still resolves to 'authenticated' INSIDE a
-- SECURITY DEFINER body, so a guard written against it also fires for admin
-- RPCs — which is how `admin_set_ban()` became a silent no-op. `current_user`
-- is the function owner inside any definer function.
--
-- So the guard below fires ONLY for direct end-user writes (PostgREST does
-- SET ROLE authenticated) and is transparently exempt for:
--   * service_role — it also has BYPASSRLS (verified: rolbypassrls = true),
--   * every SECURITY DEFINER moderation/notification RPC in this schema,
--   * migrations and maintenance run as postgres.
-- Moderation therefore keeps working on a banned user's rows, which is the
-- whole point of moderation.
--
-- `enforce_not_banned()` is deliberately SECURITY INVOKER. Making it DEFINER
-- would set current_user to the owner on EVERY call and the guard would never
-- fire — the failure would be silent and total. It calls is_banned(), which is
-- definer, to do the profiles read.
--
-- ---------------------------------------------------------------------------
-- WHAT IS GATED, AND WHAT IS DELIBERATELY NOT
-- ---------------------------------------------------------------------------
-- GATED — producing or altering content and participation:
--   posts, post_comments, post_likes, comment_likes, messages,
--   message_requests, community_chat_messages, event_messages, communities,
--   events, event_feedback, smart_match_posts, matching_intents, swipes,
--   event_attendees, community_followers, help_request_followers
--
-- NOT GATED, each for a reason:
--   * appeals            — a banned user MUST be able to appeal. Gating this
--                          would make the ban unappealable, which is the one
--                          outcome that turns a moderation tool into a trap.
--   * reports            — a banned user must still be able to report abuse
--                          directed at them.
--   * blocked_users,
--     muted_users        — self-protective. Blocking someone who is harassing
--                          you is not participation.
--   * notifications,
--     community_chat_reads,
--     user_sessions      — read-state and session bookkeeping. Gating these
--                          breaks presence and read receipts for no gain.
--   * profiles           — entangled with onboarding and the existing
--                          protect_profile_columns trigger; a banned user is
--                          already excluded from every surface that renders a
--                          profile, so the abuse value is ~nil and the
--                          regression risk is not.
--   * ALL DELETEs        — a ban should stop someone producing, not trap them.
--                          Leaving a community, withdrawing an RSVP, deleting
--                          their own post and unfollowing all stay available.
--
-- ---------------------------------------------------------------------------
-- VERIFY / ROLLBACK — see supabase/tests/ban_write_enforcement.sql
-- ---------------------------------------------------------------------------
-- ROLLBACK (safe, immediate, no data change):
--   drop trigger if exists <name> on public.<table>;   -- for each below
--   drop function if exists public.enforce_not_banned();
--   drop function if exists public.is_banned(uuid);
-- =============================================================================

-- 1. Shared helper. Mirrors public.is_admin(uuid) exactly in shape, volatility
--    and security posture, so the two read the same way at call sites.
--    Column-qualified (p.is_banned) because the function shares its name with
--    the column it reads.
create or replace function public.is_banned(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_banned from public.profiles p where p.id = uid), false);
$$;

revoke all on function public.is_banned(uuid) from public, anon;
grant execute on function public.is_banned(uuid) to authenticated;

-- 2. The guard. SECURITY INVOKER — see the note above; making this DEFINER
--    disables it silently.
create or replace function public.enforce_not_banned()
returns trigger
language plpgsql
as $$
begin
  -- Direct end-user writes only. PostgREST does SET ROLE authenticated;
  -- service_role, definer RPCs and postgres all fall through untouched.
  if current_user = 'authenticated'
     and public.is_banned((select auth.uid())) then
    raise exception 'Your account is suspended, so this action was blocked. You can appeal from Settings.'
      using errcode = '42501';   -- insufficient_privilege -> PostgREST 403
  end if;
  return new;
end;
$$;

-- 3. Attach to every content/participation table. `drop ... if exists` first so
--    the migration is re-runnable.
do $$
declare
  t text;
  tables text[] := array[
    'posts','post_comments','post_likes','comment_likes',
    'messages','message_requests','community_chat_messages','event_messages',
    'communities','events','event_feedback',
    'smart_match_posts','matching_intents','swipes',
    'event_attendees','community_followers','help_request_followers'
  ];
begin
  foreach t in array tables loop
    -- Skip tables that do not exist in this database rather than failing the
    -- whole migration: the schema has drifted from repo numbering before, and a
    -- missing optional table must not block enforcement on the other sixteen.
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %: table not present', t;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', 'enforce_not_banned_' || t, t);
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.enforce_not_banned()',
      'enforce_not_banned_' || t, t);
  end loop;
end;
$$;
