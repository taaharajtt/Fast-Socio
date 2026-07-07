-- =============================================================================
-- FAST SOCIO — Discover never runs empty (audit P4-05 / product request)
--
-- get_discover_candidates only returned profiles the caller had NEVER swiped, so
-- the deck eventually emptied. New behaviour: when fresh (never-swiped)
-- candidates run low, recycle profiles the caller previously LIKED but has not
-- matched with yet — so a right-swipe can still turn into a match on a second
-- pass, and the deck is never empty while eligible people exist.
--
-- Ordering: fresh candidates first (newest-first), then recycled likes. Passed
-- profiles and existing matches are still excluded; blocks and self are still
-- excluded. Recycled rows are tagged so the client can treat them normally.
-- =============================================================================

set check_function_bodies = off;

-- Return type gains an `is_recycled` flag; drop+recreate (can't change signature
-- with CREATE OR REPLACE when the OUT/return shape changes).
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
  is_recycled           boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (select auth.uid() as uid),
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
  ),
  -- Never-swiped candidates.
  fresh as (
    select b.*, false as is_recycled, 0 as tier, b.created_at as sort_key
    from base b, me
    where not exists (
      select 1 from public.swipes s
      where s.swiper_id = me.uid and s.target_id = b.id
    )
  ),
  -- Previously LIKED but not yet matched — recycled so a match is still possible.
  recycled as (
    select b.*, true as is_recycled, 1 as tier, s.created_at as sort_key
    from base b
    join me on true
    join public.swipes s
      on s.swiper_id = me.uid and s.target_id = b.id and s.direction = 'like'
    where not exists (
      select 1 from public.matches m
      where m.user_low = least(me.uid, b.id)
        and m.user_high = greatest(me.uid, b.id)
    )
  ),
  merged as (
    select * from fresh
    union all
    select * from recycled
  )
  select
    id, full_name, department, semester, bio, avatar_url,
    interests, gender, aura_score, is_recycled
  from merged
  order by tier asc, sort_key desc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.get_discover_candidates(integer) from public;
grant execute on function public.get_discover_candidates(integer) to authenticated;
