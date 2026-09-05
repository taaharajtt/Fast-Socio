-- =============================================================================
-- 0191 — the 100 Aura welcome gift.
--
-- WHAT IT IS: one +100 ledger entry, written once, at the moment a Supabase
-- Auth account is first created. Not a login reward, not a daily reward, and
-- not something a user can ask for.
--
-- ---------------------------------------------------------------------------
-- WHY IT CANNOT FIRE TWICE, AND WHY LOGIN CANNOT FIRE IT AT ALL
--
-- Two independent guarantees, either of which would be enough on its own:
--
--   TIMING     The award lives in handle_new_user(), which runs from
--              `on_auth_user_created` — verified against the live database as
--              AFTER INSERT ON auth.users. Signing in, refreshing a session,
--              confirming an email, resetting a password, finishing or
--              resuming onboarding, and reactivating an account are all
--              UPDATEs to auth.users (or do not touch it at all), so none of
--              them reach this code path. The only INSERT into auth.users is
--              the creation of a genuinely new account.
--
--   UNIQUENESS A partial unique index permits at most ONE signup_bonus row per
--              user, and the insert is `on conflict ... do nothing`. Even if
--              some future path called the bootstrap again, or two calls
--              raced, the database — not a SELECT EXISTS, not a flag, not a
--              cookie, not a server action — makes the second one a no-op.
--
-- ---------------------------------------------------------------------------
-- IT IS A GIFT, NOT EARNED PARTICIPATION. Three deliberate exclusions:
--
--   XP      The welcome gift writes a LEDGER ROW ONLY, with no row in
--           `aura_grants`. Since migration 0186, XP is the sum of ACTIVE
--           GRANTS, so a grant-less reward contributes no XP by construction —
--           there is no special case to add and no filter to forget later. A
--           new account starts at 100 Aura and level 1, which is the intent:
--           they hold 100 points and have not yet done anything.
--
--   RANKING The five weekly ranking functions are carried forward below with
--           one added predicate each, so a brand-new account cannot appear on
--           the leaderboard, or move its department's rivalry score, purely by
--           having registered that week.
--
--   STREAK  achievement_metric_value no longer counts the signup day as a day
--           of contribution.
--
--   The one achievement it does legitimately count toward is
--   `aura_follows_you`, which is explicitly a CURRENT BALANCE badge (1000
--   Aura, migration 0151). 100 of that 1000 may come from the welcome gift:
--   the badge measures what you hold, and the gift is genuinely held. Stated
--   here rather than silently allowed.
--
-- ---------------------------------------------------------------------------
-- EXISTING USERS ARE NOT TOUCHED. There is no backfill, and deploying this
-- migration writes no ledger row for anybody: the only INSERT lives inside a
-- trigger that fires on future account creation. Existing balances, XP, levels
-- and badges are all exactly as they were.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The uniqueness rule — one welcome gift per user, enforced by the index.
-- ---------------------------------------------------------------------------
-- This is what makes the award concurrency-safe and retry-safe, and it is the
-- ON CONFLICT inference target below, so the loser of a race is discarded
-- silently instead of raising.
create unique index if not exists aura_transactions_signup_bonus_uidx
  on public.aura_transactions (user_id)
  where reason = 'signup_bonus';

-- ---------------------------------------------------------------------------
-- 2. handle_new_user — carried forward from 0094, with the award appended.
-- ---------------------------------------------------------------------------
-- 0001's version is NOT the one running: 0094 replaced it to derive the
-- username from the roll number and handle collisions. Everything it does is
-- preserved verbatim — the base handle, the degenerate-email fallback, the
-- collision loop, the full_name metadata, the profile insert, the notification
-- preferences, SECURITY DEFINER, the pinned search_path, and the trigger's
-- signature and return value.
--
-- The ledger insert comes LAST, after the profile exists, because
-- aura_transactions.user_id references profiles(id). It is guarded on the
-- profile actually being present: if the profile insert lost a conflict race
-- there is nothing to credit, and the foreign key would reject the row anyway.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base     text := public.username_from_email(new.email);
  v_username text;
  v_suffix   int := 0;
