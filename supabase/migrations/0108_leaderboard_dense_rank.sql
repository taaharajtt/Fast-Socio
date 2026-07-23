-- Leaderboard numbering looked "broken" whenever two or more students tied on
-- Aura: `rank() over (...)` (SQL competition ranking) SKIPS ranks after a tie —
-- e.g. two people tied at #5 push the next student to #7, not #6 — and the
-- client then hard-sliced to the first 10 PHYSICAL ROWS, which could also cut
-- a tied group in half (showing 2 of 3 people sharing a rank while hiding the
-- third). Desired behavior: dense ranking (ties share a rank, the next rank is
-- always +1 with no gap — 1,2,3,4,5,5,6,7,8,8,8,9,10), and "top 10" means every
-- row whose rank is <= 10, however many rows that turns out to be.
--
-- This migration only swaps rank() -> dense_rank() in both leaderboard RPCs
-- (and the weekly snapshot job, for the same reason); the "top 10 by rank, not
-- by row count" half of the fix lives in the client (leaderboard/page.tsx +
-- leaderboard/actions.ts), which now filters `rank <= 10` instead of slicing
-- the first 10 rows.
set check_function_bodies = off;

create or replace function public.get_weekly_leaderboard(p_limit integer default 50)
returns table (
  user_id     uuid,
  full_name   text,
  avatar_url  text,
  department  text,
  weekly_aura bigint,
  rank        bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.full_name,
    p.avatar_url,
    p.department,
    coalesce(sum(a.delta), 0)::bigint as weekly_aura,
    dense_rank() over (order by coalesce(sum(a.delta), 0) desc) as rank
  from public.profiles p
  join public.aura_transactions a
    on a.user_id = p.id and a.created_at >= public.current_week_start()
  where p.is_banned = false
  group by p.id, p.full_name, p.avatar_url, p.department
  having sum(a.delta) > 0
  order by weekly_aura desc
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function public.get_scoped_leaderboard(
  p_period     text default 'weekly',
  p_department text default null,
  p_semester   smallint default null,
  p_limit      integer default 50
)
returns table (
  user_id     uuid,
  full_name   text,
  avatar_url  text,
  department  text,
  weekly_aura bigint,
  rank        bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with since as (
    select case p_period
             when 'monthly' then public.current_month_start()
             when 'alltime' then null::timestamptz
             else public.current_week_start()
           end as from_ts
  ),
  eligible as (
    select p.id, p.full_name, p.avatar_url, p.department
    from public.profiles p
    where p.is_banned = false
      and (p_department is null or p.department = p_department)
      and (p_semester is null or p.semester = p_semester)
  ),
  totals as (
    select
      e.id, e.full_name, e.avatar_url, e.department,
      case
        when (select from_ts from since) is null
          then (select coalesce(aura_score, 0) from public.profiles where id = e.id)::bigint
        else coalesce((
          select sum(a.delta) from public.aura_transactions a
          where a.user_id = e.id and a.created_at >= (select from_ts from since)
        ), 0)::bigint
      end as score
    from eligible e
  )
  select
    id, full_name, avatar_url, department,
    score as weekly_aura,
    dense_rank() over (order by score desc) as rank
  from totals
  where score > 0
  order by score desc
  limit greatest(1, least(p_limit, 100));
$$;

-- Weekly snapshot job: same tie-handling fix, so a shared #1 correctly grants
-- "Main Character" to everyone tied for it rather than an arbitrary one.
create or replace function public.snapshot_leaderboard()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_start timestamptz := public.current_week_start();
  prev_start timestamptz := cur_start - interval '7 days';
  prev_week_date date := (prev_start at time zone 'Asia/Karachi')::date;
begin
  insert into public.leaderboard_snapshots (week_start, user_id, rank, weekly_aura, title)
  select
    prev_week_date,
    ranked.user_id,
    ranked.rnk,
    ranked.weekly_aura,
    case ranked.rnk
      when 1 then 'Main Character'
      when 2 then 'Campus Celebrity'
      when 3 then 'Aura Farmer'
      else null
    end
  from (
    select
      a.user_id,
      sum(a.delta)::int as weekly_aura,
      dense_rank() over (order by sum(a.delta) desc) as rnk
    from public.aura_transactions a
    join public.profiles p on p.id = a.user_id and p.is_banned = false
    where a.created_at >= prev_start and a.created_at < cur_start
    group by a.user_id
    having sum(a.delta) > 0
  ) ranked
  where ranked.rnk <= 50
  on conflict (week_start, user_id) do nothing;
end;
$$;
