-- Expose gender from both leaderboard RPCs so the client can render the
-- gendered default avatar (boy.jpg/girl.jpg) when a ranked student has no
-- avatar_url. get_weekly_leaderboard feeds the department-rivalry avatar
-- stack (leaderboard/page.tsx); get_scoped_leaderboard feeds the student
-- rankings list (leaderboard/actions.ts) — both are live call sites.
set check_function_bodies = off;

create or replace function public.get_weekly_leaderboard(p_limit integer default 50)
returns table (
  user_id     uuid,
  full_name   text,
  avatar_url  text,
  gender      text,
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
    p.gender,
    p.department,
    coalesce(sum(a.delta), 0)::bigint as weekly_aura,
    dense_rank() over (order by coalesce(sum(a.delta), 0) desc) as rank
  from public.profiles p
  join public.aura_transactions a
    on a.user_id = p.id and a.created_at >= public.current_week_start()
  where p.is_banned = false
  group by p.id, p.full_name, p.avatar_url, p.gender, p.department
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
  gender      text,
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
    select p.id, p.full_name, p.avatar_url, p.gender, p.department
    from public.profiles p
    where p.is_banned = false
      and (p_department is null or p.department = p_department)
      and (p_semester is null or p.semester = p_semester)
  ),
  totals as (
    select
      e.id, e.full_name, e.avatar_url, e.gender, e.department,
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
    id, full_name, avatar_url, gender, department,
    score as weekly_aura,
    dense_rank() over (order by score desc) as rank
  from totals
  where score > 0
  order by score desc
  limit greatest(1, least(p_limit, 100));
$$;
