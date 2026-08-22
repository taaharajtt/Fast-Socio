-- =============================================================================
-- FAST SOCIO — Batch the feature-flag read (perf audit F10, Phase 2)
--
-- WHY
-- The student layout resolves three flags to decide which dock tabs exist:
--
--   resolveFlags(["discover", "events", "leaderboard"])   src/lib/flags.ts
--
-- That helper maps over the keys and awaits `flag_enabled(key)` for each one.
-- They run concurrently, so the wall-clock cost is roughly one round trip
-- rather than three — but it is still three separate PostgREST requests, three
-- connections and three function invocations, on every shell render, for three
-- booleans that come out of the same four-row table.
--
-- WHAT THIS ADDS
-- `flags_enabled(text[])` — the same decision, evaluated set-at-a-time, as a
-- jsonb object of key -> boolean. One round trip for any number of keys.
--
-- The per-key semantics are IDENTICAL to flag_enabled() and are deliberately
-- expressed with the same CASE ladder rather than by refactoring both onto a
-- shared helper: these two functions decide who sees what, and a future edit
-- that silently changes one of them must not be able to change the other by
-- accident. flag_enabled() is kept, not dropped — it is still the right call
-- for a single ad-hoc check, and isFeatureEnabled() in lib/flags.ts still uses
-- it. Any change to the rollout rule has to be made in BOTH.
--
-- The rollout bucket still hashes `key || ':' || auth.uid()`, so a given user
-- lands in exactly the same bucket through either function and a flag at 30%
-- covers the same 30% of students as before. `left join` against the requested
-- keys preserves flag_enabled()'s "unknown key -> false" behaviour rather than
-- omitting the key from the result, so a typo in a key name fails closed and
-- visibly instead of reading as undefined.
--
-- SECURITY
-- SECURITY DEFINER for the same reason flag_enabled() is: migration 0081
-- revoked direct SELECT on feature_flags so rollout percentages and unreleased
-- flag names are not enumerable by students. This function returns only the
-- resolved booleans for keys the CALLER NAMED, never the table's contents, and
-- it takes no user parameter — the bucket is always the caller's own auth.uid().
-- `set search_path = public` is required on every definer function here.
--
-- VERIFY
--   select public.flags_enabled(array['discover','events','leaderboard']);
--   -- => {"discover": true, "events": true, "leaderboard": true}
--   -- and must agree, key for key, with the single-key function:
--   select public.flag_enabled('discover'), public.flag_enabled('events');
-- =============================================================================

create or replace function public.flags_enabled(p_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(
      k.key,
      case
        when f.key is null then false
        when not f.enabled then false
        when f.rollout_pct >= 100 then true
        when f.rollout_pct <= 0 then false
        else (abs(hashtextextended(k.key || ':' || coalesce(auth.uid()::text, 'anon'), 0)) % 100)
               < f.rollout_pct
      end
    ),
    '{}'::jsonb
  )
  from unnest(p_keys) as k(key)
  left join public.feature_flags f on f.key = k.key;
$$;

revoke all on function public.flags_enabled(text[]) from public;
grant execute on function public.flags_enabled(text[]) to authenticated;
