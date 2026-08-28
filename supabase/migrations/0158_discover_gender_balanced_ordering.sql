-- 0158 — Discover: gender leaves the SCORE and becomes an ORDERING policy.
--
-- Supersedes the scoring half of 0140 and the whole body of 0157. Forward-only:
-- 0140 and 0157 are already applied and are NOT edited.
--
-- ---------------------------------------------------------------------------
-- 1. THE PERCENTAGE NO LONGER READS GENDER.
--
-- 0140 gave an "opposite gender" pairing a flat +15. That made the displayed
-- number depend on a protected attribute, and it made two otherwise identical
-- candidates score differently for reasons the card could not honestly explain.
-- Those 15 points move to the signal the product actually wants to reward —
-- shared interests. The weights still total 100:
--
--     shared interests    65   dominant, asymptotic — never actually reaches 65
--     same semester       13   exact match, derived from the roll number
--     DIFFERENT school    12   cross-school pairings are favoured
--     same batch          10   intake year from the roll number
--
-- The interests term is 9 x min(s,6), plus a bonus of 11 x e/(e+6) where
-- e = max(s-6,0). The bonus is a hyperbola: s=6 -> 54, s=12 -> 59.5,
-- s=24 -> 62.7, s=40 -> 63.5, approaching 65 without arriving. Ticking all 40
-- interests still cannot max the term out — a hard cap would make "picked
-- everything" look identical to "genuinely aligned".
--
-- Every categorical signal still requires the value on BOTH sides, so an
-- incomplete profile can never inflate a score. Still clamped to 5..99.
-- The score stays deterministic, symmetric and now gender-blind.
--
-- ---------------------------------------------------------------------------
-- 2. GENDER-BALANCED PACING FOR FEMALE VIEWERS.
--
-- For a viewer whose normalized gender is 'female', student profile cards are
-- paced towards a repeating 2:1 rhythm:
--
--     female, female, other, female, female, other, ...
--
-- "other" is EVERY eligible candidate who is not female — male,
-- prefer_not_to_say, null, or an unrecognised value. Two buckets, never three.
--
-- HOW. The existing 0140/0157 ranking is materialised as a dense `ord` per
-- tier (the same ORDER BY, now with `id` appended so it is a TOTAL order —
-- pagination over `p_exclude` needs ties broken deterministically). Each bucket
-- is then ranked on `ord` and assigned a slot:
--
--     female rank k -> floor((k-1)/2)*3 + ((k-1) % 2) + 1     (slots 1,2,4,5,...)
--     other  rank j -> j*3                                    (slots 3,6,9,...)
--
-- Female slots are congruent to 1,2 (mod 3) and other slots to 0 (mod 3), so
-- the two sequences can never collide and `order by tier, slot, ord` is total.
--
-- WHY BEFORE THE LIMIT. The pacing is computed over the whole eligible set and
-- the `limit` is applied to the PACED order, so a female candidate who ranked
-- past position 20 under the old ordering has a real chance of entering the
-- page. Re-sorting the 20 rows the client already received could not do that.
--
-- NOT A FILTER. If a bucket runs short its slots are simply never claimed and
-- the other bucket flows on in its own ranked order — the deck never shrinks
-- and never empties because one bucket is thin. Ranking quality is preserved
-- inside each bucket, and the incoming-like / mutual-community tie-breakers
-- still shape `ord`.
--
-- Pacing runs INSIDE a tier (partition by tier), so every fresh candidate still
-- precedes every recycled pass.
--
-- Non-female viewers (male, prefer_not_to_say, null, unrecognised) get
-- `slot = ord`, i.e. byte-for-byte the 0157 ordering.
--
-- ---------------------------------------------------------------------------
-- Signature, returned columns, grants, security-definer posture and EVERY
-- eligibility/privacy predicate from 0157 are carried over unchanged: blocks
-- (both directions), mutes, bans, shadow bans, deactivation, suspensions,
-- discoverable, onboarding, existing matches, "a profile you LIKED is gone for
-- good", pass recycling, and the `p_exclude` continuation set. No new column is
-- exposed. CREATE OR REPLACE keeps the existing arity, so no caller moves.
--
-- `src/lib/discover/match-score.ts` mirrors the scoring and
-- `src/lib/discover/gender-pacing.ts` mirrors the pacing, both under unit test.
-- This SQL is authoritative; keep them in step.

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
    select p.*, public.current_semester(p.username) as sem_derived
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
  scored as (
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

revoke all on function public.get_discover_candidates(integer, uuid[]) from public;
revoke execute on function public.get_discover_candidates(integer, uuid[]) from anon;
grant execute on function public.get_discover_candidates(integer, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The SAME formula lives in public.match_percentage (migration 0144), which
-- the matches page renders. Leaving it on the old weights would mean one pair
-- showing 92% in Discover and 94% on Matches. Kept in step here — same terms,
-- same clamp, same fail-closed treatment of unknowns, gender likewise dropped.
-- Signature, grants and security posture are unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.match_percentage(p_a uuid, p_b uuid)
returns smallint
language sql
stable security definer
set search_path to 'public'
as $function$
  with a as (
    select interests,
           department                          as d,
           public.current_semester(username)   as sem,
           public.roll_batch_year(username)    as b
      from public.profiles where id = p_a
  ), z as (
    select interests,
           department                          as d,
           public.current_semester(username)   as sem,
           public.roll_batch_year(username)    as b
      from public.profiles where id = p_b
  ), s as (
    select coalesce(array_length(
             array(select unnest(a.interests) intersect select unnest(z.interests)), 1
           ), 0) as n
      from a, z
  )
  select least(99, greatest(5, round(
      9 * least(s.n, 6)
    + 11.0 * greatest(s.n - 6, 0) / (greatest(s.n - 6, 0) + 6)
    + (case when a.sem is not null and z.sem is not null and a.sem = z.sem
            then 13 else 0 end)
    + (case when a.d is not null and z.d is not null and a.d <> z.d
            then 12 else 0 end)
    + (case when a.b is not null and z.b is not null and a.b = z.b
            then 10 else 0 end)
  )))::smallint
  from a, z, s;
$function$;
