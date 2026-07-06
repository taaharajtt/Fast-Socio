-- =============================================================================
-- FAST SOCIO — Phase 1 audit: DB-level verification & regression checks
--
-- STATUS: NOT YET EXECUTED — requires read/write access to the live project
-- (Supabase PAT via MCP, or the pooler Postgres password). Every mutating check
-- is wrapped in BEGIN … ROLLBACK so it leaves no state behind. Run each block
-- and read the RAISE NOTICE output.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- P1-04 (a): Diagnose — is protect_profile_columns still gated on auth.role()?
-- Read-only. Confirms whether the bug exists before applying 0022.
-- -----------------------------------------------------------------------------
select pg_get_functiondef('public.protect_profile_columns()'::regprocedure) as current_definition;
-- Expect the CURRENT (buggy) version to contain: if auth.role() = 'authenticated'
-- After 0022 is applied it should contain: if current_user = 'authenticated'


-- -----------------------------------------------------------------------------
-- P1-04 (b): Diagnose — does the aura_score cache match the ledger?
-- Read-only. Any row returned = the recompute trigger's write was reverted.
-- -----------------------------------------------------------------------------
select p.id,
       p.aura_score                                           as cached,
       coalesce((select sum(t.delta) from public.aura_transactions t
                 where t.user_id = p.id), 0)                  as ledger
from public.profiles p
where p.aura_score <> coalesce(
        (select sum(t.delta) from public.aura_transactions t where t.user_id = p.id), 0)
limit 50;
-- 0 rows  -> aura cache is consistent (aura half of P1-04 not reproducing)
-- N rows  -> CONFIRMED: recompute_aura_score writes are being clobbered


-- -----------------------------------------------------------------------------
-- P1-04 (c): Diagnose — does admin_set_ban actually persist? (mutating, rolled back)
-- Pick a real non-admin test uid for :test_uid before running.
-- -----------------------------------------------------------------------------
-- begin;
--   -- Impersonate the admin request context the RPC expects.
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<ADMIN_UID>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select public.admin_set_ban('<TEST_UID>'::uuid, true, 'p1-04 repro');
--   reset role;
--   select id, is_banned from public.profiles where id = '<TEST_UID>';
--   -- is_banned = false -> CONFIRMED: ban silently no-ops (P1-04 real, P0-adjacent)
--   -- is_banned = true  -> ban persists (ban half not reproducing)
-- rollback;


-- -----------------------------------------------------------------------------
-- P1-04 (d): Regression — AFTER applying 0022, aura recompute must stick.
-- Mutating, rolled back. Pick a real :test_uid.
-- -----------------------------------------------------------------------------
-- begin;
--   select aura_score as before from public.profiles where id = '<TEST_UID>';
--   insert into public.aura_transactions (user_id, delta, reason)
--     values ('<TEST_UID>'::uuid, 7, 'admin_adjust');
--   select aura_score as after_ from public.profiles where id = '<TEST_UID>';
--   -- after_ must equal before + 7
-- rollback;


-- -----------------------------------------------------------------------------
-- P1-02: Regression — signup email-domain trigger (after 0021 applied).
-- Mutating, rolled back. Isolates the BEFORE INSERT trigger on auth.users.
-- -----------------------------------------------------------------------------
-- Off-domain must be rejected:
-- begin;
--   insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
--   values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
--           'authenticated', 'authenticated', 'attacker@gmail.com', now(), now());
--   -- EXPECT: ERROR "Signups are restricted to @nu.edu.pk email addresses"
-- rollback;
--
-- On-domain must pass the trigger (may still hit later constraints; that's fine
-- — we only assert the domain trigger does NOT raise):
-- begin;
--   insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
--   values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
--           'authenticated', 'authenticated', 'k99-9999@nu.edu.pk', now(), now());
--   -- EXPECT: no domain error (insert succeeds or fails on an unrelated column)
-- rollback;
