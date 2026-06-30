-- =============================================================================
-- FAST SOCIO — Rate limiting (Phase 1 infrastructure)
-- Ships before Discover/Feed/Chat per MASTER_PLAN §6. A SECURITY DEFINER
-- function records and checks abuse-prone actions against rate_limit_events
-- (which has no client policies, so only this function can write to it).
-- =============================================================================

-- Returns TRUE if the caller may perform `p_action` now (and records the event);
-- FALSE if they have hit `p_max` occurrences within `p_window`.
create or replace function public.check_rate_limit(
  p_action text,
  p_max integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  recent integer;
begin
  if uid is null then
    return false; -- unauthenticated callers are never allowed
  end if;

  select count(*) into recent
  from public.rate_limit_events
  where user_id = uid
    and action = p_action
    and created_at > now() - p_window;

  if recent >= p_max then
    return false;
  end if;

  insert into public.rate_limit_events (user_id, action)
  values (uid, p_action);

  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, interval) from public;
grant execute on function public.check_rate_limit(text, integer, interval) to authenticated;

-- Housekeeping: prune events older than a day (called opportunistically or via
-- pg_cron later). Kept simple for Phase 1.
create or replace function public.prune_rate_limit_events()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limit_events where created_at < now() - interval '1 day';
$$;
