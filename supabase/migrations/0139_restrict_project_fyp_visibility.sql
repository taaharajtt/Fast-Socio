-- 0139 — fix-043: restrict project-partner and FYP posts to the right deck.
--
-- THE ACTUAL EXPOSURE. `get_unified_discover_feed` (SECURITY DEFINER, so RLS is
-- bypassed) filtered on status, expiry, blocks, mutes and passes — and nothing else.
-- Every signed-in user received every `project_partner` and `fyp_teammate` post
-- regardless of their degree, department or semester.
--
-- WHERE ENFORCEMENT BELONGS — and why there is no new RLS policy here.
-- The runbook asked for the deck query AND the RLS layer. On inspection, RLS on
-- `smart_match_posts` is ALREADY stricter than the requirement: its only SELECT policy
-- is `author_id = auth.uid()`, i.e. non-authors cannot read the table at all, and no
-- view exposes it either (checked: zero views reference the table). The leak was 100%
-- through the definer RPC. Adding a "same cohort may read" SELECT policy would
-- therefore *widen* direct table access — it would create an exposure, not close one.
-- So: the RPC is hardened, RLS is deliberately left as-is, and the second definer RPC
-- that could serve as a bypass is revoked below.
--
-- Cohort test = same department AND same degree AND same semester, all three required.
-- "School" has no column in this schema; `profiles.department` is the school-equivalent
-- field the rest of the app uses, so school maps to department.
-- Semester is derived from the roll number via `current_semester(username)`, NOT read
-- from the stale `profiles.semester` column (mig 0099 moved semester to compute-on-read).
--
-- FAIL-CLOSED: every comparison requires both sides to be non-null. If either the
-- viewer's or the author's department/degree/semester is unknown, the post is hidden
-- rather than shown. Two unknowns must never count as a match in a privacy filter.

-- A reusable, directly testable predicate. Also the single place this rule is written
-- down, so a future deck surface can reuse it instead of re-deriving it.
create or replace function public.can_see_smart_match_post(
  p_author_id uuid,
  p_mode      text
) returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    -- hackathon, sports and recruitment are unaffected by this fix
    when p_mode not in ('project_partner', 'fyp_teammate') then true
    -- the author always sees their own post
    when p_author_id = auth.uid() then true
    else exists (
      select 1
        from public.profiles v
        join public.profiles a on a.id = p_author_id
       where v.id = auth.uid()
         and v.department is not null and a.department is not null
         and v.department = a.department
         and v.degree is not null and a.degree is not null
         and v.degree = a.degree
         and public.current_semester(v.username) is not null
         and public.current_semester(v.username) = public.current_semester(a.username)
    )
  end;
$function$;

-- The deck. Reproduced in full (this is now the latest redefinition); the only changes
-- are the three extra columns in the `me` CTE and the cohort predicate in the WHERE.
create or replace function public.get_unified_discover_feed(
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
  my_application_id uuid, created_at timestamp with time zone
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select
      p.id as uid,
      array(select community_id from public.community_members where user_id = p.id) as my_comms,
      -- fix-043: the viewer's cohort, resolved once rather than per row
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
    -- fix-043: project-partner and FYP posts only reach the author's own cohort.
    -- Inlined rather than calling can_see_smart_match_post() so the author profile
    -- already joined as `ap` is reused instead of re-querying profiles per row.
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

-- `get_smart_match_posts` is the pre-0110 per-mode deck function. It is SECURITY
-- DEFINER and carries no cohort filter, so it is an equivalent bypass — a client could
-- call it directly over PostgREST and read every FYP post. Nothing in src/ calls it
-- (grep: referenced only in two comments), so it is revoked rather than rewritten:
-- closing the hole without touching logic that is no longer exercised.
revoke execute on function public.get_smart_match_posts(text, integer) from authenticated;
revoke execute on function public.get_smart_match_posts(text, integer) from anon;

grant execute on function public.can_see_smart_match_post(uuid, text) to authenticated;
