-- =============================================================================
-- FAST SOCIO — Refactor Phase 9 hotfix: restore the current_user guard on
-- protect_profile_columns (regression of P1-04 / mig 0022).
--
-- Migrations 0051, 0055 and 0060 each rewrote protect_profile_columns to guard
-- on `auth.role() = 'authenticated'` while adding new columns (completeness, xp,
-- level, shadow_banned, posting_restricted_until, suspended_until). But — as
-- mig 0022 documented and verified — auth.role() still resolves to
-- 'authenticated' INSIDE a SECURITY DEFINER function, so that guard reverts
-- every legitimate definer/admin write:
--   * aura_score / xp / level never update from real authenticated actions
--     (award-* triggers → recompute_* → this trigger reverts the write);
--   * issue_strike / set_shadow_ban silently no-op (restriction reverted).
--
-- Verified live via rolled-back repros (2026-07-11): a non-anonymous post moved
-- aura_score 72→72 (delta 0) and issue_strike left posting_restricted_until null.
--
-- FIX: guard on `current_user` (the function owner, `postgres`, inside any
-- SECURITY DEFINER body; `authenticated` for a direct PostgREST write). This is
-- the exact remedy from mig 0022, now covering every guarded column.
-- =============================================================================

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  -- Only constrain writes made directly by an end user (PostgREST SET ROLE
  -- authenticated). Trigger-driven / admin writes run under the definer's owner
  -- role (postgres) and must pass so the caches + moderation columns update.
  if current_user = 'authenticated' then
    new.aura_score               := old.aura_score;
    new.is_admin                 := old.is_admin;
    new.is_banned                := old.is_banned;
    new.xp                       := old.xp;
    new.level                    := old.level;
    new.completeness             := old.completeness;
    new.shadow_banned            := old.shadow_banned;
    new.posting_restricted_until := old.posting_restricted_until;
    new.suspended_until          := old.suspended_until;
  end if;
  return new;
end;
$$;
