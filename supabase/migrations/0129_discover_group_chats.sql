-- ===========================================================================
-- 0129 — Discover team group chats.
--
-- When the author of a Project Partner / FYP / Hackathon / Sports post fills
-- it, the people they accepted are a team — but the app only ever gave them
-- N separate 1:1 DMs. This gives them one room.
--
-- WHY THIS RIDES ON communities, NOT conversations:
--   public.conversations is structurally 1:1 — `unique (user_low, user_high)`
--   plus `check (user_low < user_high)` (0006) — and every downstream piece
--   (messages RLS, read receipts, unread counts, realtime, the thread UI)
--   resolves the counterparty from those two columns. There is no
--   conversation_members table. Communities, by contrast, are ALREADY the
--   app's group-chat primitive: membership, message RLS gated on membership,
--   realtime, the inbox "space" row and the /chat/c/[id] thread all exist and
--   work. A Discover group is therefore a community carrying a flag, exactly
--   as a society is (is_society, 0103) — no new messaging stack.
--
-- A Discover group is NOT browsable: it never appears in /communities, has no
-- public profile page, and — see section 3 — cannot be self-joined. It exists
-- only for the people the author accepted.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Flag + provenance columns.
--    discover_post_id is UNIQUE so "create the group" is idempotent: a second
--    call for the same post returns the room that already exists rather than
--    spawning a duplicate. ON DELETE SET NULL keeps the room alive if the
--    author later deletes the post — the team is real even if the ad is gone.
-- ---------------------------------------------------------------------------
alter table public.communities
  add column if not exists is_discover_group boolean not null default false,
  add column if not exists discover_post_id  uuid references public.smart_match_posts (id) on delete set null,
  add column if not exists discover_mode     text,
  add column if not exists discover_title    text;

create unique index if not exists communities_discover_post_idx
  on public.communities (discover_post_id)
  where discover_post_id is not null;

alter table public.communities
  drop constraint if exists communities_discover_mode_chk;
alter table public.communities
  add constraint communities_discover_mode_chk
  check (
    discover_mode is null
    or discover_mode in ('project_partner','fyp_teammate','hackathon_team','sports')
  );

-- ---------------------------------------------------------------------------
-- 2. A Discover group is never a society and never a browsable community.
--    Enforced here rather than trusted to the callers.
-- ---------------------------------------------------------------------------
alter table public.communities
  drop constraint if exists communities_discover_group_shape_chk;
alter table public.communities
  add constraint communities_discover_group_shape_chk
  check (
    not is_discover_group
    or (is_society = false and is_official = false and discover_mode is not null)
  );

-- ---------------------------------------------------------------------------
-- 3. SECURITY — close the self-join hole for these rooms.
--
--    The live join policy (0009, re-stated by 0032) lets ANY authenticated
--    user insert themselves into ANY approved community. Applied to a Discover
--    group that would mean a stranger could join a private team room and read
--    its chat, because community_chat_messages RLS grants read to any member.
--    Membership in a Discover group is conferred exclusively by the RPC below,
--    so the policy is narrowed to exclude them. Every other community keeps
--    exactly the behaviour it has today.
-- ---------------------------------------------------------------------------
alter policy "students join approved communities" on public.community_members
  with check (
    (user_id = (select auth.uid()))
    and (role = 'member'::public.community_role)
    and (exists (
      select 1 from public.communities c
      where c.id = community_members.community_id
        and c.status = 'approved'::public.community_status
        and c.is_discover_group = false
    ))
  );

-- ---------------------------------------------------------------------------
-- 4. create_discover_group_chat — author-only; builds the room, seeds it with
--    the accepted team, and marks the post filled. Returns the community id.
--
--    "Accepted team" = smart_match_team_members for the post (which, since
--    0128, is exactly who the author accepted) + the author.
-- ---------------------------------------------------------------------------
create or replace function public.create_discover_group_chat(
  p_post_id    uuid,
  p_group_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_author  uuid;
  v_mode    text;
  v_title   text;
  v_status  text;
  v_name    text;
  v_comm    uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select p.author_id, p.mode, p.title, p.status
    into v_author, v_mode, v_title, v_status
    from public.smart_match_posts p
   where p.id = p_post_id;

  if v_author is null then
    raise exception 'post not found';
  end if;
  if v_author <> uid then
    raise exception 'not authorized';
  end if;
  if v_mode not in ('project_partner','fyp_teammate','hackathon_team','sports') then
    raise exception 'this kind of post does not form a team';
  end if;

  -- Idempotent: the button can be double-tapped, and closing an already-closed
  -- post must not mint a second room.
  select c.id into v_comm
    from public.communities c
   where c.discover_post_id = p_post_id;

  if v_comm is null then
    -- Fall back to the post title, and respect the 2..60 CHECK on name.
    v_name := nullif(btrim(coalesce(p_group_name, '')), '');
    v_name := coalesce(v_name, v_title, 'Team chat');
    v_name := left(v_name, 60);
    if char_length(v_name) < 2 then
      v_name := 'Team chat';
    end if;

    insert into public.communities
      (name, owner_id, status, is_society, is_discover_group,
       discover_post_id, discover_mode, discover_title)
    values
      (v_name, uid, 'approved', false, true,
       p_post_id, v_mode, v_title)
    returning id into v_comm;
  else
    -- Room already exists; still (re-)seed members, since the author may have
    -- accepted more people since it was created.
    null;
  end if;

  -- Author first, then everyone tagged onto the team. sync_member_count keeps
  -- communities.member_count in step.
  insert into public.community_members (community_id, user_id, role)
  values (v_comm, uid, 'owner')
  on conflict (community_id, user_id) do nothing;

  insert into public.community_members (community_id, user_id, role)
  select v_comm, tm.user_id, 'member'
    from public.smart_match_team_members tm
   where tm.post_id = p_post_id
     and tm.user_id <> uid
  on conflict (community_id, user_id) do nothing;

  -- The post's job is done.
  if v_status = 'open' then
    update public.smart_match_posts
       set status = 'filled'
     where id = p_post_id;
  end if;

  return v_comm;
end;
$$;

revoke all on function public.create_discover_group_chat(uuid,text) from public, anon;
grant execute on function public.create_discover_group_chat(uuid,text) to authenticated;
