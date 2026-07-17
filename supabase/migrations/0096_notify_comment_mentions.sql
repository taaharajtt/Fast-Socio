-- =============================================================================
-- FAST SOCIO — "You were mentioned" notifications
--
-- When a comment is inserted, notify every user tagged in it via an @-mention
-- token (@[username](uuid), see lib/mentions + mig 0095). Mentions are already
-- sanitized app-side (addComment) so a stored token always points at a real
-- profile the comment author is matched with — the trigger just reads them out.
--
--   * Gate: notification_preferences.likes (same family as post_like / comment).
--   * Skips the post author (they already get the 'comment' notification) and,
--     via create_notification, any self-mention and preference-off recipient.
--   * Held comments (hidden = true, risk hold) don't ping until restored.
--
-- Also teaches the Web Push dispatcher a 'mention' title/body. Full redefinition
-- of dispatch_push_notification() carried forward verbatim from mig 0057 with
-- the two mention branches added (create-or-replace, trigger unchanged).
--
-- Idempotent: safe to re-run.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Fan out mention notifications on comment insert.
-- ---------------------------------------------------------------------------
create or replace function public.notify_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  rec      record;
  v_uid    uuid;
begin
  -- Don't ping mentions for a comment held for moderation.
  if new.hidden then
    return null;
  end if;

  select author_id into v_author from public.posts where id = new.post_id;

  for rec in
    select distinct (regexp_matches(
      new.body, '@\[[a-z0-9_]{1,20}\]\(([0-9a-fA-F-]{36})\)', 'g'))[1] as uid
  loop
    begin
      v_uid := rec.uid::uuid;
    exception when others then
      continue; -- malformed capture — skip defensively
    end;

    -- The post author already receives the 'comment' notification.
    if v_uid = v_author then
      continue;
    end if;

    -- create_notification skips self-mentions and preference-off recipients.
    perform public.create_notification(
      v_uid, new.author_id, 'mention', 'likes',
      jsonb_build_object('post_id', new.post_id, 'comment_id', new.id)
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists post_comments_notify_mentions on public.post_comments;
create trigger post_comments_notify_mentions
  after insert on public.post_comments
  for each row execute function public.notify_comment_mentions();

-- ---------------------------------------------------------------------------
-- 2. Web Push text for the 'mention' type (else it falls back to the generic
--    "FAST SOCIO" / "You have a new notification"). Body carries no comment
--    content, only that the actor mentioned the recipient.
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
