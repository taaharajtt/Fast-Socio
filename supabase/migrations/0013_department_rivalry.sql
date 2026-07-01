-- =============================================================================
-- FAST SOCIO — Department Rivalry (Phase 9)
-- OQ-7: PER-CAPITA scoring — departments ranked by average Aura earned per
-- member this week (fair to smaller departments). Weekly snapshot on the same
-- Monday 00:00 PKT cadence as the leaderboard. Aggregates across all users, so
-- reads go through a SECURITY DEFINER function (aura_transactions RLS is per-user).
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- department_rivalry_snapshots
-- ---------------------------------------------------------------------------
create table public.department_rivalry_snapshots (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null,
  department    text not null,
  member_count  integer not null,
  total_aura    integer not null,
  per_capita    numeric(10, 2) not null,
  rank          integer not null,
  created_at    timestamptz not null default now(),
  unique (week_start, department)
);

create index dept_rivalry_week_idx on public.department_rivalry_snapshots (week_start, rank);

alter table public.department_rivalry_snapshots enable row level security;

create policy "department rivalry snapshots are public"
  on public.department_rivalry_snapshots for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Live current-week per-capita rivalry.
-- ---------------------------------------------------------------------------
create or replace function public.get_department_rivalry()
returns table (
  department    text,
  member_count  bigint,
  total_aura    bigint,
  per_capita    numeric,
  rank          bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.department,
    count(distinct p.id) as member_count,
    coalesce(sum(a.delta), 0)::bigint as total_aura,
    round(coalesce(sum(a.delta), 0)::numeric / count(distinct p.id), 1) as per_capita,
    rank() over (
      order by coalesce(sum(a.delta), 0)::numeric / count(distinct p.id) desc
    ) as rank
  from public.profiles p
  left join public.aura_transactions a
    on a.user_id = p.id and a.created_at >= public.current_week_start()
  where p.department is not null
    and p.is_banned = false
    and p.onboarding_completed = true
  group by p.department
  having count(distinct p.id) > 0
  order by per_capita desc;
$$;

revoke all on function public.get_department_rivalry() from public;
grant execute on function public.get_department_rivalry() to authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot the just-ended week (pg_cron at Monday 00:00 PKT).
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_department_rivalry()
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
  insert into public.department_rivalry_snapshots
    (week_start, department, member_count, total_aura, per_capita, rank)
  select
    prev_week_date,
    ranked.department,
    ranked.member_count,
    ranked.total_aura,
    ranked.per_capita,
    ranked.rnk
  from (
    select
      p.department,
      count(distinct p.id) as member_count,
      coalesce(sum(a.delta), 0)::int as total_aura,
      round(coalesce(sum(a.delta), 0)::numeric / count(distinct p.id), 2) as per_capita,
      rank() over (
        order by coalesce(sum(a.delta), 0)::numeric / count(distinct p.id) desc
      ) as rnk
    from public.profiles p
    left join public.aura_transactions a
      on a.user_id = p.id and a.created_at >= prev_start and a.created_at < cur_start
    where p.department is not null
      and p.is_banned = false
      and p.onboarding_completed = true
    group by p.department
    having count(distinct p.id) > 0
  ) ranked
  on conflict (week_start, department) do nothing;
end;
$$;

-- Same schedule as the individual leaderboard snapshot.
select cron.schedule(
  'department-rivalry-weekly-snapshot',
  '0 19 * * 0',
  $$select public.snapshot_department_rivalry()$$
);
