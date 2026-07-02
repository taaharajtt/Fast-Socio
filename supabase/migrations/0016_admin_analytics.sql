-- =============================================================================
-- 0016_admin_analytics.sql — Phase 11 (Admin Dashboard)
--
-- One admin-guarded SECURITY DEFINER function that returns a consolidated KPI
-- payload for the /admin landing dashboard. It reads across tables whose RLS is
-- per-user (swipes, messages, matches, …), so a plain admin query cannot count
-- them; a SECURITY DEFINER function is the established pattern here (see
-- get_weekly_leaderboard / get_department_rivalry).
--
-- Returns a single jsonb object so the Server Component can consume one round
-- trip. Every metric is computed at the DB; no PII leaves the function beyond
-- aggregate counts.
--
-- The moderation-audit-log viewer needs no new object: admins can already SELECT
-- moderation_audit_log directly (RLS policy "admins read moderation audit log").
-- =============================================================================
set check_function_bodies = off;

create or replace function public.get_admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;

  with
  -- Every user-attributable action with its timestamp, for DAU/WAU.
  activity as (
    select swiper_id as uid, created_at as ts from public.swipes
    union all
    select sender_id, created_at from public.messages
    union all
    select author_id, created_at from public.posts
    union all
    select user_id, created_at from public.post_likes
    union all
    select author_id, created_at from public.post_comments
    union all
    select user_id, created_at from public.event_attendees
    union all
    select user_id, joined_at from public.community_members
  )
  select jsonb_build_object(
    'students_total',
      (select count(*) from public.profiles),
    'students_banned',
      (select count(*) from public.profiles where is_banned),
    'signups_24h',
      (select count(*) from public.profiles where created_at >= now() - interval '24 hours'),
    'signups_7d',
      (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'dau',
      (select count(distinct uid) from activity where ts >= now() - interval '24 hours'),
    'wau',
      (select count(distinct uid) from activity where ts >= now() - interval '7 days'),
    'matches_total',
      (select count(*) from public.matches),
    'matches_7d',
      (select count(*) from public.matches where created_at >= now() - interval '7 days'),
    'right_swipes',
      (select count(*) from public.swipes where direction = 'like'),
    -- Each match consumes two mutual right-swipes; express as the % of
    -- right-swipes that ended up reciprocated into a match.
    'match_rate_pct',
      (select case
        when count(*) filter (where direction = 'like') = 0 then 0
        else round(
          100.0 * 2 * (select count(*) from public.matches)
          / count(*) filter (where direction = 'like')
        )::int
      end from public.swipes),
    'posts_total',
      (select count(*) from public.posts),
    'posts_7d',
      (select count(*) from public.posts where created_at >= now() - interval '7 days'),
    'messages_7d',
      (select count(*) from public.messages where created_at >= now() - interval '7 days'),
    'communities_total',
      (select count(*) from public.communities),
    'events_total',
      (select count(*) from public.events),
    'reports_pending',
      (select count(*) from public.reports where status = 'pending'),
    'reports_reviewing',
      (select count(*) from public.reports where status = 'reviewing'),
    'mod_actions_7d',
      (select count(*) from public.moderation_audit_log where created_at >= now() - interval '7 days')
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_admin_overview() from public;
grant execute on function public.get_admin_overview() to authenticated;