begin
  -- Degenerate fallback (an email whose local-part sanitizes to < 3 chars): a
  -- stable derived handle so the NOT-empty username invariant always holds.
  if length(v_base) < 3 then
    v_base := left('user' || replace(new.id::text, '-', ''), 20);
  end if;

  v_username := v_base;
  while exists (select 1 from public.profiles where username = v_username) loop
    v_suffix := v_suffix + 1;
    v_username := left(v_base, 20 - length(v_suffix::text)) || v_suffix::text;
  end loop;

  insert into public.profiles (id, full_name, username)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', null),
      v_username
    )
    on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

  -- The welcome gift. The metadata carries a source tag and NOTHING else — no
  -- email, no name, no invite code, nothing identifying beyond the user_id the
  -- row is already keyed on.
  if exists (select 1 from public.profiles where id = new.id) then
    insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (new.id, 100, 'signup_bonus',
            jsonb_build_object('source', 'welcome_invitation'))
    on conflict (user_id) where reason = 'signup_bonus' do nothing;
  end if;

  return new;
end;
$$;

-- Unchanged posture: definer, executed by the auth trigger as the owner, and
-- not callable by a client. No RPC anywhere claims this reward.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Keep it out of the weekly rankings.
-- ---------------------------------------------------------------------------
-- All five functions below were fetched from the LIVE database with
-- pg_get_functiondef and are reproduced exactly, with a single added predicate
-- on their ledger read. Fetching rather than copying an old migration file is
-- deliberate: 0012, 0013, 0108 and 0124 each redefined some of these, and the
-- file that defines a function is not reliably the one that is running.
--
-- CREATE OR REPLACE preserves existing privileges, so no grants change here.

-- get_department_rivalry: deployed definition, carried forward verbatim with the
-- one added predicate. Fetched with pg_get_functiondef so this is what is
-- actually running, not what an old migration file says.
CREATE OR REPLACE FUNCTION public.get_department_rivalry()
 RETURNS TABLE(department text, member_count bigint, total_aura bigint, per_capita numeric, rank bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and a.reason <> 'signup_bonus'
  where p.department is not null
    and p.is_banned = false
    and p.onboarding_completed = true
  group by p.department
  having count(distinct p.id) > 0
  order by per_capita desc;
$function$
;

-- get_scoped_leaderboard: deployed definition, carried forward verbatim with the
-- one added predicate. Fetched with pg_get_functiondef so this is what is
-- actually running, not what an old migration file says.
CREATE OR REPLACE FUNCTION public.get_scoped_leaderboard(p_period text DEFAULT 'weekly'::text, p_department text DEFAULT NULL::text, p_semester smallint DEFAULT NULL::smallint, p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, gender text, department text, weekly_aura bigint, rank bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and a.reason <> 'signup_bonus'
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
$function$
;

-- get_weekly_leaderboard: deployed definition, carried forward verbatim with the
-- one added predicate. Fetched with pg_get_functiondef so this is what is
-- actually running, not what an old migration file says.
CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, gender text, department text, weekly_aura bigint, rank bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and a.reason <> 'signup_bonus'
  where p.is_banned = false
  group by p.id, p.full_name, p.avatar_url, p.gender, p.department
  having sum(a.delta) > 0
  order by weekly_aura desc
  limit greatest(1, least(p_limit, 100));
$function$
;

-- snapshot_department_rivalry: deployed definition, carried forward verbatim with the
-- one added predicate. Fetched with pg_get_functiondef so this is what is
-- actually running, not what an old migration file says.
CREATE OR REPLACE FUNCTION public.snapshot_department_rivalry()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and a.reason <> 'signup_bonus'
    where p.department is not null
      and p.is_banned = false
      and p.onboarding_completed = true
    group by p.department
    having count(distinct p.id) > 0
  ) ranked
  on conflict (week_start, department) do nothing;
end;
$function$
;

-- snapshot_leaderboard: deployed definition, carried forward verbatim with the
-- one added predicate. Fetched with pg_get_functiondef so this is what is
-- actually running, not what an old migration file says.
CREATE OR REPLACE FUNCTION public.snapshot_leaderboard()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cur_start timestamptz := public.current_week_start();
  prev_start timestamptz := cur_start - interval '7 days';
  prev_week_date date := (prev_start at time zone 'Asia/Karachi')::date;
  rec record;
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
       and a.reason <> 'signup_bonus'
    group by a.user_id
    having sum(a.delta) > 0
  ) ranked
  where ranked.rnk <= 50
  on conflict (week_start, user_id) do nothing;

  for rec in (
    select user_id, rank, weekly_aura, title
      from public.leaderboard_snapshots
     where week_start = prev_week_date
       and rank <= 10
  )
  loop
    perform public.create_notification(
      rec.user_id, null, 'leaderboard_top_finish', 'likes',
      jsonb_build_object('rank', rec.rank, 'title', rec.title, 'weekly_aura', rec.weekly_aura)
    );
  end loop;
