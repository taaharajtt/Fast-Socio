-- =============================================================================
-- FAST SOCIO — F5/F1: default-deny the profiles write surface
--
-- Context: the 2026-07-15 admin takeover exploited a self-settable admin_role.
-- Migration 0080 patched protect_profile_columns(), but the weakness underneath
-- is structural, not a one-off bug:
--   * `authenticated` holds blanket table-level UPDATE on profiles, so EVERY
--     column is writable and a single denylist trigger is the only thing
--     saying no.
--   * A denylist protects only the columns someone remembered to list. That is
--     exactly how admin_role and verified were missed the first time.
--
-- Fix: flip to a column-level allowlist. Revoke blanket UPDATE and re-grant it
-- only on the columns the client legitimately edits (profile edit, onboarding
-- wizard, privacy toggles, account settings, tour flag). Everything else --
-- admin_role, is_admin, is_banned, verified, aura_score, xp, level,
-- shadow_banned, suspended_until, posting_restricted_until, created_at,
-- last_seen_at, events_seen_at, username_changed_at -- is written only by
-- SECURITY DEFINER RPCs and triggers that run as the table owner and bypass
-- these grants, so locking them here does not affect any legitimate write.
--
-- The payoff is the failure direction: a future privileged column is now
-- non-writable by default. Forgetting to guard it fails CLOSED (the feature is
-- silently blocked and caught in testing) instead of OPEN (privilege
-- escalation).
--
-- This migration deliberately does NOT redefine protect_profile_columns().
-- Migration 0080 owns that function and its version is strictly stronger: it
-- guards `verified` AND covers the INSERT path. The allowlist is the outer,
-- default-deny layer; the trigger stays the inner layer. Two independent
-- guards, neither one redefining the other.
--
-- `id` IS in the allowlist and must stay there. PostgREST emits
--   insert ... on conflict (id) do update set id = excluded.id, ...
-- for the onboarding upsert (src/app/onboarding/actions.ts), which requires
-- UPDATE on `id`. Verified against the live DB on 2026-07-17: with `id` omitted
-- the upsert fails 42501 permission denied -- the same account-creation break
-- that migration 0078_restore_profiles_update_grant was written to fix.
-- Granting it is safe: the RLS UPDATE policy's `with check (id = auth.uid())`
-- still forbids reassigning a row to another user, so the write only ever
-- no-ops.
--
-- Idempotent: safe to re-run.
-- =============================================================================

revoke update on public.profiles from authenticated, anon;

grant update (
  id,
  full_name, department, semester, gender, interests, bio, avatar_url, cover_url,
  personality, languages, pronouns, hostel_status, graduation_year, hometown, relationship_pref,
  pref_genders, pref_semester_min, pref_semester_max, pref_verified_only,
  onboarding_step, onboarding_completed,
  discoverable, searchable, show_online, read_receipts, show_aura, show_department, show_semester,
  profile_visibility, deactivated_at, username, tour_seen_at
) on public.profiles to authenticated;

-- anon must never write profiles at all.
revoke insert, update, delete on public.profiles from anon;
