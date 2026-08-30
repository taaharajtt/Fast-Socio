-- Batch feature-flag reads (perf audit Phase 2.6).
--
-- The student layout resolves three flags on every render (discover, events,
-- leaderboard). `resolveFlags` maps over the keys and `isFeatureEnabled` is
-- memoised PER KEY, so that was three separate PostgREST round trips to
-- Frankfurt on the critical path of every navigation — for config that changes
-- on the order of days.
--
-- This collapses them into one call returning a jsonb object keyed by flag.
--
-- The per-key expression is a VERBATIM copy of `flag_enabled(text)` from
-- migration 0050, including the deterministic rollout bucket
-- (`hashtextextended(key || ':' || uid) % 100 < rollout_pct`). That is
-- load-bearing: the bucket must agree with the single-key function, or a user
-- would land in the rollout for `flag_enabled('discover')` and out of it for
-- `flags_enabled(array['discover'])` and the feature would flicker depending on
-- which call site asked. `flag_enabled` is deliberately left in place and
-- unchanged — it is still the right call for a single ad-hoc check.
--
-- SECURITY: `security definer` + pinned `search_path`, matching 0050. It reads
-- only public.feature_flags, which is operational config, and scopes the bucket
-- to the CALLER's auth.uid() — a caller cannot ask for another user's flags.

create or replace function public.flags_enabled(p_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(
      k,
      case
        when f.key is null then false
        when not f.enabled then false
        when f.rollout_pct >= 100 then true
        when f.rollout_pct <= 0 then false
        else (abs(hashtextextended(k || ':' || coalesce(auth.uid()::text, 'anon'), 0)) % 100) < f.rollout_pct
      end
    ),
    '{}'::jsonb
  )
  from unnest(p_keys) as k
  left join public.feature_flags f on f.key = k;
$$;

-- Same grant posture as flag_enabled: authenticated only, never anon/public.
grant execute on function public.flags_enabled(text[]) to authenticated;
revoke execute on function public.flags_enabled(text[]) from public, anon;
