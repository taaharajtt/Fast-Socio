-- =============================================================================
-- FAST SOCIO — notify matches on a new post + dense leaderboard ranking
--
--   1. notify_match_post  — your matches hear about it when you post.
--   2. get_scoped_leaderboard — rank() → dense_rank() so ties don't skip a place.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Notify every match when a user posts.
--
-- Anonymous posts are skipped outright: telling your matches "X posted" about a
-- post that renders as Anonymous would de-anonymise it. Community posts are
-- skipped too — they start life pending moderation, so a notification could
-- point at a post that never gets approved. Main-feed, attributed posts only.
--
-- Respects the recipient's `matches` notification preference (create_notification
-- checks it) and never self-notifies.
-- ---------------------------------------------------------------------------
create or replace function public.notify_match_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.is_anonymous or new.community_id is not null then
    return null;
  end if;

  -- matches stores the pair as (user_low, user_high); the partner is whichever
  -- side isn't the author.
  for r in
    select case when m.user_low = new.author_id then m.user_high else m.user_low end as partner
    from public.matches m
    where m.user_low = new.author_id or m.user_high = new.author_id
  loop
    perform public.create_notification(
      r.partner, new.author_id, 'match_post', 'matches',
      jsonb_build_object('post_id', new.id)
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists posts_notify_matches on public.posts;
create trigger posts_notify_matches
  after insert on public.posts
  for each row execute function public.notify_match_post();

-- ---------------------------------------------------------------------------
-- 2. Dense ranking on the leaderboard.
--
-- rank() skips places after a tie: two people tied at 1st were followed by 3rd.
-- dense_rank() gives 1, 1, 2, 3, 3 — the next distinct score always takes the
-- next place. Body is otherwise byte-for-byte the previous definition.
-- ---------------------------------------------------------------------------
create or replace function public.get_scoped_leaderboard(
  p_period     text default 'weekly',
  p_department text default null,
  p_semester   smallint default null,
  p_limit      integer default 50
)
returns table(
  user_id uuid, full_name text, avatar_url text, department text,
  weekly_aura bigint, rank bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with since as (
    select case p_period when 'monthly' then public.current_month_start()
             when 'alltime' then null::timestamptz else public.current_week_start() end as from_ts
  ),
  eligible as (
    select p.id, p.full_name, p.avatar_url, p.department from public.profiles p
    where p.is_banned = false
      and (p_department is null or p.department = p_department)
      and (p_semester is null or p.semester = p_semester)
  ),
  totals as (
    select e.id, e.full_name, e.avatar_url, e.department,
      case when (select from_ts from since) is null
        then (select coalesce(aura_score, 0) from public.profiles where id = e.id)::bigint
        else coalesce((select sum(a.delta) from public.aura_transactions a
          where a.user_id = e.id and a.created_at >= (select from_ts from since)), 0)::bigint
      end as score
    from eligible e
  )
  select id, full_name, avatar_url, department, score as weekly_aura,
    dense_rank() over (order by score desc) as rank
  from totals where score > 0 order by score desc limit greatest(1, least(p_limit, 100));
$function$;
