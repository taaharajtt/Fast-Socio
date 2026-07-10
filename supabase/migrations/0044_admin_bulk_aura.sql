-- M7: bulk aura grant. super_admin only. Loops the existing audited
-- admin_adjust_aura (which inserts the ledger row + updates the score + audits)
-- over a user segment, then logs a summary row. Returns affected user count.
-- (Applied to the live DB as migration 0044_admin_bulk_aura.)
create or replace function public.admin_bulk_aura(
  p_delta int, p_reason text, p_segment text default 'all', p_department text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  perform public._admin_guard_super();
  if coalesce(p_delta, 0) = 0 then raise exception 'delta must be non-zero'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason is required'; end if;

  for r in
    select id from public.profiles
    where not is_banned and onboarding_completed
      and (p_department is null or department = p_department)
      and (p_segment = 'all' or (p_segment = 'verified' and verified))
  loop
    perform public.admin_adjust_aura(r.id, p_delta, p_reason);
    v_count := v_count + 1;
  end loop;

  perform public.log_admin_action('aura.bulk', p_reason, null, null, null,
    jsonb_build_object('delta', p_delta, 'segment', p_segment,
                       'department', p_department, 'count', v_count));
  return v_count;
end $$;

grant execute on function public.admin_bulk_aura(int, text, text, text) to authenticated;
