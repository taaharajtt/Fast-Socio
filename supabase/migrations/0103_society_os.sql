-- =============================================================================
-- FAST SOCIO — Society/Event OS, Phase A: the Society layer.
--
-- A "society" is a community with is_society = true. This is deliberately a
-- classification on the existing communities table rather than a parallel
-- entity, so societies inherit everything communities already have:
--   * identity        → name, description, avatar_url (logo), cover_url (banner)
--   * follow / join    → community_members (member_count == follower count)
--   * approval          → community_status + moderate_community() (mig 0009/0014)
--   * feed / chat / polls
--
-- What this migration ADDS:
--   1. Society identity columns (category, official/verified, recruitment, socials).
--   2. society_roles — an OFFICER overlay (president … moderator) on top of plain
--      membership. Regular followers stay in community_members; officers get a
--      richer role here. All writes go through rank-checked SECURITY DEFINER RPCs.
--   3. society_announcements — officer broadcasts, read through a definer feed
--      view that enforces public/members visibility; writes via RPCs that also
--      notify members.
--   4. verify_society() — admin-only official/verified toggle, and a privesc fix
--      so a community OWNER can never self-set is_official / verified_at.
--
-- Recruitment (forms/applications) and the Event-OS enhancements (poster,
-- visibility, photo wall, analytics, organizer announcements) are later phases.
-- Everything here is additive; no existing object is dropped.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Report targets: societies and their announcements are reportable content.
--    (New enum values are only referenced by the app at runtime, never in this
--    migration's bodies, so adding them in-transaction is safe.)
-- ---------------------------------------------------------------------------
alter type public.report_target_type add value if not exists 'society';
alter type public.report_target_type add value if not exists 'society_announcement';

-- ---------------------------------------------------------------------------
-- 2. Society identity columns on communities.
--    Reuses avatar_url (logo) and cover_url (banner); member_count already
--    tracks followers. is_official / verified_at are admin-controlled ONLY.
-- ---------------------------------------------------------------------------
alter table public.communities
  add column if not exists is_society       boolean not null default false,
  add column if not exists society_category text,
  add column if not exists is_official      boolean not null default false,
  add column if not exists verified_at      timestamptz,
  add column if not exists recruitment_open boolean not null default false,
  add column if not exists contact_email    text,
  add column if not exists instagram_url    text,
  add column if not exists website_url      text;

alter table public.communities
  drop constraint if exists communities_society_category_chk;
alter table public.communities
  add constraint communities_society_category_chk
  check (
    society_category is null
    or society_category in
      ('academic','sports','arts','tech','volunteer','departmental','cultural','religious','other')
  );

create index if not exists communities_society_idx
  on public.communities (is_society, status)
  where is_society;

-- ---------------------------------------------------------------------------
-- 2a. Privilege-escalation fix (recalls the admin_role incident): the existing
--     "owners edit their community" UPDATE policy allows an owner to set ANY
--     column. Freeze status (already done) AND the trust signals is_official /
--     verified_at for any non-trusted writer. verify_society() sets the same
--     app.community_moderation guard the approve/reject path uses to bypass this.
-- ---------------------------------------------------------------------------
create or replace function public.protect_community_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.community_moderation', true) = '1' then
    return new; -- trusted approve / reject / verify path
  end if;
  if auth.role() = 'authenticated' then
    new.status      := old.status;       -- non-admins cannot change status
    new.is_official := old.is_official;  -- …nor self-verify
    new.verified_at := old.verified_at;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. society_roles — officer overlay. The owner is the implicit top role and is
--    NOT stored here (mirrors event_organizers vs the event host). Rows are
--    public (officers are shown on the society profile); all writes go through
--    the rank-checked RPCs below (no client INSERT/UPDATE/DELETE policy).
-- ---------------------------------------------------------------------------
create table if not exists public.society_roles (
  society_id uuid not null references public.communities (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'officer'
             check (role in
               ('president','vice_president','officer','media','event_manager','moderator')),
  title      text check (title is null or char_length(title) <= 60),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (society_id, user_id)
);

create index if not exists society_roles_user_idx    on public.society_roles (user_id);
create index if not exists society_roles_society_idx  on public.society_roles (society_id);

alter table public.society_roles enable row level security;

revoke all on public.society_roles from anon, authenticated;
grant select on public.society_roles to authenticated;

create policy "society officers are visible"
  on public.society_roles for select to authenticated using (true);

-- is_society_officer(society, user) — owner OR any officer-overlay row.
-- SECURITY DEFINER so it can be used inside policies/RPCs without table grants.
create or replace function public.is_society_officer(p_society uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
           select 1 from public.communities c
           where c.id = p_society and c.owner_id = p_user
         )
      or exists (
           select 1 from public.society_roles r
           where r.society_id = p_society and r.user_id = p_user
         );
$$;

revoke all on function public.is_society_officer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_society_officer(uuid, uuid) to authenticated;

-- Numeric rank for hierarchy checks. Owner outranks every officer role.
create or replace function public.society_role_rank(p_society uuid, p_user uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select case
    when exists (select 1 from public.communities c
                 where c.id = p_society and c.owner_id = p_user) then 100
    else coalesce((
      select case r.role
        when 'president'      then 90
        when 'vice_president' then 80
        when 'officer'        then 60
        when 'event_manager'  then 50
        when 'media'          then 40
        when 'moderator'      then 30
      end
      from public.society_roles r
      where r.society_id = p_society and r.user_id = p_user
    ), 0)
  end;
$$;

revoke all on function public.society_role_rank(uuid, uuid) from public, anon, authenticated;
grant execute on function public.society_role_rank(uuid, uuid) to authenticated;

-- Numeric rank for a role name (kept in sync with society_role_rank).
create or replace function public.society_role_name_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner'          then 100
    when 'president'      then 90
    when 'vice_president' then 80
    when 'officer'        then 60
    when 'event_manager'  then 50
    when 'media'          then 40
    when 'moderator'      then 30
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Register / edit a society profile (officer or admin). Whitelisted columns
--    only — never status, is_official or verified_at. Also flips is_society on
--    for first-time registration. Owner-or-officer via is_society_officer.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_society_profile(
  p_society          uuid,
  p_society_category text,
  p_description      text default null,
  p_recruitment_open boolean default null,
  p_contact_email    text default null,
  p_instagram_url    text default null,
  p_website_url      text default null,
  p_avatar_url       text default null,
  p_cover_url        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if not exists (select 1 from public.communities where id = p_society) then
    raise exception 'society not found';
  end if;
  if not public.is_society_officer(p_society, uid) and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  if p_society_category is not null
     and p_society_category not in
       ('academic','sports','arts','tech','volunteer','departmental','cultural','religious','other') then
    raise exception 'invalid category';
  end if;

  update public.communities
     set is_society       = true,
         society_category = coalesce(p_society_category, society_category),
         description      = coalesce(p_description, description),
         recruitment_open = coalesce(p_recruitment_open, recruitment_open),
         contact_email    = coalesce(p_contact_email, contact_email),
         instagram_url    = coalesce(p_instagram_url, instagram_url),
         website_url      = coalesce(p_website_url, website_url),
         avatar_url       = coalesce(p_avatar_url, avatar_url),
         cover_url        = coalesce(p_cover_url, cover_url)
   where id = p_society;
end;
$$;

revoke all on function public.upsert_society_profile(uuid, text, text, boolean, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_society_profile(uuid, text, text, boolean, text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. assign_society_role / remove_society_role — rank-checked officer management.
--    Rule: you must be president+ (or admin) to manage roles, and you can never
--    grant or remove a role at or above your own (admins/owner bypass).
-- ---------------------------------------------------------------------------
create or replace function public.assign_society_role(
  p_society uuid,
  p_user    uuid,
  p_role    text,
  p_title   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid         uuid := auth.uid();
  is_adm      boolean := public.is_admin(auth.uid());
  caller_rank integer := public.society_role_rank(p_society, auth.uid());
  new_rank    integer := public.society_role_name_rank(p_role);
  v_owner     uuid;
begin
  select owner_id into v_owner from public.communities where id = p_society;
  if v_owner is null then
    raise exception 'society not found';
  end if;
  if p_role not in
     ('president','vice_president','officer','media','event_manager','moderator') then
    raise exception 'invalid role';
  end if;
  if p_user = v_owner then
    raise exception 'the owner already leads this society';
  end if;
  if not is_adm and caller_rank < 90 then
    raise exception 'not authorized';
  end if;
  if not is_adm and new_rank >= caller_rank then
    raise exception 'cannot assign a role at or above your own';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user and onboarding_completed and not is_banned
  ) then
    raise exception 'that student was not found';
  end if;

  -- Officers are members too; add the base membership if it is missing.
  insert into public.community_members (community_id, user_id, role)
    values (p_society, p_user, 'member')
    on conflict do nothing;

  insert into public.society_roles (society_id, user_id, role, title, created_by)
    values (p_society, p_user, p_role, nullif(btrim(p_title), ''), uid)
    on conflict (society_id, user_id)
      do update set role = excluded.role, title = excluded.title;

  perform public.create_notification(
    p_user, uid, 'society_role', 'communities',
    jsonb_build_object('society_id', p_society, 'role', p_role)
  );
end;
$$;

revoke all on function public.assign_society_role(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.assign_society_role(uuid, uuid, text, text) to authenticated;

create or replace function public.remove_society_role(p_society uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  is_adm      boolean := public.is_admin(auth.uid());
  caller_rank integer := public.society_role_rank(p_society, auth.uid());
  target_rank integer := public.society_role_rank(p_society, p_user);
begin
  if not exists (select 1 from public.society_roles
                 where society_id = p_society and user_id = p_user) then
    return; -- nothing to remove
  end if;
  if not is_adm and caller_rank < 90 then
    raise exception 'not authorized';
  end if;
  if not is_adm and target_rank >= caller_rank then
    raise exception 'cannot remove someone at or above your own role';
  end if;

  delete from public.society_roles where society_id = p_society and user_id = p_user;
end;
$$;

revoke all on function public.remove_society_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_society_role(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. society_announcements — officer broadcasts with public/members visibility.
--    Base table is locked; reads go through the definer feed view, writes
--    through the RPCs below.
-- ---------------------------------------------------------------------------
create table if not exists public.society_announcements (
  id         uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.communities (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  title      text not null check (char_length(title) between 2 and 120),
  body       text not null check (char_length(body) between 1 and 4000),
  pinned     boolean not null default false,
  visibility text not null default 'public' check (visibility in ('public','members')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists society_announcements_society_idx
  on public.society_announcements (society_id, pinned desc, created_at desc);

alter table public.society_announcements enable row level security;
revoke all on public.society_announcements from anon, authenticated;
-- No client policy: reads via society_announcement_feed, writes via RPCs.

create trigger society_announcements_set_updated_at
  before update on public.society_announcements
  for each row execute function public.set_updated_at();

-- Definer feed view: enforces approval + public/members visibility and joins
-- only safe author profile fields.
drop view if exists public.society_announcement_feed;
create view public.society_announcement_feed
with (security_invoker = false) as
select
  a.id,
  a.society_id,
  a.title,
  a.body,
  a.pinned,
  a.visibility,
  a.created_at,
  a.updated_at,
  a.author_id,
  pr.full_name  as author_name,
  pr.username   as author_username,
  pr.avatar_url as author_avatar,
  (a.author_id = auth.uid()) as is_mine
from public.society_announcements a
join public.communities c  on c.id = a.society_id
join public.profiles     pr on pr.id = a.author_id
where c.status = 'approved'
  and (
    a.visibility = 'public'
    or a.author_id = auth.uid()
    or public.is_admin(auth.uid())
    or exists (
      select 1 from public.community_members m
      where m.community_id = a.society_id and m.user_id = auth.uid()
    )
  );

grant select on public.society_announcement_feed to authenticated;

-- Notify a society's members (except the actor) of an officer action.
create or replace function public.notify_society_members(
  p_society uuid,
  p_actor   uuid,
  p_type    text,
  p_data    jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  for m in
    select user_id from public.community_members where community_id = p_society
  loop
    perform public.create_notification(m.user_id, p_actor, p_type, 'communities', p_data);
  end loop;
end;
$$;

revoke all on function public.notify_society_members(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
-- Called only from other definer functions; no direct grant.

create or replace function public.create_society_announcement(
  p_society    uuid,
  p_title      text,
  p_body       text,
  p_visibility text default 'public'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  v_id uuid;
begin
  if not public.is_society_officer(p_society, uid) and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  if p_visibility not in ('public','members') then
    raise exception 'invalid visibility';
  end if;
  if char_length(btrim(p_title)) < 2 or char_length(btrim(p_body)) < 1 then
    raise exception 'title and body are required';
  end if;

  insert into public.society_announcements (society_id, author_id, title, body, visibility)
    values (p_society, uid, btrim(p_title), btrim(p_body), p_visibility)
    returning id into v_id;

  perform public.notify_society_members(
    p_society, uid, 'society_announcement',
    jsonb_build_object('society_id', p_society, 'announcement_id', v_id)
  );
  return v_id;
end;
$$;

revoke all on function public.create_society_announcement(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_society_announcement(uuid, text, text, text) to authenticated;

create or replace function public.set_society_announcement_pin(p_announcement uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_society uuid;
begin
  select society_id into v_society from public.society_announcements where id = p_announcement;
  if v_society is null then
    raise exception 'announcement not found';
  end if;
  if not public.is_society_officer(v_society, uid) and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  update public.society_announcements set pinned = p_pinned where id = p_announcement;
end;
$$;

revoke all on function public.set_society_announcement_pin(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_society_announcement_pin(uuid, boolean) to authenticated;

create or replace function public.delete_society_announcement(p_announcement uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_society uuid;
  v_author  uuid;
begin
  select society_id, author_id into v_society, v_author
    from public.society_announcements where id = p_announcement;
  if v_society is null then
    raise exception 'announcement not found';
  end if;
  -- Author can delete their own; otherwise an officer/admin may moderate it.
  if v_author <> uid
     and not public.is_society_officer(v_society, uid)
     and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  delete from public.society_announcements where id = p_announcement;
end;
$$;

revoke all on function public.delete_society_announcement(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_society_announcement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. verify_society() — admin-only official/verified toggle. Uses the
--    app.community_moderation guard to bypass protect_community_status().
-- ---------------------------------------------------------------------------
create or replace function public.verify_society(p_society uuid, p_official boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  perform set_config('app.community_moderation', '1', true);
  update public.communities
     set is_society   = true,
         is_official  = p_official,
         verified_at  = case when p_official then now() else null end
   where id = p_society;
  perform set_config('app.community_moderation', '0', true);

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id,
            case when p_official then 'verify_society' else 'unverify_society' end,
            'community', p_society, null);
end;
$$;

revoke all on function public.verify_society(uuid, boolean) from public, anon, authenticated;
grant execute on function public.verify_society(uuid, boolean) to authenticated;
