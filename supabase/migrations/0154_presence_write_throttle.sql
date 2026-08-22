-- =============================================================================
-- FAST SOCIO — Throttle the presence writes (perf audit F13, Phase 2)
--
-- WHY
-- Two RPCs write to the database purely as a side effect of a user having the
-- app open, and neither checks whether the write would change anything:
--
--   touch_last_seen()   upsert into profile_presence
--     Called by <PresenceHeartbeat/> on mount, on every `visibilitychange`,
--     and on an interval. Every call is an unconditional upsert, so each beat
--     produces a dead tuple. 200 concurrent students is a write roughly every
--     0.2s from presence alone, plus a burst every time someone locks and
--     unlocks their phone.
--
--     NOTE FOR ANYONE READING THE PERF AUDIT: that audit described this as
--     writing to `profiles`, "the most-read table in the schema", and proposed
--     moving presence onto a narrow table of its own. That move ALREADY
--     HAPPENED — migration 0092 repointed this function at profile_presence and
--     0093 dropped profiles.last_seen_at outright. The audit was written
--     against the 0045 definition without checking for a later redefinition.
--     So the severity is lower than stated: these writes land on a two-column
--     table that nothing joins against, not on the feed's hot path. Throttling
--     is still worth doing — it is fewer WAL records, less autovacuum work and
--     fewer round trips — but it is housekeeping, not a fix for feed latency.
--
--   record_session(...)  bumps user_sessions.last_active_at
--     Called from the student layout via after() on EVERY page load. It is
--     correctly deferred so it never blocks rendering, but a user clicking
--     around still rewrites the same row over and over.
--
-- WHAT THIS DOES
-- Adds a staleness guard to each, so a redundant call becomes a no-op instead
-- of a row write. Neither changes what the app observes.
--
-- WHY THE THRESHOLDS ARE WHAT THEY ARE
-- Presence is read through ONLINE_WINDOW_MS = 2 minutes (src/lib/time.ts):
-- a user counts as online if last_seen_at is within the last 120s. Writing at
-- most once per 45s therefore cannot change any presence verdict — the value
-- can only ever be up to 45s staler than before, which is well inside the
-- 120s window, and the client beat is 60s so the guard mostly just absorbs the
-- extra visibilitychange calls. Keep 45s < 120s if the window is ever retuned.
--
-- user_sessions.last_active_at drives the "your devices" list in Settings →
-- Security, which shows relative times ("active 2 minutes ago"). 5 minutes of
-- granularity is far below what that display resolves.
--
-- NOTE ON SIDE EFFECTS
-- touch_last_seen() stays `language sql` and keeps the exact shape 0092 gave
-- it — an INSERT ... ON CONFLICT — so the throttle is expressed as a WHERE on
-- the DO UPDATE branch. First sight of a user still inserts immediately; only
-- the refresh of an already-fresh row is skipped. A new session row must
-- likewise still be created on first sight, so the guard in record_session()
-- wraps only its UPDATE branch.
--
-- CAUTION FOR THE NEXT EDITOR — this function has been redefined twice
-- (0045 -> 0092 -> here) and its TABLE changed in the process. `set
-- check_function_bodies = off` is standard in this repo's migrations, which
-- means a definer function referencing a dropped column is created happily and
-- then fails at every call at runtime. Always diff against the LATEST
-- definition, and always execute the function after applying, not just create
-- it. An earlier draft of this migration rebuilt it from the 0045 body and
-- would have written to profiles.last_seen_at, a column 0093 dropped —
-- silently breaking presence for everyone.
--
-- VERIFY (execute it, do not just create it)
--   select public.touch_last_seen();
--   select last_seen_at from public.profile_presence where id = auth.uid();
--   select public.touch_last_seen();          -- immediately again
--   select last_seen_at from public.profile_presence where id = auth.uid();
--   -- unchanged; and after 45s the next call moves it.
--
--   -- write volume, before vs after (see audit §4 Q7):
--   select relname, n_tup_upd, n_dead_tup from pg_stat_user_tables
--    where relname in ('profiles','user_sessions');
-- =============================================================================

-- ---------------------------------------------------------------------------
-- touch_last_seen — write at most once per 45s per user
-- ---------------------------------------------------------------------------
-- Body preserved from 0092 (profile_presence, not profiles — see CAUTION
-- above); the only change is the WHERE on the DO UPDATE branch.
create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.profile_presence (id, last_seen_at)
  select auth.uid(), now()
  where auth.uid() is not null
  -- Unqualified table name on purpose: ON CONFLICT DO UPDATE exposes the
  -- existing row under the table's NAME (or its alias), not schema-qualified.
  on conflict (id) do update
     set last_seen_at = now()
   where profile_presence.last_seen_at is null
      or profile_presence.last_seen_at < now() - interval '45 seconds';
$function$;

revoke all on function public.touch_last_seen() from public;
grant execute on function public.touch_last_seen() to authenticated;

-- ---------------------------------------------------------------------------
-- record_session — bump last_active_at at most once per 5 minutes per device
-- ---------------------------------------------------------------------------
create or replace function public.record_session(
  p_device_label text default null,
  p_user_agent   text default null,
  p_ip           text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    return null;
  end if;

  select id into v_id
  from public.user_sessions
  where user_id = v_uid
    and coalesce(user_agent, '') = coalesce(p_user_agent, '')
    and revoked_at is null
  order by last_active_at desc
  limit 1;

  if v_id is null then
    -- First sight of this device: always record it immediately.
    insert into public.user_sessions (user_id, device_label, user_agent, ip)
    values (v_uid, p_device_label, p_user_agent, p_ip)
    returning id into v_id;
  else
    -- Known device: only rewrite the row if it has actually gone stale, or if
    -- something about it changed (a new IP is worth recording promptly — it is
    -- what makes the security timeline useful).
    update public.user_sessions
      set last_active_at = now(),
          ip = coalesce(p_ip, ip),
          device_label = coalesce(p_device_label, device_label)
      where id = v_id
        and (last_active_at < now() - interval '5 minutes'
             or (p_ip is not null and coalesce(ip, '') is distinct from p_ip)
             or (p_device_label is not null
                 and coalesce(device_label, '') is distinct from p_device_label));
  end if;

  return v_id;
end $$;

revoke all on function public.record_session(text, text, text) from public;
grant execute on function public.record_session(text, text, text) to authenticated;
