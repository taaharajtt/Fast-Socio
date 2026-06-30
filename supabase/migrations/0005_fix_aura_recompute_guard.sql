-- =============================================================================
-- FAST SOCIO — Fix: aura_score cache not updating for authenticated actions.
--
-- Bug: protect_profile_columns() resets aura_score to its old value whenever the
-- update runs as role 'authenticated' (to prevent self-escalation). But the
-- trusted recompute_aura_score() trigger ALSO updates profiles in that same
-- authenticated transaction (e.g. when a swipe creates a match), so the guard
-- clobbered the legitimate recompute and the cache stayed stale.
--
-- Fix: recompute_aura_score() sets a transaction-local flag while it writes;
-- protect_profile_columns() honors that flag as a trusted path.
-- =============================================================================

create or replace function public.recompute_aura_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
begin
  -- Mark this write as the trusted recompute path for the protect trigger.
  perform set_config('app.recompute_aura', '1', true);
  update public.profiles
     set aura_score = coalesce(
       (select sum(delta) from public.aura_transactions where user_id = target), 0)
   where id = target;
  perform set_config('app.recompute_aura', '0', true);
  return null;
end;
$$;

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  -- Trusted recompute path: allow the aura_score cache update through.
  if current_setting('app.recompute_aura', true) = '1' then
    return new;
  end if;

  -- Otherwise, authenticated users may not change privileged/cache columns.
  if auth.role() = 'authenticated' then
    new.aura_score := old.aura_score;
    new.is_admin   := old.is_admin;
    new.is_banned  := old.is_banned;
  end if;
  return new;
end;
$$;

-- Backfill any caches that drifted before this fix.
update public.profiles p
   set aura_score = coalesce(
     (select sum(delta) from public.aura_transactions a where a.user_id = p.id), 0)
 where aura_score <> coalesce(
     (select sum(delta) from public.aura_transactions a where a.user_id = p.id), 0);
