-- =============================================================================
-- FAST SOCIO — Fix protect_profile_columns clobbering privileged writes (P1-04)
--
-- ⚠️  DO NOT APPLY until the Phase-1 repro confirms the bug on the live DB
--     (see the audit's P1-04 verification steps). Safe in both outcomes, but
--     gated on evidence per the audit's "no speculative fixes" rule.
--
-- ROOT CAUSE: protect_profile_columns guarded on `auth.role() = 'authenticated'`.
-- auth.role() reads the PostgREST request GUC (request.jwt.claim.role), which a
-- SECURITY DEFINER function does NOT reset — so the guard also fires during the
-- privileged writes made by recompute_aura_score(), admin_set_ban() and
-- admin_adjust_aura(), reverting aura_score / is_banned back to their old values
-- (silent admin-ban no-op + stale aura cache).
--
-- FIX: guard on `current_user` instead. PostgREST runs a direct end-user write
-- as role `authenticated`, but a SECURITY DEFINER function executes as its owner
-- (postgres), so current_user is NOT 'authenticated' there — privileged writes
-- pass while direct self-escalation is still blocked. service_role writes
-- (admin client) also pass, as intended.
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
