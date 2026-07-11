-- =============================================================================
-- FAST SOCIO — Refactor Phase 5: XP, Levels, Achievements & Scoped Leaderboards.
--
-- Builds a progression layer on top of the existing single-source-of-truth Aura
-- ledger (aura_transactions) WITHOUT touching any existing award trigger:
--
--   * XP is derived from the ledger's POSITIVE deltas only, so a user's level is
--     a lifetime record of positive contribution that penalties never erode —
--     while Aura (net of penalties) remains the reputation signal. XP and level
--     are cached on profiles and recomputed by a trigger.
--   * Achievements are a data-driven catalog (metric + threshold). A single
--     SECURITY DEFINER checker runs whenever the ledger changes and grants any
--     newly-earned badge, its Aura reward (which flows back through the same
--     ledger, so it also counts as XP), and a notification.
--   * Scoped leaderboards (weekly / monthly / all-time, optionally filtered by
--     department or semester) via one additive RPC; the existing
--     get_weekly_leaderboard is left intact.
--
-- The 'achievement' reward reason is added to aura_reason. It is only ever
-- *used* at runtime (post-commit), never during this migration, so the
-- "unsafe use of new enum value before commit" restriction is not hit.
-- =============================================================================

set check_function_bodies = off;

-- New ledger reason for achievement rewards.
alter type public.aura_reason add value if not exists 'achievement';

-- ---------------------------------------------------------------------------
-- 1. XP + level cache on profiles.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists xp    integer not null default 0,
  add column if not exists level integer not null default 1;

-- Extend the self-escalation guard so users can't hand-edit xp/level either
-- (they may only change via the SECURITY DEFINER recompute below). Keeps every
-- previously-guarded column intact.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    new.aura_score := old.aura_score;
    new.is_admin   := old.is_admin;
    new.is_banned  := old.is_banned;
    new.xp         := old.xp;
    new.level      := old.level;
  end if;
  return new;
end;
$$;

-- Level curve. Cost to advance from level n → n+1 is (c_base * n) XP, so the
-- cumulative XP to REACH level L is (c_base/2)·L·(L-1). Inverting gives the
-- level for a given XP total. c_base is the single tuning knob (documented,
-- swappable for a config-table lookup later, mirroring the Phase 4 weights).
--   L2=50, L3=150, L4=300, L5=500, … (progressively harder)
create or replace function public.xp_level(p_xp integer)
returns integer
language sql
immutable
as $$
  -- c_base = 50  ⇒  8/c_base = 0.16
  select greatest(1, floor((1 + sqrt(1 + 0.16 * greatest(p_xp, 0))) / 2)::int);
$$;

-- Cumulative XP required to reach a given level (for progress bars).
create or replace function public.xp_for_level(p_level integer)
returns integer
language sql
immutable
as $$
  -- (c_base/2)·L·(L-1) with c_base = 50 ⇒ 25·L·(L-1)
  select (25 * greatest(p_level, 1) * (greatest(p_level, 1) - 1))::int;
$$;

-- Recompute XP (sum of positive deltas) + level whenever the ledger changes,
-- and fire a level-up notification when the cached level increases.
create or replace function public.recompute_xp_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target     uuid := coalesce(new.user_id, old.user_id);
  new_xp     integer;
  new_level  integer;
  old_level  integer;
begin
  select coalesce(level, 1) into old_level from public.profiles where id = target;

  select coalesce(sum(delta), 0)::int into new_xp
    from public.aura_transactions
    where user_id = target and delta > 0;

  new_level := public.xp_level(new_xp);

  update public.profiles
     set xp = new_xp, level = new_level
   where id = target;

  if new_level > coalesce(old_level, 1) then
    perform public.create_notification(
      target, null, 'level_up', 'system',
      jsonb_build_object('level', new_level)
    );
  end if;

  return null;
end;
$$;

create trigger aura_transactions_recompute_xp
  after insert or update or delete on public.aura_transactions
  for each row execute function public.recompute_xp_level();

-- Backfill XP/level for existing users from their current positive ledger. Pure
-- cache write (no new ledger rows) so it's safe inside this transaction.
update public.profiles p
   set xp = sub.xp, level = public.xp_level(sub.xp)
  from (
    select user_id, coalesce(sum(delta), 0)::int as xp
    from public.aura_transactions
    where delta > 0
    group by user_id
  ) sub
 where p.id = sub.user_id;

-- ---------------------------------------------------------------------------
-- 2. Achievements catalog (data-driven: metric + threshold).
-- ---------------------------------------------------------------------------
create table public.achievements (
  code         text primary key,
  title        text not null,
  description  text not null,
  icon         text not null,               -- emoji
  category     text not null default 'general',
  metric       text not null,               -- posts|comments|matches|events_attended|events_hosted|communities|aura
  threshold    integer not null,
  aura_reward  integer not null default 0,
  sort_order   integer not null default 0
);

alter table public.achievements enable row level security;

-- Catalog is public reference data.
create policy "achievements are public"
  on public.achievements for select to authenticated using (true);

insert into public.achievements
  (code, title, description, icon, category, metric, threshold, aura_reward, sort_order)
