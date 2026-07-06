-- =============================================================================
-- FAST SOCIO — Fix protect_profile_columns clobbering admin_set_ban (P1-04)
--
-- VERIFIED against the live DB (rolled-back repros, 2026-07-06):
--   * admin_set_ban(target, true) leaves is_banned = FALSE — a silent no-op.
--     Banning a user does nothing; the middleware never sees is_banned, so a
--     malicious user cannot actually be banned. (P0-adjacent moderation failure.)
--   * The aura cache is NOT affected: recompute_aura_score runs nested inside
--     the award-* SECURITY DEFINER triggers and its writes DO land (a real
--     authenticated post correctly moved aura_score 0 -> 2 in testing).
--
-- ROOT CAUSE: protect_profile_columns guarded on `auth.role() = 'authenticated'`.
-- For a direct RPC like admin_set_ban(), auth.role() still resolves to
-- 'authenticated' inside the SECURITY DEFINER body, so the guard reverts the
-- is_banned write. current_user, by contrast, is the function owner (verified:
-- `postgres`) inside any SECURITY DEFINER function.
--
-- FIX: guard on `current_user`. Direct end-user writes run as role
-- `authenticated` (protection intact — self-escalation still blocked, verified);
-- SECURITY DEFINER / admin writes run as the owner and now pass. Validated
-- in a rolled-back transaction: ban persists, aura unaffected, is_admin still
-- protected against direct self-escalation.
-- =============================================================================

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  -- Only constrain writes made directly by an end user (PostgREST SET ROLE
  -- authenticated). Trigger-driven / admin writes run under the definer's role.
  if current_user = 'authenticated' then
    new.aura_score := old.aura_score;
    new.is_admin   := old.is_admin;
    new.is_banned  := old.is_banned;
  end if;
  return new;
end;
$$;
