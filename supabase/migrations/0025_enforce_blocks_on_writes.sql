-- =============================================================================
-- FAST SOCIO — Enforce blocks on write paths (audit fix P3-02)
--
-- blocked_users is honoured on read (feed_posts) and for chat creation
-- (get_or_create_conversation) and Discover, but the insert policies for likes,
-- comments, message requests and swipes checked only ownership. So once the
-- block UI ships, a blocked user could still like/comment/message-request/match
-- the person who blocked them and fire notifications at them. Fixed
-- pre-emptively: each of those inserts now also requires no block in either
-- direction. UNLIKE / delete paths are intentionally left open so a blocked user
-- can still withdraw an existing like.
-- =============================================================================

set check_function_bodies = off;

-- Bidirectional block check. SECURITY DEFINER so an RLS policy evaluated as the
-- caller can see blocks in BOTH directions (blocked_users RLS only exposes the
-- caller's own rows).
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

revoke all on function public.is_blocked(uuid, uuid) from public;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

-- post_likes: no liking a post whose author has blocked you (or vice versa).
drop policy if exists "users manage their own likes" on public.post_likes;
create policy "users manage their own likes"
  on public.post_likes for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and not public.is_blocked(
      auth.uid(),
      (select author_id from public.posts where id = post_id)
    )
  );

-- post_comments: same guard on insert.
drop policy if exists "users create their own comments" on public.post_comments;
create policy "users create their own comments"
  on public.post_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and not public.is_blocked(
      auth.uid(),
      (select author_id from public.posts where id = post_id)
    )
  );

-- message_requests: cannot request a chat across a block.
drop policy if exists "users send their own requests" on public.message_requests;
create policy "users send their own requests"
  on public.message_requests for insert to authenticated
  with check (
    sender_id = auth.uid()
    and not public.is_blocked(sender_id, recipient_id)
  );

-- swipes: cannot swipe (and therefore cannot match) across a block.
drop policy if exists "users record their own swipes" on public.swipes;
create policy "users record their own swipes"
  on public.swipes for insert to authenticated
  with check (
    swiper_id = auth.uid()
    and not public.is_blocked(swiper_id, target_id)
  );
