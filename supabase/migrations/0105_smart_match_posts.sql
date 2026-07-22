-- =============================================================================
-- FAST SOCIO — Smart Match posts (focused campus matching on Discover)
--
-- Refocuses the purpose-based Discover layer from an INTENT model ("browse
-- people looking for X", mig 0104) to a POST / OPPORTUNITY model that answers a
-- concrete campus need — "3 people booked, need a 4th". SOCIO (the date/social
-- swipe deck, get_discover_candidates) is UNTOUCHED and stays the default.
--
-- Five modes share ONE table, discriminated by `mode`:
--   project_partner · fyp_teammate · hackathon_team · sports · recruitment
-- A post is browsed as a card and joined by an APPLICATION (interest / request
-- to join) with a pending→accepted/declined/cancelled lifecycle. An accepted
-- application opens a 1:1 chat, mirroring 0104's accepted-request→chat branch.
--
-- SECURITY MODEL (this app has had RLS incidents — 0078 / 0084-0088; posture is
-- strict, mirroring 0104):
--   • smart_match_posts: a user may SELECT/UPDATE/DELETE only their OWN posts.
--     Every cross-user read goes through the SECURITY DEFINER get_smart_match_
--     posts() RPC, which bakes in the full eligibility gate (block / mute / ban /
--     shadow-ban / suspension) and only ever returns privacy-safe author fields.
--   • recruitment posts require the author to be a society officer OR event
--     organizer of the linked society/event (create RPC enforces it).
--   • smart_match_applications: SELECT for the two parties only; ALL writes go
--     through SECURITY DEFINER RPCs (block checks, self-only, author-only accept).
--   • smart_match_team_members ("current team" mentions) confer NO permissions —
--     they are display-only chips, written solely by the post author.
--
-- The 0104 intent tables (matching_intents / matching_requests) and
-- get_matching_candidates are intentionally LEFT IN PLACE, now unused by the UI.
-- =============================================================================

set check_function_bodies = off;

-- ADD VALUE can't be consumed in the same tx; only used at runtime (reports
-- insert from the report action), so this is safe alongside the rest.
alter type public.report_target_type add value if not exists 'smart_match_post';

-- ---------------------------------------------------------------------------
-- 0. profiles.skills — a lightweight, optional skill set. Profiles already have
--    `interests`; skills unlock skill-overlap scoring and "Needs React, you
--    know React" chips. Never dumped to others — the scorer surfaces only the
--    OVERLAP with a post's needs, never the raw list.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists skills text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_skills_len'
  ) then
    alter table public.profiles
      add constraint profiles_skills_len
      check (array_length(skills, 1) is null or array_length(skills, 1) <= 30);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. smart_match_posts — one opportunity per row, discriminated by `mode`.
