-- 0140 — fix-037: a real, explainable match percentage.
--
-- WHAT WAS THERE. `get_discover_candidates`'s `weighted` CTE scored:
--     same department            +25      <-- backwards: the spec favours CROSS-school
--     semester proximity         up to 15 (a distance ramp, not "same semester")
--     shared interests           least(n,4) * 8  = max 32, capped at FOUR
--     mutual communities         up to 18
--     aura                       up to 10 via ln()
--     they_liked_me              +9       (an invisible incoming-like boost)
--   clamped to 1..100.
-- So interests were not dominant, same-school was rewarded rather than penalised, and
-- roughly a third of the number came from signals a user cannot see or reason about.
--
-- WEIGHTS NOW (total 100 before clamping):
--     shared interests    50   dominant, asymptotic — never actually reaches 50
--     opposite gender     15
--     same semester       13   exact match, derived from the roll number
--     DIFFERENT school    12   cross-school pairings are favoured
--     same batch          10   intake year from the roll number
--
-- The interests term is 7 x min(s,6), plus a bonus of 8 x e/(e+6) where e = max(s-6,0).
-- The bonus is a hyperbola: s=6 -> 42, s=12 -> 46, s=24 -> 48, s=40 -> 48.6, and it
-- approaches 50 without arriving. A student who ticks all 40 interests therefore cannot
-- max the term out — a hard cap would have made "picked everything" look identical to
-- "genuinely aligned".
--
-- Every categorical signal requires the value on BOTH sides; a missing gender, department,
-- semester or batch scores 0 rather than a guess, so an incomplete profile can never
-- inflate a score. Clamped to 5..99 so the number never reads as broken.
--
-- AURA, MUTUAL COMMUNITIES AND THE INCOMING-LIKE BOOST ARE NOT GONE — THEY MOVED.
-- The runbook lists five signals for the percentage, and the displayed number must be
-- explainable from them alone. But `they_liked_me` and mutual communities are real
-- product behaviour (surfacing people who already liked you, and people you overlap
-- with). Deleting them would silently degrade the deck. So they are no longer baked
-- into the *number* — they are ORDER BY tie-breakers underneath it. The score stays
-- honest; the ordering keeps its intelligence.
--
-- This SQL is AUTHORITATIVE. `src/lib/discover/match-score.ts` mirrors it as an
-- executable specification with unit tests; keep the two in step.

-- Intake year from a roll number. Mirrors `rollBatchYear` in match-score.ts and uses
-- the same leading-two-digit convention as `current_semester`.
create or replace function public.roll_batch_year(p_username text)
returns smallint
language sql
immutable
as $function$
  select nullif(substring(coalesce(p_username, '') from '^[^0-9]?(\d\d)'), '')::smallint;
$function$;

create or replace function public.get_discover_candidates(p_limit integer default 20)
returns table(
  id uuid, full_name text, department text, semester smallint, bio text,
  avatar_url text, interests text[], gender text, aura_score integer,
  verified boolean, is_recycled boolean, compatibility smallint,
  shared_interests text[]
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select
      p.id as uid,
      p.department as my_dept,
      public.current_semester(p.username) as my_sem,
      p.interests as my_interests,
      lower(nullif(btrim(p.gender), '')) as my_gender,
      public.roll_batch_year(p.username) as my_batch,
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
      me.my_dept, me.my_sem, me.my_gender, me.my_batch
    from merged m
    cross join me
    left join lateral (
      select array(select unnest(m.interests) intersect select unnest(me.my_interests)) as shared
    ) si on true
  ),
  weighted as (
    select
      s.*,
      least(99, greatest(5, round(
          -- interests: dominant term, 7/each to a plateau of 6, then a hyperbolic
          -- bonus that approaches 8 but never arrives
          7 * least(s.shared_n, 6)
        + 8.0 * greatest(s.shared_n - 6, 0) / (greatest(s.shared_n - 6, 0) + 6)
          -- opposite gender
        + (case when s.my_gender in ('male', 'female')
                 and lower(nullif(btrim(s.gender), '')) in ('male', 'female')
                 and lower(nullif(btrim(s.gender), '')) <> s.my_gender
                then 15 else 0 end)
          -- same semester (exact)
        + (case when s.my_sem is not null and s.sem_derived is not null
                 and s.sem_derived = s.my_sem
                then 13 else 0 end)
          -- DIFFERENT school scores higher than the same one
        + (case when s.my_dept is not null and s.department is not null
                 and s.department <> s.my_dept
                then 12 else 0 end)
          -- same batch
        + (case when s.my_batch is not null
                 and public.roll_batch_year(s.username) is not null
                 and public.roll_batch_year(s.username) = s.my_batch
                then 10 else 0 end)
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
    -- Tie-breakers only: these shape the ORDER, never the displayed number, so the
    -- percentage stays explainable while the deck keeps surfacing incoming likes and
    -- people you share communities with.
    they_liked_me desc,
    mutual_comms desc,
    case when tier = 0 then sort_key end desc nulls last,
    case when tier = 1 then sort_key end asc nulls last
  limit greatest(1, least(p_limit, 50));
$function$;
