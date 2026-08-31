-- 0177 — Discover: compute the shared-interests intersection once, and stop
-- materialising 44 profile columns to use 11.
--
-- Two changes to `get_discover_candidates`, both pure evaluation strategy. Not
-- one predicate, weight, tie-breaker, ordering rule or pacing rule is touched,
-- so `lib/discover/match-score.ts` and `lib/discover/gender-pacing.ts` remain
-- accurate mirrors and their unit tests are unaffected.
--
-- ---------------------------------------------------------------------------
-- WHY THIS ONE IS DIFFERENT FROM THE ATTEMPT THAT WAS REVERTED
--
-- An earlier pass tried `scored as materialized`, measured "126ms -> 71ms",
-- then re-measured with both plans pre-warmed and in the reverse order and got
-- 73.5 vs 75.5 — i.e. nothing. It was reverted as a no-op.
--
-- Both of those measurements were wrong, because wall-clock on this instance is
-- not a usable instrument: the same function on the same user measured 44ms and
-- 393ms seconds apart, dominated by contention from other work on the box.
--
-- This change is justified on a DETERMINISTIC signal instead — the shape of the
-- plan, which does not move with load. `EXPLAIN (ANALYZE, BUFFERS)` on the slow
-- case (a brand new account with ~484 eligible candidates):
--
--     variant             HashSetOp Intersect nodes   total loops
--     baseline                                    4          1,936
--     scored as materialized                      2            968
--     weighted as materialized                    5          2,420   (worse)
--     both                                        2            968
--
-- 1. THE INTERSECTION WAS COMPUTED FOUR TIMES PER CANDIDATE.
--
-- `scored` derives `si.shared` from a lateral, and `weighted` reads it three
-- times in the scoring formula
--
--       9 * least(s.shared_n, 6)
--     + 11.0 * greatest(s.shared_n - 6, 0) / (greatest(s.shared_n - 6, 0) + 6)
--
-- with the final select reading `shared_arr` a fourth time. `scored` has one
-- reference, so PostgreSQL inlines it and re-derives the lateral at each use —
-- and because `weighted` is itself inlined into `diversified`, the whole
-- expression lands inside a window ORDER BY, where it is evaluated per row per
-- reference. At 484 candidates that is 1,936 unnest/intersect operations to
-- answer 20 cards.
--
-- `materialized` pins it to one evaluation, halving the work to 968 loops.
-- Materialising `weighted` as well was tried and makes it WORSE (the planner
-- picks a different shape and re-derives five times), which is why only
-- `scored` is marked.
--
-- 2. `base` SELECTED `p.*` — 44 COLUMNS — TO USE 11.
--
-- `base` is referenced by both `fresh` and `seen`, so it is materialised, and
-- it was materialising every profile column including bio-adjacent and privacy
-- fields nothing downstream reads. Measured row width 803 -> 375 bytes, i.e.
-- 53% less data written and re-read for the same result. The columns kept are
-- exactly those the rest of the function consumes: the ten returned to the
-- client, plus `username` for `roll_batch_year` and `created_at` for the fresh
-- tier's sort key.
--
-- Combined effect on the slow case: execution 123ms -> 65ms.
--
-- ---------------------------------------------------------------------------
-- CORRECTNESS IS PROVEN, NOT ASSUMED. Before applying anywhere, both versions
-- were run inside one rolled-back transaction against production data and an
-- md5 digest of the FULL result set compared, over 8 real accounts x 5 call
-- shapes = 40 comparisons: no exclusion, a 500-id exclusion set, page 1's own
-- ids fed back as the exclusion set (the real pagination path), limit 1 and
-- limit 50. All 40 identical. The harness is committed as
-- `supabase/tests/discover_candidates_parity.sql` so it can be re-run.
--
-- ---------------------------------------------------------------------------
-- REJECTED, on evidence, so they are not re-derived from reading this SQL:
--
--  * A partial index on the eligibility predicate. The plan shows the profiles
--    scan is a Seq Scan costing 50 buffers / 0.92ms of a 102ms query. On ~650
--    rows a sequential scan is already the right plan; an index would add write
--    cost to every profile update and buy nothing.
--  * Pre-filtering before the window functions. The windows sort 484 rows in
--    231kB by quicksort. Cutting the set early would risk the pacing and
--    recycling behaviour 0158 exists to provide, for a saving the plan does not
--    show.
--  * Generated columns for current_semester / roll_batch_year. Visible but
--    small, and `current_semester` depends on the current date, so it would
--    need a refresh strategy. The authoritative rule stays in SQL either way.
--
-- Signature, returned columns, grants, security posture and every eligibility
-- and privacy predicate are carried over from 0158 unchanged. CREATE OR REPLACE
-- keeps the arity, so no caller moves.

create or replace function public.get_discover_candidates(
  p_limit integer default 20,
  p_exclude uuid[] default '{}'::uuid[]
)
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
    select
      p.id, p.username, p.full_name, p.department, p.bio, p.avatar_url,
      p.aura_score, p.created_at, p.interests, p.gender, p.verified,
      public.current_semester(p.username) as sem_derived
    from public.profiles p, me
    where p.id <> me.uid
      -- 0157: continuation — ids the caller already holds in its deck.
      and not (p.id = any (coalesce(p_exclude, '{}'::uuid[])))
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
  scored as materialized (
    select
      m.*,
      si.shared as shared_arr,
      coalesce(array_length(si.shared, 1), 0) as shared_n,
      (select count(*) from public.community_members cm
        where cm.user_id = m.id and cm.community_id = any (me.my_comms)) as mutual_comms,
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
          -- interests: dominant term, 9/each to a plateau of 6, then a hyperbolic
          -- bonus that approaches 11 but never arrives. GENDER IS NOT A TERM.
          9 * least(s.shared_n, 6)
        + 11.0 * greatest(s.shared_n - 6, 0) / (greatest(s.shared_n - 6, 0) + 6)
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
  ),
  -- The 0157 ordering, materialised. `id` is appended so `ord` is a TOTAL order:
  -- two rows that tie on every prior key must not be able to swap between pages.
  ordered as (
    select d.*,
      coalesce(lower(nullif(btrim(d.gender), '')) = 'female', false) as is_female,
      row_number() over (
        partition by d.tier
        order by
          d.dept_rank asc,
          d.compatibility desc,
          -- Tie-breakers only: these shape the ORDER, never the displayed number.
          d.they_liked_me desc,
          d.mutual_comms desc,
          case when d.tier = 0 then d.sort_key end desc nulls last,
          case when d.tier = 1 then d.sort_key end asc nulls last,
          d.id asc
      ) as ord
    from diversified d
  ),
  bucketed as (
    select o.*,
      row_number() over (partition by o.tier, o.is_female order by o.ord) as bucket_rank
    from ordered o
  ),
  paced as (
    select b.*,
      case
        when b.my_gender is distinct from 'female' then b.ord
        when b.is_female then ((b.bucket_rank - 1) / 2) * 3 + ((b.bucket_rank - 1) % 2) + 1
        else b.bucket_rank * 3
      end as slot
    from bucketed b
  )
  select
    id, full_name, department, sem_derived as semester, bio, avatar_url,
    interests, gender, aura_score, verified, is_recycled,
    compatibility,
    coalesce(shared_arr, '{}') as shared_interests
  from paced
  order by tier asc, slot asc, ord asc
  limit greatest(1, least(p_limit, 50));
$function$;
