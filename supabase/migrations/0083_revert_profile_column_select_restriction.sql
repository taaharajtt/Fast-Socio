-- =============================================================================
-- FAST SOCIO — Revert the column-level SELECT restriction from 0082
--
-- Postgres requires table-level SELECT for INSERT ... ON CONFLICT DO UPDATE on
-- the written columns, so 0082 broke the onboarding upsert (which writes the
-- private preference columns). Restore the original table-level SELECT grants.
-- VULN-04 column-hiding is deferred to a dedicated schema change (owner-only
-- prefs table) so it does not conflict with the upsert write path.
-- =============================================================================

grant select on public.profiles to authenticated;
grant select on public.profiles to anon;

drop function if exists public.get_my_profile();
