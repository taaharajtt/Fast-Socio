-- =============================================================================
-- FAST SOCIO — Discover recycling, take 2 (UAT-002)
--
-- Requested behaviour:
--   * People you MATCH with never come back in Discover.
--   * People you passed on (or liked-without-matching) come back around — but
--     only once you're "caught up" on everyone you've never seen.
--
-- 0029 already recycled likes-without-match; it dropped passes entirely, so a
-- pass removed a profile forever. Now BOTH prior decisions are recycled:
--   tier 0  fresh   — never swiped (newest-first)
--   tier 1  seen    — swiped like OR pass, but NOT matched (oldest swipe first,
--                     so the least-recently-seen resurface first)
-- Matches, blocks, self, banned and un-onboarded profiles stay excluded.
--
-- `is_recycled` still flags tier-1 rows; the client already treats them the
-- same, so no app change is required.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Re-deciding a resurfaced profile must UPDATE its swipe (new timestamp → back
-- of the queue) instead of being a silent no-op. That needs an UPDATE policy;
-- add a DELETE policy too, which also makes undoSwipe() actually delete (it was
-- a silent RLS no-op before — no DELETE policy existed).
-- ---------------------------------------------------------------------------
drop policy if exists "users update their own swipes" on public.swipes;
create policy "users update their own swipes"
  on public.swipes for update to authenticated
  using (swiper_id = auth.uid()) with check (swiper_id = auth.uid());

drop policy if exists "users delete their own swipes" on public.swipes;
create policy "users delete their own swipes"
  on public.swipes for delete to authenticated
  using (swiper_id = auth.uid());

-- ---------------------------------------------------------------------------
-- handle_swipe_match now fires on INSERT OR UPDATE (a pass you later flip to a
-- like on resurface must still be able to form a match). The Aura award is
-- guarded to the moment the match row is genuinely created, so re-firing the
-- trigger on an already-matched pair can't double-award (belt and braces —
-- matched pairs are excluded from Discover anyway).
-- ---------------------------------------------------------------------------
create or replace function public.handle_swipe_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reciprocal boolean;
  lo uuid;
  hi uuid;
  inserted boolean := false;
begin
  if new.direction <> 'like' then
    return new;
  end if;

  select exists (
    select 1 from public.swipes s
    where s.swiper_id = new.target_id
      and s.target_id = new.swiper_id
      and s.direction = 'like'
  ) into reciprocal;

  if reciprocal then
    lo := least(new.swiper_id, new.target_id);
    hi := greatest(new.swiper_id, new.target_id);

    with ins as (
      insert into public.matches (user_low, user_high)
        values (lo, hi)
        on conflict (user_low, user_high) do nothing
      returning 1
    )
    select exists (select 1 from ins) into inserted;

    -- Award Aura ONLY for a brand-new match, never on a re-fire.
    if inserted then
      insert into public.aura_transactions (user_id, delta, reason)
        values (new.swiper_id, 10, 'match'), (new.target_id, 10, 'match');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists swipes_match_check on public.swipes;
create trigger swipes_match_check
  after insert or update on public.swipes
  for each row execute function public.handle_swipe_match();

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
      -- Never resurface a match.
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
  -- Anyone previously swiped (like or pass) who isn't a match — resurface them,
  -- least-recently-decided first (ascending swipe time).
  seen as (
    select b.*, true as is_recycled, 1 as tier, s.created_at as sort_key
    from base b
    join me on true
    join public.swipes s
      on s.swiper_id = me.uid and s.target_id = b.id
  ),
  merged as (
    select * from fresh
    union all
    select * from seen
  )
  select
    id, full_name, department, semester, bio, avatar_url,
    interests, gender, aura_score, is_recycled
  from merged
  -- Fresh first (newest fresh, sort_key desc); then recycled oldest-first. The
  -- flip in direction per tier is why sort_key is ordered by tier alongside a
  -- CASE rather than a single global direction.
  order by tier asc,
           case when tier = 0 then sort_key end desc nulls last,
           case when tier = 1 then sort_key end asc nulls last
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.get_discover_candidates(integer) from public;
revoke execute on function public.get_discover_candidates(integer) from anon;
grant execute on function public.get_discover_candidates(integer) to authenticated;
