-- =============================================================================
-- FAST SOCIO — Allow the Alumni sentinel in profiles.semester
--
-- Pre-2023 batches (legacy @nu.edu.pk signups, mig 0097) are graduates with no
-- current semester. The UI now offers an "Alumni" pill that stores the sentinel
-- value 13 (ALUMNI_SEMESTER in src/lib/profile/constants.ts); widen the column
-- check (0001_init_foundation.sql: between 1 and 12) to admit it. Discover's
-- distance-based semester affinity needs no change: |13 - s| caps at 4 → zero
-- affinity with current students, full affinity between two alumni.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.profiles
  drop constraint if exists profiles_semester_check;

alter table public.profiles
  add constraint profiles_semester_check check (semester between 1 and 13);