end;
$function$
;


-- ---------------------------------------------------------------------------
-- 4. Keep it out of the contribution streak.
-- ---------------------------------------------------------------------------
-- Carried forward from 0188 with one predicate added to the streak metric.
-- Everything else in the function is untouched.
create or replace function public.achievement_metric_value(
  p_user   uuid,
  p_metric text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case p_metric
    when 'posts' then
      (select count(*) from public.posts
        where author_id = p_user and not is_anonymous)
    when 'matches' then
      (select count(*) from public.matches
        where user_low = p_user or user_high = p_user)
    when 'communities' then
      (select count(*) from public.community_members where user_id = p_user)
    when 'aura_current' then
      (select coalesce(sum(delta), 0) from public.aura_transactions
        where user_id = p_user)
    when 'aura_alltime' then
      (select coalesce(sum(delta), 0) from public.aura_transactions
        where user_id = p_user)
    when 'interactions' then
      (select count(*) from (
          select case when c.user_low = p_user then c.user_high else c.user_low end
            from public.conversations c
            where exists (
              select 1 from public.messages msg
              where msg.conversation_id = c.id and msg.sender_id = p_user
            ) and p_user in (c.user_low, c.user_high)
          union
          select p.author_id
            from public.post_comments pc
            join public.posts p on p.id = pc.post_id
            where pc.author_id = p_user and p.author_id <> p_user
          union
          select parent.author_id
            from public.post_comments pc
            join public.post_comments parent on parent.id = pc.parent_id
            where pc.author_id = p_user and parent.author_id <> p_user
        ) others)
    -- "Successful event" now means ten people who ACTUALLY TURNED UP, counted
    -- from the immutable check-in evidence rather than from RSVP rows the host
    -- could have manufactured and then deleted. Left PERMANENT once earned
    -- (see achievement_metric_reversible), so no existing host loses a badge to
    -- this change — it only makes future earning honest.
    when 'events_hosted_big' then
      (select count(*) from public.events e
        where e.host_id = p_user
          and e.status = 'approved'
          and (select count(*) from public.event_checkins ec
                where ec.event_id = e.id) >= 10)
    when 'streak' then
      (select coalesce(max(run), 0) from (
          select count(*) as run
          from (
            select d, d - (row_number() over (order by d))::int as grp
            from (
              select distinct (created_at at time zone 'Asia/Karachi')::date as d
              from public.aura_transactions
              where user_id = p_user and delta > 0
                -- Registering is not a day of contribution. Without this
                -- the welcome gift would seed day 1 of every user's streak.
                and reason <> 'signup_bonus'
            ) days
          ) islands
          group by grp
        ) runs)
    else 0
  end;
$$;

revoke all on function public.achievement_metric_value(uuid, text) from public, anon, authenticated;

-- =============================================================================
-- VERIFY
--   -- Applying this migration must award nobody:
--   select count(*) from public.aura_transactions where reason = 'signup_bonus';
--   -- must be 0 immediately after applying.
--
--   -- The index is what enforces one-per-user:
--   select indexdef from pg_indexes
--    where indexname = 'aura_transactions_signup_bonus_uidx';
--
--   supabase/tests/signup_welcome_bonus.sql exercises the whole rule.
--
-- ROLLBACK
--   Re-run 0094's handle_new_user(), 0188's achievement_metric_value(), and the
--   five ranking functions as they stood before this migration, then:
--     drop index if exists public.aura_transactions_signup_bonus_uidx;
--   Ledger rows already written are real Aura and are NOT removed by a
--   rollback; delete them explicitly if the feature is being withdrawn.
-- =============================================================================
