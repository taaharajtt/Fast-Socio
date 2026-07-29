-- 0131 — Batch A: community / chat-room management authorization.
--
-- fix-023  Communities (societies) — manage is owner + moderator/officers.
-- fix-031  Chat rooms  (is_society = false) — manage is the OWNER ONLY. A
--          `moderator` community_members row must not grant management on a
--          casual room; rooms have no moderator tier by design.
-- fix-024  Only the community/society OWNER appoints or demotes officers.
--          An officer may resign their own role.
-- fix-026  Anyone could self-insert into community_members, which made the
--          join-request queue pointless — no app path uses that policy.

-- ---------------------------------------------------------------------------
-- 1. The central authority. Every manage RPC and RLS policy routes through it.
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_community(p_community uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    public.is_admin(p_user)
    -- The owner always manages, room or society.
    or exists (
      select 1 from public.communities c
       where c.id = p_community and c.owner_id = p_user
    )
    -- Delegated management exists ONLY for societies (fix-031: rooms are
    -- owner-only). Society officers must hold a real officer role — mere
    -- presence of a society_roles row is not enough.
    or exists (
      select 1 from public.communities c
       where c.id = p_community
         and c.is_society
         and (
           exists (
             select 1 from public.community_members m
              where m.community_id = p_community
                and m.user_id = p_user
                and m.role in ('owner', 'moderator')
           )
           or exists (
             select 1 from public.society_roles r
              where r.society_id = p_community
                and r.user_id = p_user
                and r.role in ('president', 'vice_president', 'officer',
                               'media', 'event_manager', 'moderator')
           )
         )
    ),
    false
  );
$function$;

-- ---------------------------------------------------------------------------
-- 2. Close the self-join hole. Membership is created only by
--    decide_community_join_request() / discover team RPCs, all SECURITY DEFINER.
-- ---------------------------------------------------------------------------
drop policy if exists "students join approved communities" on public.community_members;

-- ---------------------------------------------------------------------------
-- 3. Post moderation goes through the same authority (previously it ignored
--    owner_id and every society officer tier).
-- ---------------------------------------------------------------------------
create or replace function public.moderate_community_post(p_post_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  v_community uuid;
  v_author uuid;
begin
  select community_id, author_id into v_community, v_author
    from public.posts where id = p_post_id;

  if v_community is null then
    raise exception 'not a community post';
  end if;

  if not public.can_manage_community(v_community, me) then
    raise exception 'not authorized';
  end if;

  update public.posts
     set moderation_status = case when p_approve then 'approved'::public.post_moderation
                                  else 'rejected'::public.post_moderation end
   where id = p_post_id
     and moderation_status = 'pending';

  if v_author is not null then
    insert into public.notifications (user_id, actor_id, type, data)
      values (
        v_author,
        me,
        case when p_approve then 'community_post_approved' else 'community_post_rejected' end,
        jsonb_build_object('community_id', v_community, 'post_id', p_post_id)
      );
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. fix-024 — appointment is the owner's alone.
-- ---------------------------------------------------------------------------
create or replace function public.assign_society_role(
  p_society uuid, p_user uuid, p_role text, p_title text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid     uuid := auth.uid();
  is_adm  boolean := public.is_admin(auth.uid());
  v_owner uuid;
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
  -- fix-024: presidents and other officers may no longer appoint.
  if not is_adm and uid is distinct from v_owner then
    raise exception 'only the owner can appoint officers';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user and onboarding_completed and not is_banned
  ) then
    raise exception 'that student was not found';
  end if;

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
$function$;

-- Owner (or admin) demotes anyone; an officer may resign their own role.
create or replace function public.remove_society_role(p_society uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid     uuid := auth.uid();
  is_adm  boolean := public.is_admin(auth.uid());
  v_owner uuid;
begin
  if not exists (select 1 from public.society_roles
                 where society_id = p_society and user_id = p_user) then
    return;
  end if;
  select owner_id into v_owner from public.communities where id = p_society;

  if not is_adm and uid is distinct from v_owner and p_user is distinct from uid then
    raise exception 'only the owner can change officer roles';
  end if;

  -- No self-notification when an officer resigns.
  if p_user is distinct from uid then
    perform public.create_notification(
      p_user, uid, 'society_role_removed', 'communities',
      jsonb_build_object('society_id', p_society)
    );
  end if;

  delete from public.society_roles where society_id = p_society and user_id = p_user;
end;
$function$;
