-- M12: gated raw SQL console. super_admin only. A single statement per call;
-- read queries (select/with, with no data-modifying keyword) run wrapped and
-- capped at 1000 rows; anything else is treated as a write and requires an
-- explicit confirmation flag. Every execution is audited with the SQL text.
-- (Applied to the live DB as migration 0042_admin_sql_console.)
create or replace function public.admin_run_sql(p_query text, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_first text;
  v_read boolean;
  v_result jsonb;
  v_affected int;
begin
  perform public._admin_guard_super();
  if v_q = '' then raise exception 'empty query'; end if;

  if position(';' in btrim(v_q, E' ;\n\t\r')) > 0 then
    raise exception 'only a single statement is allowed';
  end if;

  v_first := lower(split_part(regexp_replace(v_q, '^[(\s]+', ''), ' ', 1));
  v_read := v_first in ('select', 'with');
  if v_read and v_q ~* '\m(insert|update|delete|drop|alter|truncate|create|grant|revoke|call|copy|reindex|vacuum|refresh)\M' then
    v_read := false;
  end if;

  if not v_read and not p_confirm then
    raise exception 'this statement can modify data — re-run with confirmation';
  end if;

  if v_read then
    execute format(
      'select coalesce(jsonb_agg(t), ''[]''::jsonb) from '
      || '(select * from (%s) uq limit 1000) t', v_q
    ) into v_result;
    perform public.log_admin_action('sql.read', left(v_q, 1000));
    return jsonb_build_object('mode', 'read', 'rows', v_result);
  else
    execute v_q;
    get diagnostics v_affected = row_count;
    perform public.log_admin_action('sql.write', left(v_q, 1000), null, null, null,
      jsonb_build_object('affected', v_affected));
    return jsonb_build_object('mode', 'write', 'affected', v_affected);
  end if;
end $$;

grant execute on function public.admin_run_sql(text, boolean) to authenticated;
