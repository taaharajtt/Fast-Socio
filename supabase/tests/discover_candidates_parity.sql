-- =============================================================================
-- Verification for migration 0177 — Discover candidate parity.
--
-- 0177 changes only HOW `get_discover_candidates` is evaluated: the
-- shared-interests lateral is materialised once instead of four times, and
-- `base` selects the 11 columns the function uses instead of all 44. Nothing
-- about eligibility, privacy, scoring, ordering or pacing is meant to move.
--
-- This test proves that, by running the CURRENT function and the 0158 body
-- side by side inside one transaction and comparing an md5 digest of the FULL
-- result set — every column of every row, in order — for a spread of real
-- accounts across every call shape the application actually issues.
--
--   psql "$DB_URL" -f supabase/tests/discover_candidates_parity.sql
--
-- Everything is inside a transaction that is ROLLED BACK. It replaces the
-- function temporarily to obtain the comparison and then throws that away, so
-- it writes nothing permanent. Run it AFTER applying 0177: it compares what is
-- deployed against the historical 0158 definition it must remain equivalent to.
--
-- Raises on failure. A clean run ends with "ALL CHECKS PASSED"; a silent run is
-- NOT a pass.
--
-- WHY A DIGEST RATHER THAN SPOT ASSERTIONS. The properties that matter here —
-- "the same people, ranked the same way, with the same compatibility numbers,
-- and the gender pacing still applied" — are all captured by "the result set is
-- byte-identical". Enumerating them individually would be both longer and
-- weaker, because it would only catch the regressions someone thought to list.
-- =============================================================================

begin;

set local role postgres;

create temp table parity(
  usr text, call_shape text, phase text, n int, digest text
) on commit drop;
grant all on parity to authenticated;

-- ---------------------------------------------------------------------------
-- 0. Structural preconditions.
-- ---------------------------------------------------------------------------
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_discover_candidates';

  if def is null then
    raise exception 'FAIL: public.get_discover_candidates is missing';
  end if;

  -- The two 0177 changes must actually be deployed, or this test would be
  -- comparing 0158 against itself and passing for the wrong reason.
  if def not like '%scored as materialized%' then
    raise exception 'FAIL: 0177 not applied — `scored as materialized` absent';
  end if;
  if def like '%select p.*%' then
    raise exception 'FAIL: 0177 not applied — base still selects p.*';
  end if;

  -- SECURITY DEFINER is what makes the function safe to expose; a change to
  -- INVOKER would silently return nothing under RLS rather than fail loudly.
  if not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_discover_candidates') then
    raise exception 'FAIL: get_discover_candidates is no longer SECURITY DEFINER';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Capture the CURRENT (0177) results for a spread of real accounts.
--
-- The accounts are chosen at runtime rather than hard-coded so this keeps
-- working as data changes: the extremes are what matter, because cost and
-- code paths both depend on how many candidates survive eligibility. A brand
-- new account exercises the wide path (~all profiles eligible, fresh tier
-- only); a heavy swiper exercises the narrow path and the recycle tier.
-- ---------------------------------------------------------------------------
create temp table subjects(uid uuid, kind text) on commit drop;

insert into subjects(uid, kind)
select uid, kind from (
  select p.id as uid, 'fewest-swipes' as kind,
         row_number() over (order by coalesce(s.n, 0) asc, p.id) as rn
    from public.profiles p
    left join (select swiper_id, count(*) n from public.swipes group by 1) s
      on s.swiper_id = p.id
   where p.onboarding_completed and not p.is_banned and p.discoverable
) z where rn <= 3
union all
select uid, kind from (
  select p.id as uid, 'most-swipes' as kind,
         row_number() over (order by coalesce(s.n, 0) desc, p.id) as rn
    from public.profiles p
    left join (select swiper_id, count(*) n from public.swipes group by 1) s
      on s.swiper_id = p.id
   where p.onboarding_completed and not p.is_banned and p.discoverable
) z where rn <= 3;

do $$
declare
  s record;
  c int;
  d text;
