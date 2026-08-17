-- =============================================================================
-- FAST SOCIO — RLS coverage audit (READ ONLY)
--
-- The migrations in this repo do a lot of RLS work, but the repo cannot prove
-- what is actually true in the live database: policies drift out of band (see
-- migration 0078, where a GRANT vanished with no migration behind it), and a
-- table added through the dashboard has no migration at all. This script is the
-- check that closes that gap.
--
-- SAFETY: every statement here is a SELECT against the catalog. It creates
-- nothing, changes nothing and locks nothing. It is safe to run against
-- production, and it is meant to be — that is the only place the answer is real.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste -> Run. Read each section's
--   heading; a section that returns zero rows is a pass.
--
--   Do NOT wire this into CI against production. Run it by hand at launch and
--   after any migration that adds a table or changes a policy.
--
-- WHAT "PASS" MEANS
--   Section 1 must be empty. Sections 2-7 are inventories to read, not pass/fail
--   gates — each has a known-expected set documented above it. Verified against
--   the Frankfurt project on 2026-08-16; the expected sets below are what it
--   actually returned, so a future run that differs is the signal.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tables with RLS DISABLED.  Expected result: zero rows.
-- -----------------------------------------------------------------------------
-- Any base table in `public` is reachable by the `anon` and `authenticated`
-- roles through PostgREST. With RLS off, the only thing standing between a
-- logged-in student and the whole table is the table-level GRANT — which for
-- this project is usually wide open. Treat every row here as a live exposure
-- until proven otherwise.
select
  '1. RLS DISABLED' as check,
  c.relname        as table_name,
  case when c.relrowsecurity then 'enabled' else 'DISABLED' end as rls,
  pg_catalog.obj_description(c.oid, 'pg_class') as comment
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'          -- ordinary tables only
  and not c.relrowsecurity
order by c.relname;


-- -----------------------------------------------------------------------------
-- 2. Tables with RLS enabled but NO policies.  REVIEW — not a failure by itself.
-- -----------------------------------------------------------------------------
-- RLS with no policy denies everything to anon and authenticated. For this
-- codebase that is frequently the INTENDED design, not an oversight: several
-- features are reached only through SECURITY DEFINER RPCs and masking views,
-- which run as the owner and bypass RLS, so the base table is deliberately
-- sealed against direct PostgREST access.
--
-- Known-expected on 2026-08-16 (all deny-all by design — confirm before
-- assuming any of them is a bug):
--   help_requests, help_responses      reached via help_request_feed /
--                                      help_response_feed and the Campus Help
--                                      RPCs (migrations 0102, 0106, 0109)
--   society_announcements              reached via society_announcement_feed
--   rate_limit_events                  written only by check_rate_limit()
--
-- What to actually look for: a NEW name appearing here. That is either a dead
-- table (drop it) or a feature whose reads are silently failing — and the usual
-- fix under time pressure is a permissive catch-all policy, which is how a
-- `using (true)` ends up in section 3.
select
  '2. RLS ON, NO POLICIES' as check,
  c.relname                as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policy p where p.polrelid = c.oid
  )
order by c.relname;


-- -----------------------------------------------------------------------------
-- 3. Policies that are unconditionally true.  REVIEW EACH ONE.
-- -----------------------------------------------------------------------------
-- A `using (true)` policy is not automatically wrong: several tables here are
-- meant to be readable campus-wide. It IS wrong on anything holding private
-- data, and it is almost always wrong on INSERT/UPDATE/DELETE. The point of
-- this section is that every one of these should be a decision someone made on
-- purpose, not a leftover.
select
  '3. PERMISSIVE (true)' as check,
  c.relname              as table_name,
  p.polname              as policy,
  case p.polcmd
    when 'r' then 'SELECT' when 'a' then 'INSERT'
    when 'w' then 'UPDATE' when 'd' then 'DELETE'
    else 'ALL' end       as command,
  pg_get_expr(p.polqual, p.polrelid)      as using_expr,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (
    coalesce(pg_get_expr(p.polqual, p.polrelid), '') in ('true', '(true)')
    or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') in ('true', '(true)')
  )
order by c.relname, p.polname;


