-- =============================================================================
-- FAST SOCIO — F16 / VULN-04 step 3 of 3: CONTRACT
--
-- THIS is the migration that actually closes the hole. 0089 created and
-- backfilled profile_private; 0090 repointed the matching engine; the app now
-- reads and writes the new table. Until the columns below are physically gone
-- from `profiles`, `GET /rest/v1/profiles?select=*` still returns all 57 users'
-- matching preferences to anyone with an account.
--
-- ORDER MATTERS. Do not run this until the app deploy that reads/writes
-- profile_private is live and verified. Old instances still serving traffic
-- would 42703 on every onboarding save.
--
-- NOT REVERSIBLE. Dropping a column drops its data. The backfill in 0089 has
-- already copied every row (verified 57/57), and the mirror trigger has kept
-- profile_private current for anything written during the transition window --
-- but there is no PITR and no scheduled backup on this project (F20), so take a
-- dump before running this.
--
-- The mirror trigger goes first: once the columns are gone it can only error,
-- and it exists solely to cover the window between 0089 and the deploy.
-- =============================================================================

drop trigger if exists profiles_mirror_private on public.profiles;
drop function if exists public.mirror_profile_private();

-- Final catch-up for anything the old app wrote to profiles after 0089 landed
-- but before the deploy went live. Safe to run even if the mirror already
-- handled it: it only fills values that are still NULL/default on the private
-- row, so it can never overwrite something the NEW app has already written.
update public.profile_private pp
set
  date_of_birth      = coalesce(pp.date_of_birth,     p.date_of_birth),
  hostel_status      = coalesce(pp.hostel_status,     p.hostel_status),
  hometown           = coalesce(pp.hometown,          p.hometown),
  relationship_pref  = coalesce(pp.relationship_pref, p.relationship_pref),
  pref_genders       = case when pp.pref_genders = '{}'::text[]
                            then coalesce(p.pref_genders, '{}'::text[])
                            else pp.pref_genders end,
  pref_semester_min  = coalesce(pp.pref_semester_min, p.pref_semester_min),
  pref_semester_max  = coalesce(pp.pref_semester_max, p.pref_semester_max),
  pref_verified_only = pp.pref_verified_only or coalesce(p.pref_verified_only, false)
from public.profiles p
where p.id = pp.id;

alter table public.profiles
  drop column if exists date_of_birth,
  drop column if exists hostel_status,
  drop column if exists hometown,
  drop column if exists relationship_pref,
  drop column if exists pref_genders,
  drop column if exists pref_semester_min,
  drop column if exists pref_semester_max,
  drop column if exists pref_verified_only;

-- The column-level UPDATE grants from 0084 for these columns are dropped along
-- with the columns themselves; nothing to clean up there.
--
-- What remains readable on `profiles` for any authenticated user is now the
-- genuinely public surface (name, department, semester, bio, avatar, interests,
-- gender, aura) plus presence/toggle columns. That last group is the rest of
-- F16: `show_online = false` still leaks last_seen_at to a direct API call,
-- because RLS cannot express per-column conditionals. Closing it needs a
-- public_profiles view (case when show_online then last_seen_at end) and
-- repointing every cross-user read at it. Tracked separately -- this migration
-- closes the PII scrape, not the toggle bypass.
