-- =============================================================================
-- FAST SOCIO — Leaderboard (Phase 8)
-- Weekly board: ranks Aura EARNED since Monday 00:00 PKT (all-time aura_score
-- never resets). OQ-4: reset Monday 00:00 PKT. A pg_cron job snapshots the
-- ending week's top standings + titles at rollover. Reads go through SECURITY
-- DEFINER functions because aura_transactions RLS is per-user.
-- =============================================================================

set check_function_bodies = off;

create extension if not exists pg_cron;

-- Monday 00:00 in Pakistan time, as a timestamptz instant.
create or replace function public.current_week_start()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('week', (now() at time zone 'Asia/Karachi')) at time zone 'Asia/Karachi');
$$;

-- ---------------------------------------------------------------------------
-- leaderboard_snapshots: final standings of a completed week.
-- ---------------------------------------------------------------------------
create table public.leaderboard_snapshots (
  id           uuid primary key default gen_random_uuid(),
  week_start   date not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  rank         integer not null,
  weekly_aura  integer not null,
  title        text,
  created_at   timestamptz not null default now(),
  unique (week_start, user_id)
);

create index leaderboard_snapshots_week_idx on public.leaderboard_snapshots (week_start, rank);

alter table public.leaderboard_snapshots enable row level security;

create policy "leaderboard snapshots are public"
  on public.leaderboard_snapshots for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Live current-week leaderboard (aggregates across all users).
-- ---------------------------------------------------------------------------
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
    rank() over (order by coalesce(sum(a.delta), 0) desc) as rank
  from public.profiles p
  join public.aura_transactions a
    on a.user_id = p.id and a.created_at >= public.current_week_start()
  where p.is_banned = false
  group by p.id, p.full_name, p.avatar_url, p.department
  having sum(a.delta) > 0
  order by weekly_aura desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.get_weekly_leaderboard(integer) from public;
grant execute on function public.get_weekly_leaderboard(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot the just-ended week (called by pg_cron at Monday 00:00 PKT).
-- ---------------------------------------------------------------------------
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
      rank() over (order by sum(a.delta) desc) as rnk
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

-- ---------------------------------------------------------------------------
-- Schedule: Monday 00:00 PKT == Sunday 19:00 UTC (PKT = UTC+5).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'leaderboard-weekly-snapshot',
  '0 19 * * 0',
  $$select public.snapshot_leaderboard()$$
);
