-- 0135 — fix-030: let a chat room's OWNER delete it from Manage.
--
-- No new cascades were needed. Every dependent already cascades from
-- `communities`: chat messages, chat reads, followers, join requests, members,
-- polls, posts, society announcements and roles — and, since mig 0132,
-- notifications too (`subject_community_id` ON DELETE CASCADE), which is the
-- fix-006 tie-in this fix asks for. Events and smart_match_posts deliberately
-- SET NULL instead: they are their own objects and outlive the room.
--
-- Owner-only, consistent with fix-031: a moderator or admin does not get this.
-- Societies keep their own lifecycle and Discover team rooms already have
-- delete_discover_group_chat(), so both are refused here rather than silently
-- taking a second, divergent delete path.

create or replace function public.delete_chat_room(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid      uuid := auth.uid();
  v_owner  uuid;
  v_soc    boolean;
  v_grp    boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select c.owner_id, c.is_society, c.is_discover_group
    into v_owner, v_soc, v_grp
    from public.communities c
   where c.id = p_id;

  if v_owner is null then
    raise exception 'chat room not found';
  end if;
  if coalesce(v_grp, false) then
    raise exception 'use delete_discover_group_chat for a Discover team room';
  end if;
  if coalesce(v_soc, false) then
    raise exception 'a society cannot be deleted here';
  end if;
  if v_owner <> uid then
    raise exception 'not authorized';
  end if;

  delete from public.communities
   where id = p_id
     and not is_society
     and not is_discover_group;
end;
$function$;

grant execute on function public.delete_chat_room(uuid) to authenticated;
