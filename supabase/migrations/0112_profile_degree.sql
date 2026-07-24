-- =============================================================================
-- FAST SOCIO — Degree selection within a school
--
-- `profiles.department` stores the SCHOOL (UAT-008, mig 0048). This adds a
-- `degree` column that narrows within that school (e.g. FSC -> CS/AI/SE/CY/DS),
-- mirroring the degree field `smart_match_posts` already has (mig 0105).
-- Purely additive: nullable, no backfill needed, no RLS change (profiles'
-- existing policies already cover every column).
-- =============================================================================

alter table public.profiles
  add column if not exists degree text
  check (degree is null or char_length(degree) <= 10);
