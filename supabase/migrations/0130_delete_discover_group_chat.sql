-- ===========================================================================
-- 0130 — Let the owner delete a Discover team room.
--
-- A team room is minted by an action (filling a post) rather than deliberately
-- created, so the author needs a way to undo it — a project that fizzles
-- shouldn't leave a dead thread in everyone's inbox forever.
--
-- Scoped hard: this deletes ONLY rows with is_discover_group = true, and only
-- for the room's owner. It can never be pointed at a real community or a
-- society, whatever id it is handed. Deleting the community cascades to
-- community_members and community_chat_messages via their existing
-- `on delete cascade` foreign keys, so the room and its history go together.
--
-- The Discover post is deliberately left alone: it stays 'filled'. Ditching
-- the chat is not the same as re-opening the search.
-- ===========================================================================
create or replace function public.delete_discover_group_chat(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_owner  uuid;
  v_is_grp boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select c.owner_id, c.is_discover_group
    into v_owner, v_is_grp
    from public.communities c
   where c.id = p_id;

  if v_owner is null then
    raise exception 'group not found';
  end if;
  if not coalesce(v_is_grp, false) then
    raise exception 'not a discover group';
  end if;
  if v_owner <> uid then
    raise exception 'not authorized';
  end if;

  delete from public.communities
   where id = p_id
     and is_discover_group;
end;
$$;

revoke all on function public.delete_discover_group_chat(uuid) from public, anon;
grant execute on function public.delete_discover_group_chat(uuid) to authenticated;
