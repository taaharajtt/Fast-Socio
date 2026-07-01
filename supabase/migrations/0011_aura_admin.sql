-- =============================================================================
-- FAST SOCIO — Aura System (Phase 7)
-- The Aura ledger (aura_transactions) + trigger-cached aura_score already exist
-- and are enforced (Phase 1). This adds the admin manual-adjustment tool: an
-- audited SECURITY DEFINER function that appends an admin_adjust transaction and
-- logs it. Clients still cannot write aura_transactions directly.
-- =============================================================================

create or replace function public.admin_adjust_aura(
  p_user_id uuid,
  p_delta integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;
  if p_delta = 0 then
    raise exception 'delta must be non-zero';
  end if;

  insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (p_user_id, p_delta, 'admin_adjust',
            jsonb_build_object('reason', p_reason, 'admin', admin_id));

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    values (admin_id, 'aura_adjust', 'profile', p_user_id, trim(p_reason),
            jsonb_build_object('delta', p_delta));
end;
$$;

revoke all on function public.admin_adjust_aura(uuid, integer, text) from public;
grant execute on function public.admin_adjust_aura(uuid, integer, text) to authenticated;
