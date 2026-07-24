-- =============================================================================
-- FAST SOCIO — fix missing column grant on profiles.degree
--
-- `authenticated` has a column-scoped UPDATE grant on public.profiles (e.g.
-- full_name, department, ...). Adding `degree` via ALTER TABLE (mig 0112) does
-- not extend that existing column-privilege list, so every autosave/finalize
-- write from the client hit "permission denied for table profiles" the moment
-- it touched degree. Table-level RLS was fine; this is a plain GRANT gap.
-- =============================================================================

grant update (degree) on public.profiles to authenticated;
