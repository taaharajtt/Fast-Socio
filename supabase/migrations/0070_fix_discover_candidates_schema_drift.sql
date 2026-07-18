-- =============================================================================
-- FAST SOCIO — Fix get_discover_candidates schema drift (Discover was dead)
--
-- The live function referenced profiles.pref_semester_min / pref_semester_max /
-- pref_verified_only, which had been dropped from the table. Because every
-- migration used `check_function_bodies = off`, this was never caught at deploy
-- time — the function only failed at RUNTIME ("column pref_semester_min does not
-- exist"), so get_discover_candidates errored on every call and Discover
-- returned nothing. A later migration (derive_semester_from_roll) also reverted
-- the passes/like-boost logic from 0068/0069.
--
-- This rebuilds the function against the ACTUAL schema:
--   * semester is roll-derived via current_semester(username) (stored `semester`
--     column is no longer authoritative).
--   * ALL pref_* preference-boost terms removed (columns are gone).
--   * Restores the three product rules:
--       - a like removes the person from YOUR deck permanently (waiting on them);
--       - PASSES recycle only once fresh candidates are exhausted (caught up);
--       - a subtle +9 compatibility boost for people who already liked you.
--   * Keeps the full eligibility filters (onboarded, not banned, discoverable,
--     not deactivated/shadow-banned/suspended, not blocked/muted/matched).
--
-- NOTE: repo migrations 0068/0069 carried the broken pref_* references and a
-- non-roll `p.semester`; this file supersedes them. Verified by EXECUTING the
-- function (not just reading its definition) against production data.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.get_discover_candidates(p_limit integer default 20)
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
      and p.discoverable = true
      and p.deactivated_at is null
      and p.shadow_banned = false
      and (p.suspended_until is null or p.suspended_until < now())
      and not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = me.uid and b.blocked_id = p.id)
           or (b.blocker_id = p.id and b.blocked_id = me.uid)
      )
      and not exists (
        select 1 from public.muted_users mu
        where mu.muter_id = me.uid and mu.muted_id = p.id
      )
      and not exists (
        select 1 from public.matches m
        where m.user_low = least(me.uid, p.id)
          and m.user_high = greatest(me.uid, p.id)
      )
      -- A profile you LIKED is gone for good — you're committed, waiting on them.
      and not exists (
        select 1 from public.swipes s
        where s.swiper_id = me.uid and s.target_id = p.id
          and s.direction = 'like'
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
  -- Recycle round: PASSED profiles only, surfaced once no fresh candidate remains
  -- ("You're all caught up"), least-recently-passed first.
  seen as (
    select b.*, true as is_recycled, 1 as tier, s.created_at as sort_key
    from base b
    join me on true
    join public.swipes s
      on s.swiper_id = me.uid and s.target_id = b.id and s.direction = 'pass'
    where not exists (select 1 from fresh)
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
      -- Has this candidate already liked the viewer? A pending, one-sided like.
      exists (
        select 1 from public.swipes s2
        where s2.swiper_id = m.id and s2.target_id = me.uid and s2.direction = 'like'
      ) as they_liked_me,
      me.my_dept, me.my_sem
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
          -- INCOMING_LIKE_BOOST: someone who already liked you reads as a little
          -- more compatible and floats up the deck. Kept small so it blends into
          -- the score and never advertises the incoming like.
        + (case when s.they_liked_me then 9 else 0 end)
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