-- ---------------------------------------------------------------------------
create table if not exists public.smart_match_posts (
  id                  uuid primary key default gen_random_uuid(),
  author_id           uuid not null references auth.users (id) on delete cascade,
  mode                text not null check (mode in (
                        'project_partner','fyp_teammate','hackathon_team',
                        'sports','recruitment')),
  title               text not null check (char_length(title) between 1 and 120),
  description         text check (description is null or char_length(description) <= 2000),
  course_code         text check (course_code is null or char_length(course_code) <= 40),
  degree              text check (degree is null or char_length(degree) <= 60),
  semester            smallint check (semester is null or semester between 1 and 12),
  people_needed       smallint check (people_needed is null or people_needed between 1 and 20),
  skills_needed       text[] not null default '{}',
  interests           text[] not null default '{}',
  roles_needed        text[] not null default '{}',
  place               text check (place is null or char_length(place) <= 120),
  scheduled_at        timestamptz,
  hackathon_name      text check (hackathon_name is null or char_length(hackathon_name) <= 120),
  hackathon_url       text check (hackathon_url is null or hackathon_url like 'https://%'),
  meeting_preference  text check (meeting_preference is null or char_length(meeting_preference) <= 60),
  preferred_commitment text check (preferred_commitment is null or char_length(preferred_commitment) <= 40),
  skill_level         text check (skill_level is null or char_length(skill_level) <= 40),
  deadline            timestamptz,
  society_id          uuid references public.communities (id) on delete set null,
  event_id            uuid references public.events (id) on delete set null,
  status              text not null default 'open' check (status in ('open','closed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (array_length(skills_needed, 1) is null or array_length(skills_needed, 1) <= 20),
  check (array_length(interests, 1)    is null or array_length(interests, 1)    <= 20),
  check (array_length(roles_needed, 1) is null or array_length(roles_needed, 1) <= 20)
);

create index if not exists smart_match_posts_mode_status_idx
  on public.smart_match_posts (mode, status, created_at desc);
create index if not exists smart_match_posts_author_idx
  on public.smart_match_posts (author_id);
create index if not exists smart_match_posts_course_idx
  on public.smart_match_posts (course_code);
create index if not exists smart_match_posts_degree_idx
  on public.smart_match_posts (degree);
create index if not exists smart_match_posts_semester_idx
  on public.smart_match_posts (semester);
create index if not exists smart_match_posts_scheduled_idx
  on public.smart_match_posts (scheduled_at);
create index if not exists smart_match_posts_society_idx
  on public.smart_match_posts (society_id);
create index if not exists smart_match_posts_event_idx
  on public.smart_match_posts (event_id);
create index if not exists smart_match_posts_skills_gin
  on public.smart_match_posts using gin (skills_needed);
create index if not exists smart_match_posts_roles_gin
  on public.smart_match_posts using gin (roles_needed);

create trigger smart_match_posts_set_updated_at
  before update on public.smart_match_posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. smart_match_team_members — "already booked" members tagged on a post.
--    Display-only; confers NO permissions. Written only by the post author.
-- ---------------------------------------------------------------------------
create table if not exists public.smart_match_team_members (
  post_id    uuid not null references public.smart_match_posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists smart_match_team_members_user_idx
  on public.smart_match_team_members (user_id);

-- ---------------------------------------------------------------------------
-- 3. smart_match_applications — interest / request-to-join for a post.
-- ---------------------------------------------------------------------------
create table if not exists public.smart_match_applications (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.smart_match_posts (id) on delete cascade,
  applicant_id  uuid not null references auth.users (id) on delete cascade,
  message       text check (message is null or char_length(message) <= 500),
  status        text not null default 'pending'
                  check (status in ('pending','accepted','declined','cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (post_id, applicant_id)
);

create index if not exists smart_match_applications_post_idx
  on public.smart_match_applications (post_id, status);
create index if not exists smart_match_applications_applicant_idx
  on public.smart_match_applications (applicant_id, status);

-- ===========================================================================
-- 4. Row Level Security
-- ===========================================================================
alter table public.smart_match_posts        enable row level security;
alter table public.smart_match_team_members enable row level security;
alter table public.smart_match_applications enable row level security;

-- posts: a user reads/writes only their OWN rows directly. Browsing others'
-- posts happens solely through get_smart_match_posts().
revoke all on public.smart_match_posts from anon, authenticated;
grant select, insert, update, delete on public.smart_match_posts to authenticated;

create policy "read own posts"
  on public.smart_match_posts for select to authenticated
  using (author_id = (select auth.uid()));

create policy "insert own posts"
  on public.smart_match_posts for insert to authenticated
  with check (author_id = (select auth.uid()));

create policy "update own posts"
  on public.smart_match_posts for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy "delete own posts"
  on public.smart_match_posts for delete to authenticated
  using (author_id = (select auth.uid()));

-- team members: readable by the post author and by the tagged user; all writes
-- are performed inside SECURITY DEFINER RPCs (author-only), never by clients.
revoke all on public.smart_match_team_members from anon, authenticated;
grant select on public.smart_match_team_members to authenticated;

create policy "read team memberships you're part of"
  on public.smart_match_team_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.smart_match_posts p
      where p.id = post_id and p.author_id = (select auth.uid())
    )
  );

-- applications: the two parties may READ their own rows. No client writes —
-- every mutation is a SECURITY DEFINER RPC.
revoke all on public.smart_match_applications from anon, authenticated;
grant select on public.smart_match_applications to authenticated;

create policy "read applications you're party to"
  on public.smart_match_applications for select to authenticated
  using (
    applicant_id = (select auth.uid())
    or exists (
      select 1 from public.smart_match_posts p
      where p.id = post_id and p.author_id = (select auth.uid())
    )
  );

-- ===========================================================================
-- 5. get_smart_match_posts — eligible open posts in `mode`, browse view.
--    Returns post columns + privacy-safe author fields + team-member chips +
--    my_application_status + mutual_communities. Scoring/reason-chips are TS.
-- ===========================================================================
create or replace function public.get_smart_match_posts(
  p_mode  text,
  p_limit integer default 40
)
returns table (
  id                   uuid,
  mode                 text,
  author_id            uuid,
  author_name          text,
  author_avatar        text,
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
  deadline             timestamptz,
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
    smp.deadline,
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
  where smp.mode = p_mode
    and smp.status = 'open'
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
  order by smp.created_at desc
  limit greatest(1, least(p_limit, 60));
$$;

revoke all on function public.get_smart_match_posts(text, integer) from public, anon;
grant execute on function public.get_smart_match_posts(text, integer) to authenticated;

-- ===========================================================================
-- 6. Write RPCs (SECURITY DEFINER; each authorizes itself)
-- ===========================================================================

-- create_smart_match_post — author = caller. Recruitment requires society-
-- officer / event-organizer authority over the linked society/event. Team
-- member ids are validated (real, non-self accounts) and tagged + notified.
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
  member_id uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_mode not in ('project_partner','fyp_teammate','hackathon_team','sports','recruitment') then
    raise exception 'invalid mode';
  end if;
  if coalesce(trim(p_payload->>'title'),'') = '' then
    raise exception 'title required';
  end if;
  if v_url is not null and v_url not like 'https://%' then
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
    skill_level, deadline, society_id, event_id
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

-- update_smart_match_post — author-only; whitelisted scalar/array fields +
-- team-member re-sync. Recruitment authority is fixed at creation (society/
-- event links are not editable here).
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
  v_mode    text;
  v_url     text := nullif(trim(p_payload->>'hackathon_url'),'');
  member_id uuid;
begin
  select author_id, mode into v_author, v_mode
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
    deadline           = nullif(p_payload->>'deadline','')::timestamptz
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

-- close_smart_match_post — author-only; open → closed (soft close).
create or replace function public.close_smart_match_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_author uuid;
begin
  select author_id into v_author from public.smart_match_posts where id = p_id;
  if v_author is null then
    raise exception 'post not found';
  end if;
  if v_author <> uid then
    raise exception 'not authorized';
  end if;
  update public.smart_match_posts set status = 'closed' where id = p_id;
end;
$$;

-- express_smart_match_interest — applicant = caller. Block-checked; one live
-- application per (post, applicant); a declined/cancelled one may be re-sent.
create or replace function public.express_smart_match_interest(
  p_post    uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_author uuid;
  v_status text;
  v_mode   text;
  app_id   uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  select author_id, status, mode into v_author, v_status, v_mode
    from public.smart_match_posts where id = p_post;
  if v_author is null then
    raise exception 'post not found';
  end if;
  if v_status <> 'open' then
    raise exception 'this post is closed';
  end if;
  if v_author = uid then
    raise exception 'cannot apply to your own post';
  end if;
  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = uid and b.blocked_id = v_author)
       or (b.blocker_id = v_author and b.blocked_id = uid)
  ) then
    raise exception 'blocked';
  end if;

  insert into public.smart_match_applications (post_id, applicant_id, message, status)
  values (p_post, uid, nullif(trim(coalesce(p_message,'')), ''), 'pending')
  on conflict (post_id, applicant_id) do update
     set status = 'pending',
         message = excluded.message,
         created_at = now(),
         responded_at = null
     where public.smart_match_applications.status in ('declined','cancelled')
  returning id into app_id;

  if app_id is null then
    raise exception 'you already applied to this post';
  end if;

  perform public.create_notification(
    v_author, uid, 'smart_match_application', 'matching',
    jsonb_build_object('post_id', p_post, 'mode', v_mode, 'application_id', app_id));

  return app_id;
end;
$$;

-- cancel_smart_match_interest — applicant-only; pending → cancelled.
create or replace function public.cancel_smart_match_interest(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_applicant uuid;
  v_status text;
begin
  select applicant_id, status into v_applicant, v_status
    from public.smart_match_applications where id = p_id;
  if v_applicant is null then
    raise exception 'application not found';
  end if;
  if v_applicant <> uid then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'only pending applications can be cancelled';
  end if;
  update public.smart_match_applications
     set status = 'cancelled', responded_at = now() where id = p_id;
end;
$$;

-- respond_smart_match_interest — post author only; pending → accepted/declined.
create or replace function public.respond_smart_match_interest(
  p_id     uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_applicant uuid;
  v_post uuid;
  v_status text;
  v_author uuid;
  v_mode text;
begin
  select a.applicant_id, a.post_id, a.status, p.author_id, p.mode
    into v_applicant, v_post, v_status, v_author, v_mode
    from public.smart_match_applications a
    join public.smart_match_posts p on p.id = a.post_id
   where a.id = p_id;
  if v_applicant is null then
    raise exception 'application not found';
  end if;
  if v_author <> uid then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'application is not pending';
  end if;

  update public.smart_match_applications
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_id;

  if p_accept then
    perform public.create_notification(
      v_applicant, uid, 'smart_match_accepted', 'matching',
      jsonb_build_object('post_id', v_post, 'mode', v_mode, 'application_id', p_id));
  end if;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'create_smart_match_post(text,jsonb,uuid[])',
    'update_smart_match_post(uuid,jsonb,uuid[])',
    'close_smart_match_post(uuid)',
    'express_smart_match_interest(uuid,text)',
    'cancel_smart_match_interest(uuid)',
    'respond_smart_match_interest(uuid,boolean)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

-- ===========================================================================
-- 7. Chat eligibility: an ACCEPTED application opens the 1:1 chat between the
--    applicant and the post author. Additive only — every existing branch
--    (match / accepted message_request / accepted matching_request) and the
--    block check are preserved verbatim.
-- ===========================================================================
create or replace function public.get_or_create_conversation(other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conv_id uuid;
  eligible boolean;
  blocked boolean;
begin
  if me is null or other_id is null or me = other_id then
    raise exception 'invalid participants';
  end if;

  lo := least(me, other_id);
  hi := greatest(me, other_id);

  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = me)
  ) into blocked;
  if blocked then
    raise exception 'blocked';
  end if;

  select
    exists (select 1 from public.matches m where m.user_low = lo and m.user_high = hi)
    or exists (
      select 1 from public.message_requests r
      where r.status = 'accepted'
        and ((r.sender_id = me and r.recipient_id = other_id)
          or (r.sender_id = other_id and r.recipient_id = me))
    )
    or exists (
      select 1 from public.matching_requests mr
      where mr.status = 'accepted'
        and ((mr.requester_id = me and mr.recipient_id = other_id)
          or (mr.requester_id = other_id and mr.recipient_id = me))
    )
    or exists (
      select 1 from public.smart_match_applications a
      join public.smart_match_posts p on p.id = a.post_id
      where a.status = 'accepted'
        and ((p.author_id = me and a.applicant_id = other_id)
          or (p.author_id = other_id and a.applicant_id = me))
    )
  into eligible;
  if not eligible then
    raise exception 'not connected';
  end if;

  insert into public.conversations (user_low, user_high)
    values (lo, hi)
    on conflict (user_low, user_high) do nothing;

  select id into conv_id from public.conversations
   where user_low = lo and user_high = hi;

  return conv_id;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;
