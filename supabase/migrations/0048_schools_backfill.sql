-- =============================================================================
-- FAST SOCIO — collapse degrees into three schools (UAT-008)
--
-- `profiles.department` now holds a SCHOOL, not a degree:
--   Fast School of Computing (FSC) · Engineering (FSE) · Management (FSM)
--
-- This backfills every existing profile from its old degree name, then sends a
-- one-off announcement asking everyone to confirm their school (the mapping is a
-- best guess; a student can re-pick in Profile → Edit). The announcement rides
-- the existing UAT-012 cold-open modal, so users actually see it.
-- =============================================================================

-- Map known degree names to schools; anything unrecognised (or a stray legacy
-- value) defaults to Computing, which is the largest cohort — the confirmation
-- prompt covers the mismatch.
update public.profiles
set department = case department
    when 'Electrical Engineering'  then 'Fast School of Engineering'
    when 'Civil Engineering'       then 'Fast School of Engineering'
    when 'Mechanical Engineering'  then 'Fast School of Engineering'
    when 'Business Administration' then 'Fast School of Management'
    when 'Business Analytics'      then 'Fast School of Management'
    when 'Accounting & Finance'    then 'Fast School of Management'
    else 'Fast School of Computing'
  end
where department is not null
  and department not in (
    'Fast School of Computing',
    'Fast School of Engineering',
    'Fast School of Management'
  );

-- One-off broadcast (UAT-008). Written straight into notifications (this runs as
-- the migration owner, so it bypasses the super-admin guard on admin_broadcast).
-- Only onboarded, non-banned users; the UAT-012 modal shows it on next cold open.
insert into public.notifications (user_id, type, data)
select
  id,
  'announcement',
  jsonb_build_object(
    'title', 'We moved to Schools',
    'body',  'Degrees are now grouped into three schools: Computing (FSC), Engineering (FSE) and Management (FSM). We''ve set yours automatically — please open Profile → Edit to confirm it''s right.',
    'url',   '/profile/edit'
  )
from public.profiles
where onboarding_completed = true
  and is_banned = false;
