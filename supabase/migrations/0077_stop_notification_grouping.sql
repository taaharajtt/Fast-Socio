-- =============================================================================
-- FAST SOCIO — stop bundling notifications (each event is its own row)
--
-- mig 0057 collapsed like/comment storms into a single row per post via a
-- group_key ("Alice and 3 others reacted…"). Product decision reversed: every
-- notification should stand alone, even multiple from the same person. Drop the
-- group_key from the like/comment triggers so each insert is its own row. The
-- client-side hourly bundling is removed in the same change.
--
-- The partial unique index notifications_group_unique is left in place: it only
-- constrains rows where group_key is not null, and nothing sets group_key
-- anymore, so it simply never applies. group_count stays at its default of 1.
-- =============================================================================

set check_function_bodies = off;

create or replace function public.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author uuid;
begin
  select author_id into author from public.posts where id = new.post_id;
  -- No group_key: one notification per like (previously collapsed per post).
  perform public.create_notification(
    author, new.user_id, 'post_like', 'likes',
    jsonb_build_object('post_id', new.post_id)
  );
  return null;
end;
$$;

create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author uuid;
begin
  select author_id into author from public.posts where id = new.post_id;
  -- No group_key: one notification per comment.
  perform public.create_notification(
    author, new.author_id, 'comment', 'likes',
    jsonb_build_object('post_id', new.post_id)
  );
  return null;
end;
$$;
