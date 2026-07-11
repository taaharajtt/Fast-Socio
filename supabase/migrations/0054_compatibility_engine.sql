-- =============================================================================
-- FAST SOCIO — Refactor Phase 4: Discover compatibility engine.
--
-- get_discover_candidates filtered eligibility and ordered chronologically with
-- ZERO compatibility scoring. This adds a deterministic weighted compatibility
-- score (0–100) consuming the Phase 2 identity vector, a diversity interleave
-- that stops consecutive same-department cards, and returns the shared-interest
-- overlap + verified flag so the card can show a real "% match".
--
-- PRESERVED (never removed):
--   * All eligibility filters (self, onboarded, not banned, blocked, matched).
--   * The fresh(tier 0) → recycled(tier 1) tiering and "never runs empty"
--     recycle guarantee. Scoring only reorders WITHIN a tier; fresh candidates
--     still come before recycled ones.
--
-- Weights are inlined here (documented below). A future admin-editable
-- scoring_weights table can replace them without changing the signature.
-- =============================================================================

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
      p.semester as my_sem,
      p.interests as my_interests,
      p.pref_semester_min,
      p.pref_semester_max,
      p.pref_verified_only,
      array(select community_id from public.community_members where user_id = p.id) as my_comms
    from public.profiles p
    where p.id = auth.uid()
  ),
  base as (
    select p.*
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
      -- Interest overlap (drives both the chips and part of the score).
      si.shared as shared_arr,
      coalesce(array_length(si.shared, 1), 0) as shared_n,
      -- Mutual community memberships.
      (select count(*) from public.community_members cm
        where cm.user_id = m.id and cm.community_id = any (me.my_comms)) as mutual_comms,
      -- Alias the viewer's preference columns so they don't collide with the
      -- candidate's own pref_* columns carried in via m.* (both are on profiles).
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
          -- Department identity: same school is a strong signal.  (max 25)
          (case when s.my_dept is not null and s.department = s.my_dept then 25 else 0 end)
          -- Semester proximity: same = 15, decays to 0 at 4+ apart.        (max 15)
        + (case when s.my_sem is not null and s.semester is not null
                then 15 * (1 - least(abs(s.semester - s.my_sem), 4) / 4.0) else 0 end)
          -- Shared interests: 8 each, capped at 4.                          (max 32)
        + least(s.shared_n, 4) * 8
          -- Mutual communities: 6 each, capped at 3.                        (max 18)
        + least(s.mutual_comms, 3) * 6
          -- Reputation, log-scaled so popularity can't dominate.           (max ~10)
        + least(10, 1.5 * ln(1 + greatest(s.aura_score, 0)))
          -- Preference boosts (soft — never hard-filter, to keep the deck full).
        + (case when s.v_pref_min is not null and s.v_pref_max is not null
                 and s.semester between s.v_pref_min and s.v_pref_max then 8 else 0 end)
        + (case when s.v_pref_verified and s.verified then 5 else 0 end)
      ))::smallint) as compatibility
    from scored s
  ),
  diversified as (
    -- Round-robin by department within each tier: rank 1 is each department's
    -- best candidate, so ordering by rank interleaves departments and prevents
    -- long same-department runs.
    select w.*,
      row_number() over (partition by w.tier, w.department
                         order by w.compatibility desc, w.sort_key desc) as dept_rank
    from weighted w
  )
  select
    id, full_name, department, semester, bio, avatar_url,
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
