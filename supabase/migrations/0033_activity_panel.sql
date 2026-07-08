-- =============================================================================
-- FAST SOCIO — Activity panel (UAT-002)
-- The in-app "Notifications" feed is rebranded to "Activity". Two changes at the
-- data layer support it:
--   1. Reaction/reply notifications carry the post's community_id so the UI can
--      tell a "community react" apart from a plain "post react".
--   2. Web Push (lockscreen on installed Android/iOS PWAs) deep-links to the
--      real destination instead of a generic list, and uses react/reply wording
--      consistent with the Activity panel. The panel itself lives at /activity.
-- The `notifications` table + preferences are unchanged (storage layer keeps its
-- name); only payloads, copy, and click-through URLs change.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Reactions (likes) now record which community the post belongs to (null for a
-- main-feed post). Extends 0014's notify_post_like without other behaviour change.
-- ---------------------------------------------------------------------------
create or replace function public.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author uuid;
  v_community uuid;
begin
  select author_id, community_id into author, v_community
    from public.posts where id = new.post_id;
  perform public.create_notification(author, new.user_id, 'post_like', 'likes',
    jsonb_build_object('post_id', new.post_id, 'community_id', v_community));
  return null;
end;
$$;

-- Replies (comments) likewise carry community_id.
create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author uuid;
  v_community uuid;
begin
  select author_id, community_id into author, v_community
    from public.posts where id = new.post_id;
  perform public.create_notification(author, new.author_id, 'comment', 'likes',
    jsonb_build_object('post_id', new.post_id, 'community_id', v_community));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push dispatch: deep-link per type + Activity-panel wording. Supersedes 0015's
-- body of dispatch_push_notification (same trigger, redefined function).
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fn_url text;
  secret text;
  actor_name text;
  v_title text;
  v_body text;
  v_url text;
  v_is_community boolean := (new.data ? 'community_id')
    and (new.data ->> 'community_id') is not null;
begin
  -- Skip if the recipient has no push subscription.
  if not exists (
    select 1 from public.push_subscriptions where user_id = new.user_id
  ) then
    return null;
  end if;

  select value into fn_url from private.app_config where key = 'send_push_url';
  select value into secret from private.app_config where key = 'push_dispatch_secret';
  if fn_url is null or secret is null then
    return null; -- not configured yet
  end if;

  select full_name into actor_name from public.profiles where id = new.actor_id;
  actor_name := coalesce(actor_name, 'Someone');

  v_title := case new.type
    when 'match' then 'New match!'
    when 'message_request' then 'Message request'
    when 'message' then actor_name
    when 'post_like' then 'New reaction'
    when 'comment' then 'New reply'
    when 'community_approved' then 'Community approved'
    when 'event_approved' then 'Event approved'
    when 'community_post_approved' then 'Post approved'
    when 'community_post_rejected' then 'Post update'
    else 'FAST SOCIO'
  end;

  v_body := case new.type
    when 'match' then actor_name || ' matched with you'
    when 'message_request' then actor_name || ' wants to chat'
    when 'message' then 'sent you a message'
    when 'post_like' then actor_name ||
      case when v_is_community then ' reacted to your community post'
           else ' reacted to your post' end
    when 'comment' then actor_name ||
      case when v_is_community then ' replied to your community post'
           else ' replied to your post' end
    when 'community_approved' then 'Your community is now live'
    when 'event_approved' then 'Your event is now live'
    when 'community_post_approved' then 'Your community post is live'
    when 'community_post_rejected' then 'A moderator reviewed your community post'
    else 'You have a new notification'
  end;

  -- Deep-link straight to the destination; fall back to the Activity panel.
  v_url := case new.type
    when 'message' then
      coalesce('/chat/' || (new.data ->> 'conversation_id'), '/chat')
    when 'message_request' then '/chat'
    when 'match' then '/chat'
    when 'post_like' then
      coalesce('/post/' || (new.data ->> 'post_id'), '/activity')
    when 'comment' then
      coalesce('/post/' || (new.data ->> 'post_id'), '/activity')
    when 'community_approved' then
      coalesce('/communities/' || (new.data ->> 'community_id'), '/communities')
    when 'community_post_approved' then
      coalesce('/communities/' || (new.data ->> 'community_id'), '/communities')
    when 'community_post_rejected' then
      coalesce('/communities/' || (new.data ->> 'community_id'), '/communities')
    when 'event_approved' then
      coalesce('/events/' || (new.data ->> 'event_id'), '/events')
    else '/activity'
  end;

  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', secret
    ),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'title', v_title,
      'body', v_body,
      'url', v_url
    )
  );

  return null;
end;
$$;
