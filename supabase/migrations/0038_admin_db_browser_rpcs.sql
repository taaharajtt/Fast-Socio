-- M1: generic database-browser engine. All functions are SECURITY DEFINER and
-- hard-gated to super_admin; every mutation is audited. Identifiers are always
-- passed through format('%I'), literals through format('%L'), so the dynamic SQL
-- is injection-safe. Row read/write uses jsonb_populate_record against each
-- table's own rowtype, which casts jsonb values to the correct column types.
-- (Applied to the live DB as migration 0037_admin_db_browser_rpcs.)

create or replace function public._admin_guard_super()
returns void language plpgsql as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'not authorized: super_admin required';
  end if;
end $$;

create or replace function public._admin_assert_table(p_table text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = p_table
  ) then
    raise exception 'unknown table: %', p_table;
  end if;
end $$;

create or replace function public.admin_list_tables()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_guard_super();
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'name', c.relname,
      'kind', case c.relkind when 'r' then 'table' when 'v' then 'view'
                             when 'm' then 'matview' else c.relkind::text end,
      'rows', coalesce(s.n_live_tup, 0),
      'size', pg_size_pretty(pg_total_relation_size(c.oid)),
      'columns', (select count(*) from information_schema.columns col
                   where col.table_schema = 'public' and col.table_name = c.relname)
    ) as x
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    left join pg_stat_user_tables s on s.relid = c.oid
    where c.relkind in ('r', 'v', 'm')
  ) q;
  return v;
end $$;

create or replace function public.admin_table_meta(p_table text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cols jsonb; v_pk text[]; v_idx jsonb; v_fk jsonb;
begin
  perform public._admin_guard_super();
  perform public._admin_assert_table(p_table);

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', column_name, 'type', data_type,
           'nullable', is_nullable = 'YES', 'default', column_default
         ) order by ordinal_position), '[]'::jsonb)
  into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table;

  select array_agg(a.attname order by array_position(i.indkey, a.attnum))
  into v_pk
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;

  select coalesce(jsonb_agg(jsonb_build_object('name', indexname, 'def', indexdef)
           order by indexname), '[]'::jsonb)
  into v_idx
  from pg_indexes where schemaname = 'public' and tablename = p_table;

  select coalesce(jsonb_object_agg(col, ref), '{}'::jsonb) into v_fk
  from (
    select kcu.column_name as col,
           ccu.table_name || '.' || ccu.column_name as ref
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public' and tc.table_name = p_table
  ) f;

  return jsonb_build_object('columns', v_cols, 'pk', to_jsonb(coalesce(v_pk, '{}')), 'indexes', v_idx, 'fks', v_fk);
end $$;

create or replace function public.admin_table_rows(
  p_table text,
  p_limit int default 50,
  p_offset int default 0,
  p_search text default null,
  p_order_by text default null,
  p_order_dir text default 'asc'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_where text := '';
  v_order text := '';
  v_search text;
  v_rows jsonb;
  v_total bigint;
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform public._admin_guard_super();
  perform public._admin_assert_table(p_table);

  if p_search is not null and length(trim(p_search)) > 0 then
    select string_agg(format('%I::text ilike %L', column_name, '%' || p_search || '%'), ' or ')
    into v_search
    from information_schema.columns
    where table_schema = 'public' and table_name = p_table
      and data_type in ('text', 'character varying', 'character', 'uuid');
    if v_search is not null then v_where := 'where (' || v_search || ')'; end if;
  end if;

  if p_order_by is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_order_by
  ) then
    v_order := format('order by %I %s', p_order_by,
      case when lower(coalesce(p_order_dir, 'asc')) = 'desc' then 'desc' else 'asc' end);
  end if;

  execute format('select count(*) from public.%I %s', p_table, v_where) into v_total;
  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from '
    || '(select * from public.%I %s %s limit %s offset %s) t',
    p_table, v_where, v_order, v_lim, v_off
  ) into v_rows;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_lim, 'offset', v_off);
end $$;

create or replace function public.admin_update_row(
  p_table text, p_pk_col text, p_pk_val text, p_row jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_set text; v_before jsonb; v_after jsonb;
begin
  perform public._admin_guard_super();
  perform public._admin_assert_table(p_table);
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=p_table and column_name=p_pk_col) then
    raise exception 'unknown pk column: %', p_pk_col;
  end if;

  select string_agg(format('%I = r.%I', k, k), ', ') into v_set
  from jsonb_object_keys(p_row) as k
  where k <> p_pk_col
    and exists (select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=p_table and c.column_name=k);
  if v_set is null then raise exception 'no updatable columns supplied'; end if;

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = %L',
    p_table, p_pk_col, p_pk_val) into v_before;

  execute format(
    'update public.%I t set %s from (select * from jsonb_populate_record(null::public.%I, %L::jsonb)) r '
    || 'where t.%I::text = %L returning to_jsonb(t)',
    p_table, v_set, p_table, p_row::text, p_pk_col, p_pk_val
  ) into v_after;

  perform public.log_admin_action('db.update:' || p_table, null, null, v_before, v_after,
    jsonb_build_object('table', p_table, 'pk_col', p_pk_col, 'pk', p_pk_val));
  return v_after;
end $$;

create or replace function public.admin_insert_row(p_table text, p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_after jsonb;
begin
  perform public._admin_guard_super();
  perform public._admin_assert_table(p_table);
  execute format(
    'with ins as (insert into public.%I select * from jsonb_populate_record(null::public.%I, %L::jsonb) returning *) '
    || 'select to_jsonb(ins) from ins',
    p_table, p_table, p_row::text
  ) into v_after;
  perform public.log_admin_action('db.insert:' || p_table, null, null, null, v_after,
    jsonb_build_object('table', p_table));
  return v_after;
end $$;

create or replace function public.admin_delete_row(p_table text, p_pk_col text, p_pk_val text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform public._admin_guard_super();
  perform public._admin_assert_table(p_table);
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=p_table and column_name=p_pk_col) then
    raise exception 'unknown pk column: %', p_pk_col;
  end if;
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = %L',
    p_table, p_pk_col, p_pk_val) into v_before;
  execute format('delete from public.%I t where t.%I::text = %L', p_table, p_pk_col, p_pk_val);
  perform public.log_admin_action('db.delete:' || p_table, null, null, v_before, null,
    jsonb_build_object('table', p_table, 'pk_col', p_pk_col, 'pk', p_pk_val));
end $$;

grant execute on function public.admin_list_tables() to authenticated;
grant execute on function public.admin_table_meta(text) to authenticated;
grant execute on function public.admin_table_rows(text, int, int, text, text, text) to authenticated;
grant execute on function public.admin_update_row(text, text, text, jsonb) to authenticated;
grant execute on function public.admin_insert_row(text, jsonb) to authenticated;
grant execute on function public.admin_delete_row(text, text, text) to authenticated;
