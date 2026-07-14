-- =============================================================================
-- FAST SOCIO — delete_post RPC
--
-- The client can't DELETE from `posts` directly: table-level SELECT is revoked
-- (anonymity — reads go through the feed_posts view), and Postgres requires
-- SELECT on the columns referenced in a DELETE's WHERE clause. So the old
-- `delete().eq("id",…).eq("author_id",…)` path failed with "permission denied
-- for table posts". Route deletion through a SECURITY DEFINER RPC instead, the
-- same pattern used for messages/polls: it runs as owner (no SELECT-grant
-- problem) and enforces ownership via auth.uid() internally.
--
-- Also cleans up the poll a post carried (its options/votes cascade from it),
-- which the posts.poll_id → post_polls FK does not do on its own.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  v_poll uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  delete from public.posts
   where id = p_post_id and author_id = me
   returning poll_id into v_poll;

  if not found then
    raise exception 'post not found or not yours';
  end if;

  -- Drop the poll this post carried; post_poll_options/votes cascade from it.
  if v_poll is not null then
    delete from public.post_polls where id = v_poll;
  end if;
end;
$$;

revoke all on function public.delete_post(uuid) from public;
grant execute on function public.delete_post(uuid) to authenticated;