values
  ('first_post',      'First Post',      'Share your first post.',                     '📝', 'content',   'posts',           1,    5,  10),
  ('prolific',        'Prolific',        'Publish 10 posts.',                          '✍️', 'content',   'posts',          10,   15,  20),
  ('conversationalist','Conversationalist','Leave 25 comments.',                       '💬', 'content',   'comments',       25,   15,  30),
  ('social_butterfly','Social Butterfly','Make 5 matches.',                            '🦋', 'social',    'matches',         5,   15,  40),
  ('popular',         'Popular',         'Reach 20 matches.',                          '💞', 'social',    'matches',        20,   30,  50),
  ('joiner',          'Joiner',          'Join 3 communities.',                        '🤝', 'social',    'communities',     3,   10,  60),
  ('event_goer',      'Event Goer',      'Attend your first event.',                   '🎟️', 'events',    'events_attended', 1,   10,  70),
  ('event_regular',   'Regular',         'Attend 5 events.',                           '🗓️', 'events',    'events_attended', 5,   20,  80),
  ('event_organizer', 'Event Organizer', 'Host your first event.',                     '🎤', 'events',    'events_hosted',   1,   25,  90),
  ('rising_star',     'Rising Star',     'Reach 100 Aura.',                            '⭐', 'reputation','aura',          100,   20, 100),
  ('campus_legend',   'Campus Legend',   'Reach 1000 Aura.',                           '👑', 'reputation','aura',         1000,  100, 110);

-- ---------------------------------------------------------------------------
-- 3. user_achievements (one row per earned badge).
-- ---------------------------------------------------------------------------
create table public.user_achievements (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  code        text not null references public.achievements (code) on delete cascade,
  earned_at   timestamptz not null default now(),
  primary key (user_id, code)
);

create index user_achievements_user_idx on public.user_achievements (user_id, earned_at desc);

alter table public.user_achievements enable row level security;

-- Earned badges are shown on public profiles, so any authenticated user may read
-- them. Writes happen only via the SECURITY DEFINER checker (no insert policy).
create policy "user achievements are public"
  on public.user_achievements for select to authenticated using (true);

-- Grant any newly-satisfied achievements to a user, award their reward through
-- the Aura ledger, and notify. Idempotent (primary key + no-op on re-grant).
create or replace function public.check_achievements(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    with m as (
      select
        (select count(*) from public.posts          where author_id = p_user and not is_anonymous) as posts,
        (select count(*) from public.post_comments   where author_id = p_user)                       as comments,
        (select count(*) from public.matches         where user_low = p_user or user_high = p_user)  as matches,
        (select count(*) from public.event_attendees where user_id = p_user)                          as events_attended,
        (select count(*) from public.events          where host_id = p_user)                          as events_hosted,
        (select count(*) from public.community_members where user_id = p_user)                         as communities,
        -- Compute net Aura straight from the ledger (not the cached aura_score)
        -- so the just-inserted row is reflected regardless of trigger order.
        (select coalesce(sum(delta), 0) from public.aura_transactions where user_id = p_user)           as aura
    )
    insert into public.user_achievements (user_id, code)
    select p_user, a.code
    from public.achievements a, m
    where not exists (
        select 1 from public.user_achievements ua
        where ua.user_id = p_user and ua.code = a.code
      )
      and (case a.metric
             when 'posts'            then m.posts
             when 'comments'         then m.comments
             when 'matches'          then m.matches
             when 'events_attended'  then m.events_attended
             when 'events_hosted'    then m.events_hosted
             when 'communities'      then m.communities
             when 'aura'             then m.aura
             else 0
           end) >= a.threshold
    returning code
  loop
    -- Reward + notify per newly-earned badge.
    declare
      v_reward integer;
      v_title  text;
    begin
      select aura_reward, title into v_reward, v_title
        from public.achievements where code = rec.code;

      if v_reward > 0 then
        insert into public.aura_transactions (user_id, delta, reason, metadata)
          values (p_user, v_reward, 'achievement',
                  jsonb_build_object('code', rec.code));
      end if;

      perform public.create_notification(
        p_user, null, 'achievement', 'system',
        jsonb_build_object('code', rec.code, 'title', v_title)
      );
    end;
  end loop;
end;
$$;

-- Run the checker on every ledger change EXCEPT achievement rewards themselves
-- (guard prevents infinite recursion: a reward insert must not re-check).
create or replace function public.trg_check_achievements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reason is distinct from 'achievement' then
    perform public.check_achievements(new.user_id);
  end if;
  return null;
end;
$$;

create trigger aura_transactions_check_achievements
  after insert on public.aura_transactions
  for each row execute function public.trg_check_achievements();

-- ---------------------------------------------------------------------------
-- 4. Scoped leaderboards (weekly / monthly / all-time × dept / semester).
-- ---------------------------------------------------------------------------

-- Month start in Pakistan time, as a timestamptz instant (mirrors
-- current_week_start from mig 0012).
create or replace function public.current_month_start()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('month', (now() at time zone 'Asia/Karachi')) at time zone 'Asia/Karachi');
$$;

-- Unified board. period: 'weekly' | 'monthly' | 'alltime'. Optional dept and
-- semester filters are applied to the candidate set (null = no filter). Weekly
-- and monthly aggregate ledger deltas within the window; all-time uses the
-- cached net aura_score. Returns the same shape as get_weekly_leaderboard.
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
    rank() over (order by score desc) as rank
  from totals
  where score > 0
  order by score desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.get_scoped_leaderboard(text, text, smallint, integer) from public;
revoke execute on function public.get_scoped_leaderboard(text, text, smallint, integer) from anon;
grant execute on function public.get_scoped_leaderboard(text, text, smallint, integer) to authenticated;

grant execute on function public.xp_level(integer) to authenticated;
grant execute on function public.xp_for_level(integer) to authenticated;
