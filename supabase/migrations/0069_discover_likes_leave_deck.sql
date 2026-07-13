-- =============================================================================
-- FAST SOCIO — Discover: a like removes the person from YOUR deck for good
--
-- Clarified product rule (supersedes the "seen" tier in 0068):
--
--   * LIKE someone  -> they leave your Discover permanently (like a match does).
--     You've committed interest; you're just waiting on them. They must NOT
--     resurface for you. (A match still only forms on a reciprocal like, and the
--     incoming-like compatibility boost on THEIR deck is unchanged — 0068.)
--   * PASS someone   -> removed from Discover while fresh people remain, then
--     resurfaces in the recycle round once you're "all caught up".
--
-- Only change vs 0068: the recycle ("seen") tier now joins passes ONLY, so liked-
-- but-not-matched profiles are excluded from the deck entirely (they are neither
-- fresh, nor recycled). Everything else is carried over verbatim.
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
        + (case when s.my_sem is not null and s.semester is not null
                then 15 * (1 - least(abs(s.semester - s.my_sem), 4) / 4.0) else 0 end)
        + least(s.shared_n, 4) * 8
        + least(s.mutual_comms, 3) * 6
        + least(10, 1.5 * ln(1 + greatest(s.aura_score, 0)))
        + (case when s.v_pref_min is not null and s.v_pref_max is not null
                 and s.semester between s.v_pref_min and s.v_pref_max then 8 else 0 end)
        + (case when s.v_pref_verified and s.verified then 5 else 0 end)
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
