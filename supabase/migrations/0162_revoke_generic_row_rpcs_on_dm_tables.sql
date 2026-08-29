-- =============================================================================
-- FAST SOCIO — Close the generic-row-RPC bypasses around DM content (P0 fix)
--
-- WHY THIS EXISTS
-- Migration 0160 added admin_browser_table_rows() as a read guard for the
-- /admin/database browser and pointed the UI at it. That was necessary and
-- insufficient: it guarded the DOOR while leaving the WALL open. The underlying
-- public.admin_table_rows() was granted to `authenticated` by migration 0038
-- and stayed granted, so a super_admin could skip the wrapper entirely and
-- reach the same rows through PostgREST:
--
--     supabase.rpc('admin_table_rows', { p_table: 'messages', p_search: '…' })
--
-- which is precisely the unrestricted DM browser Phase 2 exists to remove. A
-- guard that only the application calls is a UI convention, not a control.
--
-- THE SAME MISTAKE, TWICE MORE
-- Auditing that bypass turned up two siblings of it that 0160 also missed, both
-- reachable today by any super_admin:
--
--   1. admin_update_row() RETURNS the updated row as jsonb (`v_after`). It is
--      nominally a writer, so it was never considered a read path — but
--
--          admin_update_row('messages', 'id', '<uuid>', '{"hidden": false}')
--
--      returns that message's full row, body included. A no-op write is a read.
--      Migration 0149's denylist does not cover it because that denylist names
--      audit/session tables and `messages` was never on the list.
--
--   2. admin_delete_row() captures `to_jsonb(t)` of the row into
--      moderation_audit_log.before_data before deleting it. Pointed at
--      `messages` that both destroys a private message and mints a second
--      plaintext copy of it inside the audit trail — the exact behaviour that
--      migration 0160 removed from admin_delete_content('message').
--
-- WHY THE FIX DIFFERS BETWEEN THE READER AND THE WRITERS
-- admin_table_rows has exactly one caller left in the codebase after 0160 — the
-- wrapper — so its grant can simply be revoked.
--
-- The three mutators cannot be revoked: migration 0149 documented, correctly,
-- that the dedicated admin actions call them directly on purpose
-- (users/actions.ts -> profiles, communities, events, matching -> matches and
-- message_requests). Revoking them would break working, audited features.
--
-- So the mutators get a hard floor INSIDE the function instead. Note this is
-- NOT the thing 0149 declined to do. 0149 refused to denylist profiles COLUMNS
-- inside admin_update_row, because the dedicated actions legitimately write
-- those exact columns. Nothing in this product has ever legitimately written
-- `messages`, `conversations`, `message_reactions` or the report-evidence
-- tables through a generic row editor, so a table-level floor for those breaks
-- nothing and cannot drift.
--
-- ONE LIST, THREE ENFORCEMENT POINTS
-- The protected set now lives in _dm_protected_tables() and is consumed by the
-- read guard (0160), the write floor (here) and the browser guard (0149), so
-- the three cannot disagree. As in 0149, the list is hardcoded on purpose: a
-- table naming the tables the browser may not touch would itself be a table the
-- browser could edit.
--
-- APPLY ORDER: after 0160 and 0161. This migration replaces functions created
-- by 0038, 0149 and 0160.
--
-- ROLLBACK
-- Additive; no table, column or row is touched. To roll back:
--   grant execute on function public.admin_table_rows(text,int,int,text,text,text)
--     to authenticated;
-- and re-run 0038's definitions of the three mutators to drop the floor. Doing
-- so restores the bypasses described above, so it should not be done.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The protected set — one definition, used by every guard.
-- -----------------------------------------------------------------------------
-- The common thread: every table here holds the content of a private one-to-one
-- exchange, or the evidence disclosed from one. Each already has a purpose-built
-- surface (the participant's own thread; the audited report RPCs from 0161).
-- The generic row RPCs are a second path around both.
create or replace function public._dm_protected_tables()
returns text[] language sql immutable as $$
  select array[
    'messages',            -- one-to-one DM bodies and attachment paths
    'conversations',       -- the DM participant graph
    'message_reactions',   -- reveals which DMs exist, between whom, and when
    'message_requests',    -- the opening message of a DM: private user text
    'dm_report_cases',     -- report metadata; read via the audited RPC (0161)
    'dm_report_messages'   -- disclosed evidence; read via the audited RPC (0161)
  ]::text[]
$$;

revoke execute on function public._dm_protected_tables() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. THE P0: revoke the raw reader.
-- -----------------------------------------------------------------------------
-- Postgres grants EXECUTE on functions to PUBLIC by default, and Supabase's
-- default privileges additionally grant it to anon, so revoking the explicit
-- 0038 grant to `authenticated` alone would leave two other routes open. All
-- three are named.
--
-- This does NOT stop admin_browser_table_rows() from calling it. That wrapper
-- is SECURITY DEFINER, so its body executes as the function OWNER, and an owner
-- retains EXECUTE on its own functions regardless of what is revoked from
-- PUBLIC, anon or authenticated. Section 8 of
-- supabase/tests/dm_reporting_verification.sql proves this both by catalog
-- (same owner) and by behaviour (the wrapper still returns rows).
revoke execute on function public.admin_table_rows(text, int, int, text, text, text)
  from public, anon, authenticated;

comment on function public.admin_table_rows(text, int, int, text, text, text) is
  'INTERNAL. Not executable by authenticated: call admin_browser_table_rows, which applies the DM/evidence read guard. See migration 0162.';


-- -----------------------------------------------------------------------------
-- 3. Point 0160's read guard at the shared list.
-- -----------------------------------------------------------------------------
-- Same behaviour as 0160 plus message_requests, now sourced from one place.
create or replace function public._admin_browser_read_denied_tables()
returns text[] language sql immutable as $$
  select public._dm_protected_tables()
$$;

create or replace function public._admin_browser_read_guard(p_table text)
returns void language plpgsql stable as $$
begin
  if p_table = any (public._dm_protected_tables()) then
    raise exception
      'the database browser cannot read %: this table holds private message content or moderation evidence',
      p_table
      using hint = 'DM content is disclosed only through a participant report at /admin/dm-reports.';
  end if;
end $$;

revoke execute on function public._admin_browser_read_denied_tables() from public, anon, authenticated;
revoke execute on function public._admin_browser_read_guard(text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. The write floor, inside the mutators themselves.
-- -----------------------------------------------------------------------------
-- Raises for any protected table regardless of caller — the browser wrappers,
-- the dedicated admin actions, or a direct PostgREST call. There is no
-- legitimate caller to break: the dedicated actions target profiles,
-- communities, events, matches and message_requests, and message_requests is
-- write-permitted below for exactly that reason.
create or replace function public._dm_write_floor(p_table text, p_op text)
returns void language plpgsql stable as $$
begin
  -- message_requests is on the READ protected list (its `message` column is
  -- private user text) but must stay writable: /admin/matching deletes them as
  -- a working, audited feature. Deleting one still snapshots its text into
  -- moderation_audit_log.before_data — a known residual, recorded in
  -- docs/DM-SELECTIVE-REPORTING-DESIGN.md rather than silently broken here.
  if p_table = 'message_requests' then
    return;
  end if;

  if p_table = any (public._dm_protected_tables()) then
    raise exception
      'the generic row RPCs cannot % %: private message content and report evidence are not editable through a row editor',
      p_op, p_table
      using hint = 'Use the report-scoped action on the case at /admin/dm-reports. Report evidence is immutable by design.';
  end if;
end $$;

revoke execute on function public._dm_write_floor(text, text) from public, anon, authenticated;

-- 0038's bodies, unchanged except for the floor. Kept verbatim otherwise so a
-- diff against 0038 shows exactly one addition per function.
create or replace function public.admin_update_row(
  p_table text, p_pk_col text, p_pk_val text, p_row jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_set text; v_before jsonb; v_after jsonb;
begin
  perform public._admin_guard_super();
  -- A no-op UPDATE returns the whole row, so this is a read guard as much as a
  -- write guard.
  perform public._dm_write_floor(p_table, 'update');
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
  perform public._dm_write_floor(p_table, 'insert into');
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
  -- The before-snapshot would copy the row, body included, into the audit log.
  perform public._dm_write_floor(p_table, 'delete from');
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


-- -----------------------------------------------------------------------------
-- 5. Extend 0149's browser write denylist to the same set.
-- -----------------------------------------------------------------------------
-- Redundant after section 4 — and deliberately so. Section 4 is the floor;
-- this is the door, and it produces the clearer error inside the browser UI.
create or replace function public._admin_browser_denied_tables()
returns text[] language sql immutable as $$
  select array[
    -- 0149: audit, session and device state.
    'moderation_audit_log',
    'security_events',
    'rate_limit_events',
    'user_sessions',
    'profile_private',
    'push_subscriptions'
  ]::text[] || public._dm_protected_tables()
$$;

revoke execute on function public._admin_browser_denied_tables() from public, anon, authenticated;
