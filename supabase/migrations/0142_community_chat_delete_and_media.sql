-- 0142 — fix-051 (owners/moderators may delete any message) + fix-052 (image attachments)
--        for community, chat-room AND Discover-group chat.
--
-- WHY ONE MIGRATION COVERS ALL THREE SURFACES.
-- A Discover team room is not a separate thing: `create_discover_group_chat` inserts a
-- `communities` row with `is_discover_group = true` and puts the team in
-- `community_members`. Chat rooms are communities too. So all three of fix-051's and
-- fix-058's surfaces are the same table, `community_chat_messages`, rendered by the same
-- component. (The DM thread uses `messages` and already has both delete and images.)
--
-- STARTING STATE: `community_chat_messages` has no `deleted_at`, no attachment columns,
-- and RLS with only SELECT (members) and INSERT (self, members) policies — no UPDATE and
-- no DELETE policy at all, so today nothing can be deleted by anyone.
--
-- AUTHORIZATION LIVES IN RLS, NOT JUST THE RPC. The runbook is explicit that gating on UI
-- visibility is not a fix. Rather than a SECURITY DEFINER function that bypasses RLS and
-- re-checks by hand, the delete RPC below is **SECURITY INVOKER**, so the RLS policy IS
-- the enforcement: an unauthorised caller matches zero rows and the function raises.
-- The policy's WITH CHECK additionally constrains what the row may BECOME, so this
-- update path can only ever produce a tombstone — it can never be used to edit someone
-- else's message text.

-- 1. Columns ------------------------------------------------------------------------
alter table public.community_chat_messages
  add column if not exists deleted_at      timestamptz,
  add column if not exists attachment_url  text,
  add column if not exists attachment_type text;

-- Images only (fix-052). The client's accept attribute is a convenience; this is the
-- actual constraint, alongside the server-side MIME check in the upload action.
alter table public.community_chat_messages
  drop constraint if exists community_chat_messages_attachment_type_check,
  add  constraint community_chat_messages_attachment_type_check
    check (attachment_type is null or attachment_type = 'image');

-- An attachment needs both parts or neither.
alter table public.community_chat_messages
  drop constraint if exists community_chat_messages_attachment_pair_check,
  add  constraint community_chat_messages_attachment_pair_check
    check ((attachment_url is null) = (attachment_type is null));

create index if not exists community_chat_messages_live_idx
  on public.community_chat_messages (community_id, created_at desc)
  where deleted_at is null;

-- 2. Who may delete a message ---------------------------------------------------------
--    The author, the community owner, a community moderator, a society officer (when the
--    community is a society), or an admin. Definer so it can read membership rows the
--    caller may not otherwise see, but it only ever returns a boolean about the caller.
create or replace function public.can_delete_community_message(
  p_community uuid,
  p_sender    uuid
) returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    -- your own message
    p_sender = (select auth.uid())
    -- community owner or moderator
    or exists (
      select 1 from public.community_members m
       where m.community_id = p_community
         and m.user_id = (select auth.uid())
         and m.role = any (array['owner', 'moderator']::public.community_role[])
    )
    -- society officer, for communities that are societies
    or exists (
      select 1 from public.communities c
       where c.id = p_community
         and c.is_society
         and public.is_society_officer(c.id, (select auth.uid()))
    )
    or public.is_admin((select auth.uid()));
$function$;

-- 3. The RLS policy that actually enforces it -----------------------------------------
drop policy if exists "authorized may tombstone community chat"
  on public.community_chat_messages;

create policy "authorized may tombstone community chat"
  on public.community_chat_messages
  for update
  using (
    deleted_at is null
    and public.can_delete_community_message(community_id, sender_id)
  )
  with check (
    -- the row may only become a tombstone: no content may survive, and this path can
    -- never be repurposed into an edit
    deleted_at is not null
    and body = ''
    and attachment_url is null
    and attachment_type is null
    and poll_id is null
  );

-- 4. The delete call — SECURITY INVOKER, so the policy above is the gate ---------------
create or replace function public.delete_community_message(p_message_id uuid)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $function$
begin
  update public.community_chat_messages
     set body            = '',
         attachment_url  = null,
         attachment_type = null,
         poll_id         = null,
         deleted_at      = now()
   where id = p_message_id
     and deleted_at is null;

  if not found then
    -- Either the row does not exist, is already a tombstone, or RLS filtered it out
    -- because this caller is not permitted. Deliberately one message for all three so
    -- the call cannot be used to probe which messages exist.
    raise exception 'not authorized';
  end if;
end;
$function$;

revoke all on function public.delete_community_message(uuid) from public;
grant execute on function public.delete_community_message(uuid) to authenticated;

-- 5. Surface the new columns to the client --------------------------------------------
--    Columns are appended so CREATE OR REPLACE accepts it. Anonymity masking is
--    reproduced verbatim.
create or replace view public.community_chat_view as
 select m.id,
    m.community_id,
    m.body,
    m.poll_id,
    m.is_anonymous,
    m.created_at,
        case
            when m.is_anonymous and m.sender_id <> auth.uid() and not is_admin(auth.uid()) then null::uuid
            else m.sender_id
        end as sender_id,
        case
            when m.is_anonymous and m.sender_id <> auth.uid() and not is_admin(auth.uid()) then null::text
            else pr.full_name
        end as sender_name,
        case
            when m.is_anonymous and m.sender_id <> auth.uid() and not is_admin(auth.uid()) then null::text
            else pr.avatar_url
        end as sender_avatar,
        case
            when m.is_anonymous and m.sender_id <> auth.uid() and not is_admin(auth.uid()) then null::text
            else pr.gender
        end as sender_gender,
    -- new in 0142
    m.deleted_at,
    m.attachment_url,
    m.attachment_type
   from community_chat_messages m
     join profiles pr on pr.id = m.sender_id
  where (exists ( select 1
           from community_members cm
          where cm.community_id = m.community_id and cm.user_id = auth.uid()));

-- Re-assert explicitly: CREATE OR REPLACE VIEW has silently reset this before (see the
-- note in migration 0126), which would turn the view SECURITY DEFINER and bypass RLS.
alter view public.community_chat_view set (security_invoker = on);
