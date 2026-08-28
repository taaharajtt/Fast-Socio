-- 0159 — A rate limiter that is concurrency-safe and says WHY it said no.
--
-- Forward-only. `public.check_rate_limit` (migration 0003) is left in place and
-- untouched: it is shared infrastructure, `rate_limit_events` is unchanged, and
-- nothing about the existing policy table moves except the two Discover swipe
-- buckets described below.
--
-- TWO PROBLEMS WITH 0003.
--
--  1. IT CONFLATES REJECTION WITH FAILURE. It returns a bare boolean, so the
--     caller cannot tell "you have used your quota" from "the limiter itself
--     errored". Every failure therefore reached the user as "Slow down a
--     little" — advice that is useless when the real problem is the database.
--
--  2. IT IS NOT CONCURRENCY-SAFE. It does `select count(*)` and then `insert`
--     as two separate statements under READ COMMITTED. Two requests that
--     overlap both read the same count and both insert, so N parallel callers
--     can exceed the limit by up to N-1. That is exactly the case a burst guard
--     exists to catch, so the burst guard cannot be built on it.
--
-- THIS FUNCTION.
--   * Returns `(allowed boolean, retry_after_seconds integer)`. On a genuine
--     rejection, `retry_after_seconds` is the wait until the OLDEST event in
--     the window ages out, i.e. when a slot actually frees.
--   * Takes `pg_advisory_xact_lock` on a hash of (uid, action) FIRST, so the
--     count and the insert are atomic with respect to any other caller checking
--     the same bucket. The lock is transaction-scoped, so it is released when
--     the statement's implicit transaction ends — no leak, no explicit unlock.
--     Different users, and different actions for one user, hash to different
--     keys and do not contend.
--   * Same window semantics as 0003 (`created_at > now() - p_window`), same
--     `rate_limit_events` table, same fail-closed treatment of an
--     unauthenticated caller.
--
-- SECURITY. SECURITY DEFINER with a pinned search_path, EXECUTE granted to
-- `authenticated` only, mirroring 0003. `rate_limit_events` still has no client
-- policies, so this function remains the only way to write it.

create or replace function public.check_rate_limit_burst(
  p_action text,
  p_max integer,
  p_window interval
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  recent integer;
  oldest timestamptz;
begin
  if uid is null then
    -- Unauthenticated callers are never allowed, as in 0003.
    allowed := false;
    retry_after_seconds := null;
    return next;
    return;
  end if;

  -- Serialize every concurrent check of THIS user's THIS bucket. Without it the
  -- count below is a stale read and parallel requests each insert past the max.
  perform pg_advisory_xact_lock(
    hashtextextended(uid::text || ':' || coalesce(p_action, ''), 0)
  );

  select count(*), min(created_at)
    into recent, oldest
    from public.rate_limit_events
   where user_id = uid
     and action = p_action
     and created_at > now() - p_window;

  if recent >= p_max then
    allowed := false;
    -- When the oldest event in the window ages out, a slot frees.
    retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from ((oldest + p_window) - now())))::integer
    );
    return next;
    return;
  end if;

  insert into public.rate_limit_events (user_id, action)
  values (uid, p_action);

  allowed := true;
  retry_after_seconds := null;
  return next;
end;
$$;

revoke all on function public.check_rate_limit_burst(text, integer, interval) from public;
revoke execute on function public.check_rate_limit_burst(text, integer, interval) from anon;
grant execute on function public.check_rate_limit_burst(text, integer, interval) to authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping note: ordinary Discover swipes no longer write hourly `like` /
-- `pass` rows. They write a `discoverSwipe` row with a 10-second window
-- instead, so `rate_limit_events` churn for Discover DROPS — the same
-- `prune_rate_limit_events()` from 0003 still covers it. Historical `like` /
-- `pass` rows are deliberately NOT deleted here: they age out on their own and
-- removing them would be a destructive change with no benefit.
-- ---------------------------------------------------------------------------
