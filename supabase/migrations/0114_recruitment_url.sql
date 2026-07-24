-- =============================================================================
-- FAST SOCIO — Recruitment application link
--
-- Recruitment cards need a real "Apply via Form" action, and there was no
-- https-only URL column for this mode (hackathon_url/portfolio_url belong to
-- hackathon_team/contributor). Adds `recruitment_url` following the exact
-- same shape as those two, then teaches the feed RPC and the two write RPCs
-- about it. Purely additive: no table dropped, no policy loosened, no
-- existing column touched.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. New column — https-only, same rule as hackathon_url/portfolio_url.
-- ---------------------------------------------------------------------------
alter table public.smart_match_posts
  add column if not exists recruitment_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smart_match_posts_recruitment_https') then
    alter table public.smart_match_posts
      add constraint smart_match_posts_recruitment_https
      check (recruitment_url is null or recruitment_url like 'https://%');
  end if;
end $$;

-- ===========================================================================
-- 2. get_unified_discover_feed — same function as 0111 plus recruitment_url.
-- ===========================================================================
create or replace function public.get_unified_discover_feed(
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
        'full_name', tp.full_name, 'avatar_url', tp.avatar_url) order by tm.created_at), '[]'::jsonb)
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
-- 3. Write RPCs — teach create/update about recruitment_url. Everything else
--    (self-only author, recruitment officer gate, https link rule,
--    team-member validation) is preserved verbatim from 0110.
-- ===========================================================================
create or replace function public.create_smart_match_post(
  p_mode           text,
  p_payload        jsonb,
  p_team_member_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  new_id    uuid;
  v_society uuid := nullif(p_payload->>'society_id','')::uuid;
  v_event   uuid := nullif(p_payload->>'event_id','')::uuid;
  v_url     text := nullif(trim(p_payload->>'hackathon_url'),'');
  v_port    text := nullif(trim(p_payload->>'portfolio_url'),'');
  v_recruit text := nullif(trim(p_payload->>'recruitment_url'),'');
  member_id uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_mode not in ('project_partner','fyp_teammate','hackathon_team',
                    'sports','recruitment','contributor') then
    raise exception 'invalid mode';
  end if;
  if coalesce(trim(p_payload->>'title'),'') = '' then
    raise exception 'title required';
  end if;
  if v_url is not null and v_url not like 'https://%' then
    raise exception 'links must be https';
  end if;
  if v_port is not null and v_port not like 'https://%' then
    raise exception 'links must be https';
  end if;
  if v_recruit is not null and v_recruit not like 'https://%' then
    raise exception 'links must be https';
  end if;

  -- Recruitment is officer/organizer-gated: you may only recruit for a society
  -- you run or an event you organize.
  if p_mode = 'recruitment' then
    if not (
      (v_society is not null and public.is_society_officer(v_society, uid))
      or (v_event is not null and public.is_event_organizer(v_event, uid))
    ) then
      raise exception 'recruitment posts require society-officer or event-organizer authority';
    end if;
  end if;

  insert into public.smart_match_posts (
    author_id, mode, title, description, course_code, degree, semester,
    people_needed, skills_needed, interests, roles_needed, place, scheduled_at,
    hackathon_name, hackathon_url, meeting_preference, preferred_commitment,
    skill_level, availability, portfolio_url, recruitment_url, deadline,
    society_id, event_id
  )
  values (
    uid, p_mode,
    left(trim(p_payload->>'title'), 120),
    nullif(trim(p_payload->>'description'),''),
    nullif(trim(p_payload->>'course_code'),''),
    nullif(trim(p_payload->>'degree'),''),
    nullif(p_payload->>'semester','')::smallint,
    nullif(p_payload->>'people_needed','')::smallint,
    coalesce((select array_agg(distinct trim(v)) from jsonb_array_elements_text(coalesce(p_payload->'skills_needed','[]'::jsonb)) v where trim(v) <> ''), '{}'),
    coalesce((select array_agg(distinct trim(v)) from jsonb_array_elements_text(coalesce(p_payload->'interests','[]'::jsonb)) v where trim(v) <> ''), '{}'),
    coalesce((select array_agg(distinct trim(v)) from jsonb_array_elements_text(coalesce(p_payload->'roles_needed','[]'::jsonb)) v where trim(v) <> ''), '{}'),
    nullif(trim(p_payload->>'place'),''),
    nullif(p_payload->>'scheduled_at','')::timestamptz,
    nullif(trim(p_payload->>'hackathon_name'),''),
    v_url,
    nullif(trim(p_payload->>'meeting_preference'),''),
    nullif(trim(p_payload->>'preferred_commitment'),''),
    nullif(trim(p_payload->>'skill_level'),''),
    left(nullif(trim(p_payload->>'availability'),''), 120),
    v_port,
    v_recruit,
    nullif(p_payload->>'deadline','')::timestamptz,
    v_society, v_event
  )
  returning id into new_id;

  -- Tag validated "already booked" team members (real, non-self accounts).
  if p_team_member_ids is not null then
    foreach member_id in array p_team_member_ids loop
      if member_id is not null and member_id <> uid
         and exists (select 1 from public.profiles pr
                     where pr.id = member_id and pr.onboarding_completed = true
                       and pr.is_banned = false) then
        insert into public.smart_match_team_members (post_id, user_id, added_by)
          values (new_id, member_id, uid)
          on conflict do nothing;
        perform public.create_notification(
          member_id, uid, 'smart_match_mention', 'matching',
          jsonb_build_object('post_id', new_id, 'mode', p_mode));
      end if;
    end loop;
  end if;

  return new_id;
end;
$$;

create or replace function public.update_smart_match_post(
  p_id             uuid,
  p_payload        jsonb,
  p_team_member_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_author  uuid;
  v_url     text := nullif(trim(p_payload->>'hackathon_url'),'');
  v_port    text := nullif(trim(p_payload->>'portfolio_url'),'');
  v_recruit text := nullif(trim(p_payload->>'recruitment_url'),'');
  member_id uuid;
begin
  select author_id into v_author
    from public.smart_match_posts where id = p_id;
  if v_author is null then
    raise exception 'post not found';
  end if;
  if v_author <> uid then
    raise exception 'not authorized';
  end if;
  if v_url is not null and v_url not like 'https://%' then
    raise exception 'links must be https';
  end if;
  if v_port is not null and v_port not like 'https://%' then
    raise exception 'links must be https';
  end if;
  if v_recruit is not null and v_recruit not like 'https://%' then
    raise exception 'links must be https';
  end if;

  update public.smart_match_posts set
    title              = coalesce(left(nullif(trim(p_payload->>'title'),''), 120), title),
    description        = nullif(trim(p_payload->>'description'),''),
    course_code        = nullif(trim(p_payload->>'course_code'),''),
    degree             = nullif(trim(p_payload->>'degree'),''),
    semester           = nullif(p_payload->>'semester','')::smallint,
    people_needed      = nullif(p_payload->>'people_needed','')::smallint,
    skills_needed      = coalesce((select array_agg(distinct trim(v)) from jsonb_array_elements_text(coalesce(p_payload->'skills_needed','[]'::jsonb)) v where trim(v) <> ''), '{}'),
    interests          = coalesce((select array_agg(distinct trim(v)) from jsonb_array_elements_text(coalesce(p_payload->'interests','[]'::jsonb)) v where trim(v) <> ''), '{}'),
    roles_needed       = coalesce((select array_agg(distinct trim(v)) from jsonb_array_elements_text(coalesce(p_payload->'roles_needed','[]'::jsonb)) v where trim(v) <> ''), '{}'),
    place              = nullif(trim(p_payload->>'place'),''),
    scheduled_at       = nullif(p_payload->>'scheduled_at','')::timestamptz,
    hackathon_name     = nullif(trim(p_payload->>'hackathon_name'),''),
    hackathon_url      = v_url,
    meeting_preference = nullif(trim(p_payload->>'meeting_preference'),''),
    preferred_commitment = nullif(trim(p_payload->>'preferred_commitment'),''),
    skill_level        = nullif(trim(p_payload->>'skill_level'),''),
    availability       = left(nullif(trim(p_payload->>'availability'),''), 120),
    portfolio_url      = v_port,
    recruitment_url    = v_recruit,
    deadline           = nullif(p_payload->>'deadline','')::timestamptz,
    -- Re-open on edit if it had auto-expired; the expiry trigger recomputes.
    expires_at         = null
  where id = p_id;

  -- Team-member re-sync only when a fresh list is supplied (null = leave as is).
  if p_team_member_ids is not null then
    delete from public.smart_match_team_members where post_id = p_id;
    foreach member_id in array p_team_member_ids loop
      if member_id is not null and member_id <> uid
         and exists (select 1 from public.profiles pr
                     where pr.id = member_id and pr.onboarding_completed = true
                       and pr.is_banned = false) then
        insert into public.smart_match_team_members (post_id, user_id, added_by)
          values (p_id, member_id, uid) on conflict do nothing;
      end if;
    end loop;
  end if;
end;
$$;
