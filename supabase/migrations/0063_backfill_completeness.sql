-- =============================================================================
-- FAST SOCIO — Refactor Phase 10 polish: backfill profile completeness.
--
-- profiles.completeness (mig 0051) is a cache written only by
-- award_completion_bonus(), so every user onboarded before Phase 2 sat at a
-- stale 0. The Phase 10 profile completeness meter surfaces that value, so it
-- must be accurate. Recompute it for everyone from the current profile.
--
-- Runs as the migration role (not `authenticated`), so protect_profile_columns
-- lets the completeness write land. Pure cache write — no ledger rows, no bonus.
-- =============================================================================

update public.profiles p
   set completeness = public.compute_profile_completeness(p.id)
 where p.onboarding_completed;
