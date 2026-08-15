-- =============================================================================
-- FAST SOCIO — Verify the admin SQL console is gone (READ ONLY)
--
-- WHY THIS FILE EXISTS
-- Migration 0042 created public.admin_run_sql(text, boolean): an in-app SQL
-- console for super_admins. Migration 0067 dropped it, moving ad-hoc queries to
-- the Supabase dashboard editor, which is behind the Supabase account and its
-- 2FA rather than behind an application session cookie.
--
-- That drop is only as good as the live database. Three ways it can come back:
--   * 0067 was never applied to this environment, so 0042's function is still
--     sitting there.
--   * someone re-ran 0042 (or pasted its body) to debug something.
--   * a restore from a backup taken before 0067.
--
-- admin_run_sql is the single highest-value object that could exist in this
-- database: it is SECURITY DEFINER and takes arbitrary SQL, so reaching it once
-- — through a stolen admin session, an XSS, or a privilege-escalation bug like
-- the one on 2026-07-15 — converts directly into full database control. It is
-- worth a standing check of its own.
--
-- SAFETY: catalog SELECTs only. Nothing is created, changed or dropped. Safe to
-- run against production, which is the only environment where the answer counts.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste -> Run.
--
-- PASS: section 1 returns exactly one row reading 'PASS'.
--       Section 2 returns zero rows.
--
-- IF IT FAILS: do not just drop the function. Find out how it came back first —
-- the answer determines whether you are looking at a migration gap or an
-- intrusion. Then drop it:
--       drop function if exists public.admin_run_sql(text, boolean);
--   and check public.moderation_audit_log for what it was used for.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The named function, by exact identity.  Expect: one row, result = 'PASS'.
-- -----------------------------------------------------------------------------
select
  '1. admin_run_sql' as check,
  case when count(*) = 0 then 'PASS - absent'
       else 'FAIL - ' || count(*) || ' definition(s) present' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'admin_run_sql';


-- -----------------------------------------------------------------------------
-- 2. Anything else shaped like an arbitrary-SQL executor.  Expect: zero rows.
-- -----------------------------------------------------------------------------
-- Checking the one name is not enough: a replacement under a different name
-- (run_sql, exec_sql, admin_query, ...) is the same weakness. This looks for
-- the shape instead — a SECURITY DEFINER function that takes text and runs it —
-- by matching on both the name and the body.
--
-- The filter matches on a name that reads like a SQL runner, or on a body that
-- EXECUTEs a variable named like raw SQL. It deliberately does NOT match the
-- ordinary `execute format('... %I ...', ...)` idiom, so the generic row RPCs
-- from migration 0038 (admin_update_row, admin_insert_row, admin_delete_row,
-- admin_table_rows) correctly do not appear — verified empty against Frankfurt
-- on 2026-08-16. Those are reviewed separately; see migration 0149, which
-- constrains what the database browser may reach through them.
--
-- What must NOT appear is a function that executes a text argument directly.
select
  '2. SQL-EXECUTOR SHAPED' as check,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  case
    when p.prosrc ~* 'execute\s+(p_|v_)?(sql|query|stmt|statement)\b'
      then 'EXECUTES A TEXT ARGUMENT - investigate'
    else 'uses EXECUTE format(...) - review, usually fine'
  end as assessment
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and p.prosrc ~* '\mexecute\M'
  and (
    p.proname ~* '(run|exec|eval)_?(sql|query)'
    or p.proname ~* '_?(sql|query)_?(run|exec|eval)'
    or p.prosrc ~* 'execute\s+(p_|v_)?(sql|query|stmt|statement)\b'
  )
order by p.prosecdef desc, p.proname;


-- -----------------------------------------------------------------------------
-- 3. Historical use, if the function is or was present.  INVENTORY.
-- -----------------------------------------------------------------------------
-- The console wrote to the admin audit trail. If section 1 failed, this shows
-- whether it was actually used and by whom. Harmless when it returns nothing.
select
  '3. AUDIT TRAIL' as check,
  *
from public.moderation_audit_log
where action ilike '%sql%'
order by created_at desc
limit 100;
