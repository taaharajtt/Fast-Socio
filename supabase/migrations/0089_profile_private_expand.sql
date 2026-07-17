-- =============================================================================
-- FAST SOCIO — F16 / VULN-04 step 1 of 3: EXPAND
--
-- THE PROBLEM
-- `profiles` SELECT is `using (true)`, so any authenticated account can run
--   GET /rest/v1/profiles?select=*
-- and read every column of every user. Measured against live on 2026-07-17 with
-- one ordinary student account: 57 rows, including pref_genders for all 57
-- (which genders each student wants to match with), relationship_pref for 15,
-- hostel_status for 18, hometown for 9. The attacker ran exactly this at
-- 10:31 and 10:45 on 2026-07-15 (incident report §4).
--
-- The app's privacy toggles (discoverable/searchable/show_*) are applied only
-- inside app queries, so a direct API call ignores them entirely.
--
-- WHY THE OBVIOUS FIX FAILED
-- Migration 0082 tried column-level SELECT privileges and 0083 reverted it. The
-- reason recorded in 0083 -- "ON CONFLICT DO UPDATE requires table-level
-- SELECT" -- is not quite right, and the real reason matters:
--
--   PostgREST always emits `insert ... on conflict (id) do update set
--   col = excluded.col`. `excluded.col` is a READ. So revoking SELECT on a
--   column makes that column unwritable through PostgREST. Verified on live
--   2026-07-17: with SELECT revoked, `update profiles set pref_verified_only
--   = ...` fails 42501 just like the upsert does. It was never about ON
--   CONFLICT.
--
-- The deeper issue: column privileges are not row-aware and RLS is not
-- column-aware. Neither primitive can express "you may read your own
-- date_of_birth but not anyone else's". No amount of grant tuning fixes that.
--
-- THE FIX
-- Split the table. Moving the private columns to their own table converts a
-- column-privilege problem into a ROW-privilege problem, which RLS expresses
-- natively. On profile_private the client holds SELECT on every column (so
-- `excluded.col` resolves and upserts work again) while RLS confines them to
-- their own row. The thing that made 0082 unshippable disappears rather than
-- being worked around.
--
-- WHAT MOVES, AND WHY IT IS SAFE
-- Verified 2026-07-17 that no code path reads any of these cross-user:
--   * The only DB consumer is get_discover_candidates() -- SECURITY DEFINER,
--     and its RETURNS TABLE signature emits no private column. It reads them
--     only from the caller's OWN row. Definer bypasses RLS, so matching is
--     unaffected (0090 repoints it at this table).
--   * The only client readers are own-row: onboarding/page.tsx (wizard
--     prefill) and settings/export/route.ts (GDPR export).
--   * The cross-user profile page (profile/[id]/page.tsx) selects none of them.
-- `gender` deliberately stays on profiles: get_discover_candidates returns it
-- to the swipe deck by design.
--
-- THIS MIGRATION CLOSES NOTHING ON ITS OWN. It only creates and backfills the
-- new table. The columns remain on profiles and remain scrapeable until 0091
-- drops them. Split in three so the app can be deployed in between: dropping
-- the columns while old instances are still serving would break onboarding
-- mid-rollout.
-- =============================================================================
set check_function_bodies = off;

create table if not exists public.profile_private (
  id                 uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth      date,
  hostel_status      text,
  hometown           text,
  relationship_pref  text,
  pref_genders       text[] not null default '{}'::text[],
  pref_semester_min  smallint,
  pref_semester_max  smallint,
  pref_verified_only boolean not null default false
);

alter table public.profile_private enable row level security;

-- Row ownership is the whole security model here. `(select auth.uid())` rather
-- than a bare auth.uid() so the planner hoists it to an InitPlan instead of
-- re-evaluating per row -- the pattern established in 0032.
drop policy if exists "own private row select" on public.profile_private;
create policy "own private row select" on public.profile_private
  for select using (id = (select auth.uid()));

drop policy if exists "own private row insert" on public.profile_private;
create policy "own private row insert" on public.profile_private
  for insert with check (id = (select auth.uid()));

drop policy if exists "own private row update" on public.profile_private;
create policy "own private row update" on public.profile_private
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- No DELETE policy: rows die with the profile via ON DELETE CASCADE. No anon
-- access of any kind. Start from zero rather than trusting Supabase's default
-- GRANT ALL, per the convention 0084/0085 established.
revoke all on public.profile_private from anon, authenticated;
grant select, insert, update on public.profile_private to authenticated;

-- Backfill every existing profile, so the table is complete before anything
-- reads it. Idempotent.
insert into public.profile_private (
  id, date_of_birth, hostel_status, hometown, relationship_pref,
  pref_genders, pref_semester_min, pref_semester_max, pref_verified_only
)
select
  p.id, p.date_of_birth, p.hostel_status, p.hometown, p.relationship_pref,
  coalesce(p.pref_genders, '{}'::text[]), p.pref_semester_min, p.pref_semester_max,
  coalesce(p.pref_verified_only, false)
from public.profiles p
on conflict (id) do nothing;

-- Keep future profiles supplied with a private row (handle_new_user only
-- touches profiles). Dropped in 0091 once the columns are gone and the app
-- writes profile_private directly.
create or replace function public.ensure_profile_private()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  insert into public.profile_private (id) values (new.id)
  on conflict (id) do nothing;
  return null;
end;
$fn$;

drop trigger if exists profiles_ensure_private on public.profiles;
create trigger profiles_ensure_private
after insert on public.profiles
for each row execute function public.ensure_profile_private();

-- TRANSITION MIRROR — deleted by 0091.
-- Between this migration and the app deploy, the OLD app is still writing these
-- columns on `profiles`. Without this, an onboarding save in that window would
-- land on profiles and be destroyed when 0091 drops the columns.
--
-- Scoped `after update of <cols>`: it fires only when one of the private
-- columns appears in the UPDATE's SET list. The NEW app never mentions them on
-- profiles, so once deployed this trigger stops firing on its own and cannot
-- clobber profile_private with stale values.
create or replace function public.mirror_profile_private()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  insert into public.profile_private as pp (
    id, date_of_birth, hostel_status, hometown, relationship_pref,
    pref_genders, pref_semester_min, pref_semester_max, pref_verified_only
  )
  values (
    new.id, new.date_of_birth, new.hostel_status, new.hometown, new.relationship_pref,
    coalesce(new.pref_genders, '{}'::text[]), new.pref_semester_min, new.pref_semester_max,
    coalesce(new.pref_verified_only, false)
  )
  on conflict (id) do update set
    date_of_birth      = excluded.date_of_birth,
    hostel_status      = excluded.hostel_status,
    hometown           = excluded.hometown,
    relationship_pref  = excluded.relationship_pref,
    pref_genders       = excluded.pref_genders,
    pref_semester_min  = excluded.pref_semester_min,
    pref_semester_max  = excluded.pref_semester_max,
    pref_verified_only = excluded.pref_verified_only;
  return null;
end;
$fn$;

drop trigger if exists profiles_mirror_private on public.profiles;
create trigger profiles_mirror_private
after update of
  date_of_birth, hostel_status, hometown, relationship_pref,
  pref_genders, pref_semester_min, pref_semester_max, pref_verified_only
on public.profiles
for each row execute function public.mirror_profile_private();
