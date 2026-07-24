-- =============================================================================
-- FAST SOCIO — Discover becomes ONE swipe deck
--
-- Product correction on top of mig 0110: Discover is not a browsable directory
-- with filter chips. It is a single continuous SWIPE experience — SOCIO people
-- cards and opportunity/intent cards shuffled into the same deck. Swipe right
-- on a person = the original like/match; swipe right on an intent = express
-- interest; swipe left on either = pass.
--
-- Passing a PERSON was already durable (public.swipes). Passing an INTENT had
-- nowhere to go, so a dismissed card came straight back on the next load. This
-- migration adds that missing half:
--
--   • smart_match_passes — "I swiped this post away", own-rows-only;
--   • get_unified_discover_feed now excludes passed posts;
--   • pass_/unpass_smart_match_post definer RPCs (unpass powers the 3s Undo,
--     mirroring undoSwipe on the SOCIO side).
--
-- Purely additive. No table is dropped, no policy is loosened, and the SOCIO
-- deck's own path (get_discover_candidates / swipes / matches) is untouched.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. smart_match_passes — the intent-card equivalent of a left swipe.
-- ---------------------------------------------------------------------------
create table if not exists public.smart_match_passes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  post_id    uuid not null references public.smart_match_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists smart_match_passes_post_idx
  on public.smart_match_passes (post_id);

alter table public.smart_match_passes enable row level security;

-- A pass is private to the person who made it: nobody can learn that they were
-- swiped away. Reads are own-rows-only and writes go through definer RPCs.
revoke all on public.smart_match_passes from anon, authenticated;
grant select on public.smart_match_passes to authenticated;

drop policy if exists "read own passes" on public.smart_match_passes;
create policy "read own passes"
  on public.smart_match_passes for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. pass / unpass RPCs. Self-only by construction (user_id := auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.pass_smart_match_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.smart_match_posts where id = p_post) then
    raise exception 'post not found';
  end if;
  insert into public.smart_match_passes (user_id, post_id)
  values (uid, p_post)
  on conflict (user_id, post_id) do update set created_at = now();
end;
$$;

-- Undo a left swipe within the deck's 3s undo window.
create or replace function public.unpass_smart_match_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  delete from public.smart_match_passes
   where user_id = uid and post_id = p_post;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'pass_smart_match_post(uuid)',
    'unpass_smart_match_post(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

-- ===========================================================================
-- 3. get_unified_discover_feed — same function as 0110 plus the pass filter.
--    Everything else (eligibility gate, privacy switches, keyset paging) is
--    reproduced verbatim; only the final NOT EXISTS clause is new.
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
    -- NEW: a card you swiped away stays away.
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