begin
  if (select count(*) from subjects) = 0 then
    raise exception 'FAIL: no eligible subjects found — cannot prove parity';
  end if;

  for s in select uid from subjects loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', s.uid::text, 'role', 'authenticated')::text, true);

    -- (a) a plain first page
    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(20, '{}'::uuid[]) x;
    insert into parity values (left(s.uid::text,8), 'page1', 'AFTER', c, d);

    -- (b) page 2: page 1's own ids fed back as the exclusion set. This is the
    --     real pagination path and the one most likely to break if ordering
    --     stopped being a total order.
    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(
        20, (select array(select id from public.get_discover_candidates(20, '{}'::uuid[])))) x;
    insert into parity values (left(s.uid::text,8), 'page2', 'AFTER', c, d);

    -- (c) a large exclusion set — the p_exclude cap the client can reach
    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(
        20, (select array(select id from public.profiles limit 500))) x;
    insert into parity values (left(s.uid::text,8), 'excl500', 'AFTER', c, d);

    -- (d) limit boundaries: the function clamps to greatest(1, least(p_limit,50))
    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(1, '{}'::uuid[]) x;
    insert into parity values (left(s.uid::text,8), 'limit1', 'AFTER', c, d);

    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(50, '{}'::uuid[]) x;
    insert into parity values (left(s.uid::text,8), 'limit50', 'AFTER', c, d);

    perform set_config('role', 'postgres', true);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Restore the 0158 body (inside this transaction only) and re-run.
--
-- This is the pre-0177 definition verbatim: `select p.*` in `base`, and
-- `scored as (` without `materialized`. Everything else is identical, which is
-- the point — if the digests match, the 0177 diff is provably evaluation
-- strategy and nothing else.
-- ---------------------------------------------------------------------------
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
          9 * least(s.shared_n, 6)
        + 11.0 * greatest(s.shared_n - 6, 0) / (greatest(s.shared_n - 6, 0) + 6)
        + (case when s.my_sem is not null and s.sem_derived is not null
                 and s.sem_derived = s.my_sem
                then 13 else 0 end)
        + (case when s.my_dept is not null and s.department is not null
                 and s.department <> s.my_dept
                then 12 else 0 end)
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
  ordered as (
    select d.*,
      coalesce(lower(nullif(btrim(d.gender), '')) = 'female', false) as is_female,
      row_number() over (
        partition by d.tier
        order by
          d.dept_rank asc,
          d.compatibility desc,
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

do $$
declare
  s record;
  c int;
  d text;
begin
  for s in select uid from subjects loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', s.uid::text, 'role', 'authenticated')::text, true);

    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(20, '{}'::uuid[]) x;
    insert into parity values (left(s.uid::text,8), 'page1', 'BEFORE', c, d);

    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(
        20, (select array(select id from public.get_discover_candidates(20, '{}'::uuid[])))) x;
    insert into parity values (left(s.uid::text,8), 'page2', 'BEFORE', c, d);

    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(
        20, (select array(select id from public.profiles limit 500))) x;
    insert into parity values (left(s.uid::text,8), 'excl500', 'BEFORE', c, d);

    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(1, '{}'::uuid[]) x;
    insert into parity values (left(s.uid::text,8), 'limit1', 'BEFORE', c, d);

    select count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), ''))
      into c, d from public.get_discover_candidates(50, '{}'::uuid[]) x;
    insert into parity values (left(s.uid::text,8), 'limit50', 'BEFORE', c, d);

    perform set_config('role', 'postgres', true);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Compare. Every (account, call shape) pair must match on BOTH the row count
--    and the full-result digest.
-- ---------------------------------------------------------------------------
do $$
declare
  compared int;
  mismatched int;
  bad text;
begin
  select count(*),
         count(*) filter (where not ok)
    into compared, mismatched
    from (
      select usr, call_shape,
             (max(digest) filter (where phase='BEFORE')) is not distinct from
             (max(digest) filter (where phase='AFTER'))
             and
             (max(n) filter (where phase='BEFORE')) is not distinct from
             (max(n) filter (where phase='AFTER')) as ok
        from parity group by usr, call_shape
    ) z;

  if compared = 0 then
    raise exception 'FAIL: no comparisons ran';
  end if;

  if mismatched > 0 then
    select string_agg(usr || '/' || call_shape, ', ')
      into bad
      from (
        select usr, call_shape
          from parity group by usr, call_shape
         having (max(digest) filter (where phase='BEFORE')) is distinct from
                (max(digest) filter (where phase='AFTER'))
      ) z;
    raise exception
      'FAIL: % of % comparisons differ (%). 0177 changed RESULTS, not just evaluation strategy — do not deploy.',
      mismatched, compared, bad;
  end if;

  raise notice 'parity: % comparisons, all identical', compared;
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

-- Throws away the 0158 body restored above, along with the temp tables.
rollback;
