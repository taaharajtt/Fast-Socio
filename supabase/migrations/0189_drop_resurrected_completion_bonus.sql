-- =============================================================================
-- 0189 — fix: 0187 resurrected a function that was deliberately dropped in 0064.
--
-- WHAT HAPPENED
-- The Aura audit listed `award_completion_bonus()` as a live reward path,
-- because migration 0051 defines it and pays +25 for a 90%-complete profile.
-- 0051 is not the effective definition. Migration 0064 dropped the whole
-- feature:
--
--     drop function if exists public.award_completion_bonus();
--     drop function if exists public.compute_profile_completeness(uuid);
--     alter table public.profiles drop column if exists completeness;
--
-- So the profile-completion bonus has not existed for over a hundred
-- migrations. 0187 "fixed the race" in it by carrying 0051's body forward —
-- which recreated a function calling a dropped helper and writing a dropped
-- column. It was created successfully (check_function_bodies is off, so the
-- dangling references are not caught at definition time) and would have raised
-- `42883: function compute_profile_completeness(uuid) does not exist` on its
-- first call.
--
-- Caught by supabase/tests/aura_integrity.sql, which called it. This is exactly
-- the failure mode this repo has documented twice before (migration 0143, and
-- again in 0184): a migration applies cleanly as `postgres` and proves nothing
-- about whether the function can actually run.
--
-- THE FIX is to put 0064's decision back: the function goes away again. It has
-- no callers — the only reference to `profile_completed` anywhere in the
-- application is a display label for the one historical ledger row that exists
-- (a single +25 from 2026-07-11).
--
-- Nothing is deducted. That historical row keeps its `legacy` grant from 0186,
-- so the user's Aura and XP are untouched.
-- =============================================================================

drop function if exists public.award_completion_bonus();

-- `profile_completed` joins the other dead reasons. It stays in the enum
-- because removing an enum value would rewrite history, and one real ledger row
-- still carries it.
comment on type public.aura_reason is
  'Aura ledger reasons. ACTIVE: post_created, comment_received, match, event_attend (check-in only), help_thanked, achievement, admin_adjust. INACTIVE (no writer; do not add one without a source key + reversal): post_liked, community_join, daily_login, profile_completed (the feature was removed in migration 0064). See migrations 0187 and 0189.';

-- =============================================================================
-- VERIFY
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'award_completion_bonus';
--   -- must be 0.
-- =============================================================================
