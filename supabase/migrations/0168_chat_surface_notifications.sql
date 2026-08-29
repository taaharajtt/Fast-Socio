-- =============================================================================
-- FAST SOCIO — chat-surface notifications
--
-- Align notification fan-out with the app's chat surfaces:
--   * community/chat-room messages notify every room member except the sender;
--   * society broadcasts notify followers and members except the sender;
--   * event discussion messages notify attendees, host, and co-organizers except
--     the sender, using attendee-facing copy instead of "post request" copy.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Community chat rooms
-- ---------------------------------------------------------------------------
create or replace function public.notify_community_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_member record;
begin
  select name into v_name from public.communities where id = new.community_id;

  for v_member in
    select m.user_id
      from public.community_members m
     where m.community_id = new.community_id
       and m.user_id <> new.sender_id
  loop
    perform public.create_notification(
      v_member.user_id,
      case when new.is_anonymous then null else new.sender_id end,
      'community_message',
      'communities',
      jsonb_build_object(
        'community_id', new.community_id,
        'message_id', new.id,
        'community_name', v_name,
        'is_anonymous', new.is_anonymous
      )
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists community_chat_messages_notify on public.community_chat_messages;
create trigger community_chat_messages_notify
  after insert on public.community_chat_messages
  for each row execute function public.notify_community_message();

revoke all on function public.notify_community_message() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Society broadcasts
-- ---------------------------------------------------------------------------
create or replace function public.notify_society_members(
  p_society uuid,
  p_actor uuid,
  p_type text,
  p_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_name text;
begin
  select name into v_name from public.communities where id = p_society;

  for m in
    select user_id from public.community_followers where community_id = p_society
    union
    select user_id from public.community_members where community_id = p_society
  loop
    perform public.create_notification(
      m.user_id,
      p_actor,
      p_type,
      'communities',
      coalesce(p_data, '{}'::jsonb) || jsonb_build_object('community_name', v_name)
    );
  end loop;
end;
$$;

revoke all on function public.notify_society_members(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Event discussion
-- ---------------------------------------------------------------------------
create or replace function public.notify_event_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_title text;
  r record;
begin
  select host_id, title into v_host, v_title
    from public.events where id = new.event_id;

  for r in
    select distinct user_id
    from (
      select a.user_id
        from public.event_attendees a
       where a.event_id = new.event_id
      union
      select v_host
      union
      select o.user_id
        from public.event_organizers o
       where o.event_id = new.event_id
    ) recipients
    where user_id is not null
      and user_id <> new.sender_id
  loop
    perform public.create_notification(
      r.user_id,
      new.sender_id,
      'event_message',
      'events',
      jsonb_build_object(
        'event_id', new.event_id,
        'message_id', new.id,
        'event_title', v_title
      )
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists event_messages_notify_organizers on public.event_messages;
drop trigger if exists event_messages_notify_attendees on public.event_messages;
create trigger event_messages_notify_attendees
  after insert on public.event_messages
  for each row execute function public.notify_event_message();

revoke all on function public.notify_event_message() from public, anon, authenticated;

-- Push copy for these surfaces. Older types are carried forward so this
-- function remains a complete replacement.
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
  if not exists (
    select 1 from public.push_subscriptions where user_id = new.user_id
  ) then
    return null;
  end if;

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
    return null;
  end if;

  select full_name into actor_name from public.profiles where id = new.actor_id;
  actor_name := coalesce(actor_name, 'Someone');

  v_title := case new.type
    when 'match' then 'New match!'
    when 'message_request' then 'Message request'
    when 'message' then actor_name
    when 'post_like' then 'New like'
    when 'comment' then 'New comment'
    when 'community_message' then coalesce(new.data->>'community_name', 'Community chat')
    when 'society_announcement' then coalesce(new.data->>'community_name', 'New broadcast')
    when 'event_message' then coalesce(new.data->>'event_title', 'Event chat')
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
    when 'community_message' then actor_name || ' sent a message'
    when 'society_announcement' then actor_name || ' posted an announcement'
    when 'event_message' then actor_name || ' sent a message'
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
      'url', coalesce(new.data->>'url', '/activity')
    )
  );

  return null;
end;
$$;
