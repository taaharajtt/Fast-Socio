-- =============================================================================
-- FAST SOCIO — Derive semester from the roll number ("compute on read")
--
-- Semester is no longer collected at onboarding or editable on the profile. It
-- is a pure function of the roll number (username, e.g. i240733) and the current
-- date, so it advances automatically each term with no scheduled job:
--
--   * The first two digits of the roll are the batch — the calendar year (20YY)
--     the student enrolled, always in a Fall term. Both campus formats are
--     handled: i240733 (email style) and 24i5525 (printed roll style).
--   * A degree is 8 semesters over 4 years, two terms/year. Fall starts 1 Aug,
--     Spring starts 1 Jan.
--   * Term index (monotonic, consecutive terms differ by 1):
--         Fall of year Y   -> 2*Y
--         Spring of year Y -> 2*Y - 1     (the Spring following Fall of Y-1)
--     A batch starts at 2*(20YY); semester = currentTerm - batchStart + 1.
--   * 1..8 for an active student, 13 (ALUMNI_SEMESTER) once semester 8 is
--     finished — this is how batches 2021 and earlier resolve to Alumni — and
--     NULL when the roll can't be parsed or the batch hasn't enrolled yet.
--
-- Mirrors src/lib/profile/semester.ts, which does the same derivation for
-- display. STABLE (not IMMUTABLE) because it reads now().
--
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.current_semester(p_username text)
returns smallint
language sql
stable
as $$
  with parsed as (
    -- Batch year = two digits at the start, allowing one optional leading
    -- letter; handles both i240733 and 24i5525, rejects non-roll usernames.
    select substring(coalesce(p_username, '') from '^[^0-9]?(\d\d)') as yy
  ),
  calc as (
    select
      2 * (2000 + yy::int) as batch_start,
      case
        when extract(month from now()) >= 8 then 2 * extract(year from now())::int
        else 2 * extract(year from now())::int - 1
      end as current_term
    from parsed
    where yy is not null
  )
  select case
           when (current_term - batch_start + 1) < 1 then null   -- not enrolled yet
           when (current_term - batch_start + 1) > 8 then 13      -- Alumni sentinel
           else (current_term - batch_start + 1)
         end::smallint
  from calc;
$$;

-- ---------------------------------------------------------------------------
-- Rewire get_discover_candidates (mig 0054) to score and return the DERIVED
-- semester instead of the stored profiles.semester column, so affinity stays
-- correct as terms roll over. Only the semester source changes; every
-- eligibility filter, the fresh->recycled tiering, the diversity interleave and
-- all other weights are preserved verbatim.
-- ---------------------------------------------------------------------------
set check_function_bodies = off;

drop function if exists public.get_discover_candidates(integer);

create function public.get_discover_candidates(p_limit integer default 20)
returns table (
  id                    uuid,
  full_name             text,
  department            text,
  semester              smallint,
  bio                   text,
  avatar_url            text,
  interests             text[],
  gender                text,
  aura_score            integer,
  verified              boolean,
  is_recycled           boolean,
  compatibility         smallint,
  shared_interests      text[]
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select
      p.id as uid,
      p.department as my_dept,
      public.current_semester(p.username) as my_sem,
      p.interests as my_interests,
      p.pref_semester_min,
      p.pref_semester_max,
      p.pref_verified_only,
      array(select community_id from public.community_members where user_id = p.id) as my_comms
    from public.profiles p
    where p.id = auth.uid()
  ),
  base as (
    select p.*, public.current_semester(p.username) as sem_derived
    from public.profiles p, me
    where p.id <> me.uid
      and p.onboarding_completed = true
      and p.is_banned = false
      and not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = me.uid and b.blocked_id = p.id)
           or (b.blocker_id = p.id and b.blocked_id = me.uid)
      )
      and not exists (
        select 1 from public.matches m
        where m.user_low = least(me.uid, p.id)
          and m.user_high = greatest(me.uid, p.id)
      )
  ),
  fresh as (
    select b.*, false as is_recycled, 0 as tier, b.created_at as sort_key
    from base b, me
    where not exists (
      select 1 from public.swipes s
      where s.swiper_id = me.uid and s.target_id = b.id
    )
  ),
  seen as (
    select b.*, true as is_recycled, 1 as tier, s.created_at as sort_key
    from base b
    join me on true
    join public.swipes s on s.swiper_id = me.uid and s.target_id = b.id
  ),
  merged as (
    select * from fresh
    union all
    select * from seen
  ),
  scored as (
    select
      m.*,
      si.shared as shared_arr,
      coalesce(array_length(si.shared, 1), 0) as shared_n,
      (select count(*) from public.community_members cm
        where cm.user_id = m.id and cm.community_id = any (me.my_comms)) as mutual_comms,
      me.my_dept, me.my_sem,
      me.pref_semester_min as v_pref_min,
      me.pref_semester_max as v_pref_max,
      me.pref_verified_only as v_pref_verified
    from merged m
    cross join me
    left join lateral (
      select array(select unnest(m.interests) intersect select unnest(me.my_interests)) as shared
    ) si on true
  ),
  weighted as (
    select
      s.*,
      least(100, greatest(1, round(
          (case when s.my_dept is not null and s.department = s.my_dept then 25 else 0 end)
        + (case when s.my_sem is not null and s.sem_derived is not null
                then 15 * (1 - least(abs(s.sem_derived - s.my_sem), 4) / 4.0) else 0 end)
        + least(s.shared_n, 4) * 8
        + least(s.mutual_comms, 3) * 6
        + least(10, 1.5 * ln(1 + greatest(s.aura_score, 0)))
        + (case when s.v_pref_min is not null and s.v_pref_max is not null
                 and s.sem_derived between s.v_pref_min and s.v_pref_max then 8 else 0 end)
        + (case when s.v_pref_verified and s.verified then 5 else 0 end)
      ))::smallint) as compatibility
    from scored s
  ),
  diversified as (
    select w.*,
      row_number() over (partition by w.tier, w.department
                         order by w.compatibility desc, w.sort_key desc) as dept_rank
    from weighted w
  )
  select
    id, full_name, department, sem_derived as semester, bio, avatar_url,
    interests, gender, aura_score, verified, is_recycled,
    compatibility,
    coalesce(shared_arr, '{}') as shared_interests
  from diversified
  order by
    tier asc,
    dept_rank asc,
    compatibility desc,
    case when tier = 0 then sort_key end desc nulls last,
    case when tier = 1 then sort_key end asc nulls last
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.get_discover_candidates(integer) from public;
revoke execute on function public.get_discover_candidates(integer) from anon;
grant execute on function public.get_discover_candidates(integer) to authenticated;
