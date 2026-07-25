-- =============================================================================
-- FAST SOCIO — comment reply notifications
--
-- notify_comment() (last redefined in 0077) regressed to notifying only the
-- post author, even for replies (post_comments.parent_id is not null) — the
-- parent comment's author got nothing. Restore reply-aware notifications:
--   * Reply  -> parent comment author gets 'comment_reply'.
--   * Reply  -> post author still gets 'comment' too, but only if they're a
--     different person than the parent comment author (no double-ping when
--     someone replies to their own top-level comment).
--   * Top-level comment -> post author gets 'comment', as before.
-- Held comments (hidden = true, risk hold) don't notify anyone until restored,
-- matching notify_comment_mentions()'s existing behaviour (0096).
-- =============================================================================

set check_function_bodies = off;

create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_author   uuid;
  v_parent_author uuid;
begin
  if new.hidden then
    return null;
  end if;

  select author_id into v_post_author from public.posts where id = new.post_id;

  if new.parent_id is not null then
    select author_id into v_parent_author from public.post_comments where id = new.parent_id;

    if v_parent_author is not null then
      perform public.create_notification(
        v_parent_author, new.author_id, 'comment_reply', 'likes',
        jsonb_build_object('post_id', new.post_id, 'comment_id', new.id, 'parent_id', new.parent_id)
      );
    end if;

    if v_post_author is distinct from v_parent_author then
      perform public.create_notification(
        v_post_author, new.author_id, 'comment', 'likes',
        jsonb_build_object('post_id', new.post_id, 'comment_id', new.id)
      );
    end if;
  else
    perform public.create_notification(
      v_post_author, new.author_id, 'comment', 'likes',
      jsonb_build_object('post_id', new.post_id, 'comment_id', new.id)
    );
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Web Push copy for 'comment_reply'. Full redefinition of
-- dispatch_push_notification() carried forward verbatim from 0096, with the
-- new branch added to the title/body case statements (trigger unchanged).
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
  qh_enabled boolean;
  qh_start smallint;
  qh_end smallint;
  cur_hour int;
begin
  -- Skip if the recipient has no push subscription.
  if not exists (
    select 1 from public.push_subscriptions where user_id = new.user_id
  ) then
    return null;
  end if;

  -- Quiet hours: suppress delivery inside the recipient's window (the in-app
  -- notification row is already persisted, so nothing is lost).
  select quiet_hours_enabled, quiet_start, quiet_end
    into qh_enabled, qh_start, qh_end
    from public.notification_preferences where user_id = new.user_id;
  if qh_enabled then
    cur_hour := extract(hour from (now() at time zone 'Asia/Karachi'))::int;
    if (qh_start <= qh_end and cur_hour >= qh_start and cur_hour < qh_end)
       or (qh_start > qh_end and (cur_hour >= qh_start or cur_hour < qh_end)) then
      return null;
    end if;
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
    when 'post_like' then 'New like'
    when 'comment' then 'New comment'
    when 'comment_reply' then actor_name
    when 'mention' then 'You were mentioned'
    when 'community_approved' then 'Community approved'
    when 'event_approved' then 'Event approved'
    when 'level_up' then 'Level up!'
    when 'achievement' then 'Achievement unlocked'
    when 'waitlist_promoted' then 'You got a seat!'
    when 'event_reminder' then 'Event reminder'
    else 'FAST SOCIO'
  end;

  v_body := case new.type
    when 'match' then actor_name || ' matched with you'
    when 'message_request' then actor_name || ' wants to chat'
    when 'message' then 'sent you a message'
    when 'post_like' then actor_name || ' reacted to your post'
    when 'comment' then actor_name || ' commented on your post'
    when 'comment_reply' then 'replied to your comment'
    when 'mention' then actor_name || ' mentioned you in a comment'
    when 'community_approved' then 'Your community is now live'
    when 'event_approved' then 'Your event is now live'
    when 'level_up' then 'You reached level ' || coalesce(new.data->>'level', '')
    when 'achievement' then coalesce(new.data->>'title', 'a new badge') || ' unlocked'
    when 'waitlist_promoted' then 'A seat opened up for your event'
    when 'event_reminder' then 'An event you''re attending is coming up'
    else 'You have a new notification'
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
      'url', '/notifications'
    )
  );

  return null;
end;
$$;
