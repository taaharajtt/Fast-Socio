-- 0141 — fix-025 completion: expose the pinned place through the Discover deck.
--
-- Mig 0138 added place_id/place_x/place_y to smart_match_posts, and the client already
-- reads `r.place_id / r.place_x / r.place_y` off each deck row (discover-actions.ts).
-- But `get_unified_discover_feed`'s RETURNS TABLE predates 0138, so those three columns
-- never reached the client and the "tap the location to open the map on that pin" half of
-- fix-025 only worked for an author looking at their OWN posts (which are read with
-- `select *`). Viewers — the people the fix is actually for — still fell back to
-- best-effort `resolvePlace()` string matching.
--
-- A return type cannot be altered by CREATE OR REPLACE, so the function is dropped and
-- recreated. Body is byte-identical to 0139 (including the fix-043 cohort predicate)
-- apart from the three new output columns and the three new select-list entries.

drop function if exists public.get_unified_discover_feed(text[], integer, timestamp with time zone);

create function public.get_unified_discover_feed(
  p_modes text[] default null::text[],
  p_limit integer default 40,
  p_before timestamp with time zone default null::timestamp with time zone
)
returns table(
  id uuid, mode text, author_id uuid, author_name text, author_avatar text,
  author_gender text, author_username text, author_department text,
  author_semester smallint, author_graduation_year smallint, author_verified boolean,
  author_aura integer, title text, description text, course_code text, degree text,
  semester smallint, people_needed smallint, skills_needed text[], interests text[],
  roles_needed text[], place text, scheduled_at timestamp with time zone,
  hackathon_name text, hackathon_url text, meeting_preference text,
  preferred_commitment text, skill_level text, availability text, portfolio_url text,
  recruitment_url text, deadline timestamp with time zone,
  expires_at timestamp with time zone, society_id uuid, society_name text,
  event_id uuid, event_title text, team_members jsonb, team_member_count integer,
  mutual_communities integer, application_count integer, my_application_status text,
  my_application_id uuid, created_at timestamp with time zone,
  -- new in 0141
  place_id text, place_x numeric, place_y numeric
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select
      p.id as uid,
      array(select community_id from public.community_members where user_id = p.id) as my_comms,
      p.department                          as my_department,
      p.degree                              as my_degree,
      public.current_semester(p.username)   as my_semester
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
    smp.created_at,
    smp.place_id,
    smp.place_x,
    smp.place_y
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
    -- fix-043 cohort predicate, carried forward unchanged
    and (
      smp.mode not in ('project_partner', 'fyp_teammate')
      or (
            me.my_department is not null and ap.department = me.my_department
        and me.my_degree     is not null and ap.degree     = me.my_degree
        and me.my_semester   is not null
        and public.current_semester(ap.username) = me.my_semester
      )
    )
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
$function$;

grant execute on function public.get_unified_discover_feed(text[], integer, timestamp with time zone) to authenticated;
