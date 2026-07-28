-- Last two identity surfaces that still hid gender from the client, so the
-- gendered default avatar (boy.webp/girl.webp) could not be resolved on them:
--
--   1. get_unified_discover_feed  -- the Discover swipe deck's intent cards
--      (author face) AND the tagged team-member chips inside them.
--   2. community_review_posts     -- a society/community manager's pending-post
--      approval queue.
--
-- Everything else about both is preserved verbatim from 0114 / 0017.
set check_function_bodies = off;

-- ===========================================================================
-- 1. get_unified_discover_feed — 0114's function plus author_gender, and
--    gender inside the team_members jsonb objects.
--
--    Adding a column mid-return-table changes the OUT-parameter row type,
--    which CREATE OR REPLACE FUNCTION refuses (42P13) — drop first.
-- ===========================================================================
drop function if exists public.get_unified_discover_feed(text[], integer, timestamptz);

create function public.get_unified_discover_feed(
  p_modes  text[] default null,
  p_limit  integer default 40,
  p_before timestamptz default null
)
returns table (
  id                   uuid,
  mode                 text,
  author_id            uuid,
  author_name          text,
  author_avatar        text,
  author_gender        text,
  author_username      text,
  author_department    text,
  author_semester      smallint,
  author_graduation_year smallint,
  author_verified      boolean,
  author_aura          integer,
  title                text,
  description          text,
  course_code          text,
  degree               text,
  semester             smallint,
  people_needed        smallint,
  skills_needed        text[],
  interests            text[],
  roles_needed         text[],
  place                text,
  scheduled_at         timestamptz,
  hackathon_name       text,
  hackathon_url        text,
  meeting_preference   text,
  preferred_commitment text,
  skill_level          text,
  availability         text,
  portfolio_url        text,
  recruitment_url      text,
  deadline             timestamptz,
  expires_at           timestamptz,
  society_id           uuid,
  society_name         text,
  event_id             uuid,
  event_title          text,
  team_members         jsonb,
  team_member_count    integer,
  mutual_communities   integer,
  application_count    integer,
  my_application_status text,
  my_application_id    uuid,
  created_at           timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select
      p.id as uid,
      array(select community_id from public.community_members where user_id = p.id) as my_comms
    from public.profiles p
    where p.id = auth.uid()
  )
  select
    smp.id,
    smp.mode,
    smp.author_id,
    ap.full_name as author_name,
    ap.avatar_url as author_avatar,
    ap.gender as author_gender,
    ap.username as author_username,
    case when coalesce(ap.show_department, true) then ap.department else null end,
    case when coalesce(ap.show_semester, true)
         then public.current_semester(ap.username) else null end,
    ap.graduation_year,
    coalesce(ap.verified, false),
    case when coalesce(ap.show_aura, true) then ap.aura_score else 0 end,
    smp.title,
    smp.description,
    smp.course_code,
    smp.degree,
    smp.semester,
    smp.people_needed,
    smp.skills_needed,
    smp.interests,
    smp.roles_needed,
    smp.place,
    smp.scheduled_at,
    smp.hackathon_name,
    smp.hackathon_url,
    smp.meeting_preference,
    smp.preferred_commitment,
    smp.skill_level,
    smp.availability,
    smp.portfolio_url,
    smp.recruitment_url,
    smp.deadline,
    smp.expires_at,
    smp.society_id,
    sc.name as society_name,
    smp.event_id,
    ev.title as event_title,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', tp.id, 'username', tp.username,
        'full_name', tp.full_name, 'avatar_url', tp.avatar_url,
        'gender', tp.gender) order by tm.created_at), '[]'::jsonb)
      from public.smart_match_team_members tm
      join public.profiles tp on tp.id = tm.user_id
      where tm.post_id = smp.id
    ) as team_members,
    (select count(*)::int from public.smart_match_team_members tm2 where tm2.post_id = smp.id),
    (select count(*)::int from public.community_members cm
       where cm.user_id = smp.author_id and cm.community_id = any (me.my_comms)),
    (select count(*)::int from public.smart_match_applications ac
       where ac.post_id = smp.id and ac.status in ('pending','accepted')),
    (
      select a.status from public.smart_match_applications a
      where a.post_id = smp.id and a.applicant_id = me.uid
      order by a.created_at desc limit 1
    ) as my_application_status,
    (
      select a.id from public.smart_match_applications a
      where a.post_id = smp.id and a.applicant_id = me.uid
      order by a.created_at desc limit 1
    ) as my_application_id,
    smp.created_at
  from public.smart_match_posts smp
  join me on true
  join public.profiles ap on ap.id = smp.author_id
  left join public.communities sc on sc.id = smp.society_id
  left join public.events ev on ev.id = smp.event_id
  where (p_modes is null or array_length(p_modes, 1) is null or smp.mode = any (p_modes))
    and smp.status = 'open'
    and (smp.expires_at is null or smp.expires_at > now())
    and (p_before is null or smp.created_at < p_before)
    and smp.author_id <> me.uid
    and ap.onboarding_completed = true
    and ap.is_banned = false
    and ap.deactivated_at is null
    and ap.shadow_banned = false
    and (ap.suspended_until is null or ap.suspended_until < now())
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = me.uid and b.blocked_id = smp.author_id)
         or (b.blocker_id = smp.author_id and b.blocked_id = me.uid)
    )
    and not exists (
      select 1 from public.muted_users mu
      where mu.muter_id = me.uid and mu.muted_id = smp.author_id
    )
    and not exists (
      select 1 from public.smart_match_passes sp
      where sp.user_id = me.uid and sp.post_id = smp.id
    )
  order by smp.created_at desc
  limit greatest(1, least(p_limit, 80));
$$;

revoke all on function public.get_unified_discover_feed(text[], integer, timestamptz)
  from public, anon;
grant execute on function public.get_unified_discover_feed(text[], integer, timestamptz)
  to authenticated;

-- ===========================================================================
-- 2. community_review_posts — 0017's view plus author_gender, masked exactly
--    like author_avatar (anonymous posts keep their author hidden).
--
--    Appended last, so CREATE OR REPLACE is legal here (it cannot reorder or
--    insert mid-list) and the view's grants survive. This view is deliberately
--    NOT security_invoker — the base posts table has SELECT revoked, so the
--    owner's rights are the read path; reloptions stay null, as in prod.
-- ===========================================================================
create or replace view public.community_review_posts as
select
  p.id,
  p.community_id,
  p.body,
  p.image_url,
  p.is_anonymous,
  p.created_at,
  case when p.is_anonymous then null else p.author_id end as author_id,
  case when p.is_anonymous then null else pr.full_name end as author_name,
  case when p.is_anonymous then null else pr.avatar_url end as author_avatar,
  case when p.is_anonymous then null else pr.gender end as author_gender
from public.posts p
join public.profiles pr on pr.id = p.author_id
where p.community_id is not null
  and p.moderation_status = 'pending'
  and exists (
    select 1 from public.community_members m
    where m.community_id = p.community_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'moderator')
  );

grant select on public.community_review_posts to authenticated;
