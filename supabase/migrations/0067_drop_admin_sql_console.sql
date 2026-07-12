-- =============================================================================
-- FAST SOCIO — Remove the admin SQL console.
--
-- Retires public.admin_run_sql and its /admin/sql UI. Ad-hoc database queries
-- now go through the Supabase Dashboard SQL editor (protected by the Supabase
-- account and its 2FA) rather than an in-app console. Least-privilege cleanup.
-- =============================================================================

drop function if exists public.admin_run_sql(text, boolean);