-- -----------------------------------------------------------------------------
-- 4. Write policies reachable by `anon`.  REVIEW the ones flagged CHECK MANUALLY.
-- -----------------------------------------------------------------------------
-- A policy created without a `TO` clause applies to PUBLIC, which includes
-- anon. Most policies in this database are written that way, so matching on the
-- role alone flags almost every write policy and tells you nothing.
--
-- What makes a PUBLIC write policy safe here is its EXPRESSION: nearly all of
-- them are scoped by `auth.uid()`, which is null for an anonymous caller, so
-- the policy can never grant anything to anon. The `scoping` column below makes
-- that the sort key, so the interesting rows come first.
--
-- Known-expected on 2026-08-16: four rows, three of them auth.uid()-scoped
-- (posts, profile_private x2). The fourth — community_chat_messages "authorized
-- may tombstone community chat" — delegates to can_delete_community_message(),
-- whose four branches each resolve `auth.uid()` themselves (author, community
-- owner/moderator, society officer, admin), so all four are null for anon and
-- the policy grants it nothing. Verified by reading the function body on
-- 2026-08-16. It is still correctly surfaced here: the safety lives one call
-- away from the policy, which is exactly the case a human should re-check.
select
  '4. ANON-REACHABLE WRITE' as check,
  c.relname                 as table_name,
  p.polname                 as policy,
  case p.polcmd
    when 'a' then 'INSERT' when 'w' then 'UPDATE'
    when 'd' then 'DELETE' else 'ALL' end as command,
  case
    when coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%auth.uid%'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%auth.uid%'
      then 'scoped by auth.uid() - safe for anon'
    else 'CHECK MANUALLY - no auth.uid() in the expression'
  end as scoping,
  pg_get_expr(p.polqual, p.polrelid)      as using_expr,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and p.polcmd in ('a', 'w', 'd', '*')
  and exists (
    select 1 from unnest(p.polroles) r
    where r = 'anon'::regrole or r = 0   -- 0 == PUBLIC
  )
order by scoping, c.relname, p.polname;


-- -----------------------------------------------------------------------------
-- 5. Table-level privileges held by anon / authenticated.  INVENTORY.
-- -----------------------------------------------------------------------------
-- RLS filters rows; GRANTs decide whether the role may touch the table or the
-- column at all. Migration 0084 turned profiles into a column-level allowlist
-- for exactly this reason. Read this next to section 1: a table with RLS off
-- and a wide GRANT is the bad combination.
--
-- Observed on 2026-08-16: `anon` holds SELECT, INSERT, UPDATE and DELETE on
-- essentially every table, including moderation_audit_log. That is Supabase's
-- default grant to the anon role, not something this project did, and RLS is
-- what actually stops it — every table came back RLS-enabled in section 1, so
-- the grants are inert today.
--
-- It is still worth knowing, because it sets the failure mode: if RLS is ever
-- disabled on one table, or a policy is ever widened to `using (true)` for a
-- write command, the grant is already there and the exposure is immediate and
-- anonymous. Section 1 is not a formality.
select
  '5. GRANTS' as check,
  table_name,
  grantee,
  string_agg(distinct privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by grantee, table_name;


-- -----------------------------------------------------------------------------
-- 6. SECURITY DEFINER functions executable by anon / authenticated. INVENTORY.
-- -----------------------------------------------------------------------------
-- These run as their owner and therefore bypass RLS, column GRANTs and any
-- trigger gated on `current_user = 'authenticated'`. They are the real
-- privilege boundary in this database — more so than the policies above — so
-- the list should be short enough to read, and every entry should have its own
-- authorization check in its body.
--
-- Two things to look for:
--   * `config` empty  ->  no `set search_path`, which is a search-path
--     hijacking risk for a SECURITY DEFINER function. Should be non-empty.
--   * a function executable by `anon` that does anything privileged.
select
  '6. SECURITY DEFINER' as check,
  p.proname             as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_userbyid(p.proowner)               as owner,
  coalesce(array_to_string(p.proconfig, ', '), '(no search_path set)') as config,
  case when has_function_privilege('anon', p.oid, 'execute')
       then 'anon+authenticated' else 'authenticated' end as callable_by
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (
    has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute')
  )
order by callable_by desc, p.proname;


-- -----------------------------------------------------------------------------
-- 7. Views owned by a superuser-ish role.  INVENTORY.
-- -----------------------------------------------------------------------------
-- A view runs with its owner's privileges unless it is declared
-- `security_invoker`. An owner-privileged view over an RLS-protected table
-- hands out exactly the rows RLS was meant to withhold. The masking views used
-- by Campus Help (migration 0102) are intentional and should appear here; a
-- view you do not recognise should not.
select
  '7. VIEWS' as check,
  c.relname  as view_name,
  pg_get_userbyid(c.relowner) as owner,
  case when c.reloptions::text like '%security_invoker=true%'
       then 'security_invoker' else 'OWNER privileges' end as runs_as
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v', 'm')
order by runs_as, c.relname;
