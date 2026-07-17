-- =============================================================================
-- FAST SOCIO — F14: strip TRUNCATE / REFERENCES / TRIGGER from client roles
--
-- Supabase's default `GRANT ALL` on public tables hands `anon` and
-- `authenticated` three privileges no client has ever needed:
--
--   * TRUNCATE  -- the dangerous one. TRUNCATE is NOT gated by RLS: a row
--                  policy cannot stop it, because it never evaluates rows. Any
--                  authenticated user could empty a table outright. With no
--                  PITR and no scheduled backups on the free tier (F20), that
--                  is unrecoverable data loss, not an inconvenience.
--   * REFERENCES -- lets a role create FKs pointing at the table, which can pin
--                  rows against deletion and leak existence of values.
--   * TRIGGER    -- lets a role attach triggers to the table, i.e. run their own
--                  code inside other users' writes.
--
-- None of these are reachable through PostgREST's data API, so revoking them
-- cannot break the app -- it removes privileges the client could only ever use
-- via a direct SQL connection.
--
-- Applied across every table in `public` and to the default privileges for
-- future tables, so the GRANT ALL default cannot quietly reintroduce them (F5's
-- "new-table convention"). SECURITY DEFINER RPCs run as the table owner and are
-- unaffected.
--
-- Idempotent: revoking a privilege that is not held is a no-op.
-- =============================================================================

do $$
declare
  t record;
begin
  for t in
    select quote_ident(schemaname) || '.' || quote_ident(tablename) as fqtn
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, references, trigger on %s from anon, authenticated',
      t.fqtn
    );
  end loop;
end $$;

-- Stop the same three privileges from being granted on tables created later.
-- Scoped to the roles that own objects in `public` so future migrations inherit
-- the tightened default rather than re-granting ALL.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
