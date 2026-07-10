-- M9: admin broadcast / announcements. Extends the push dispatcher to carry
-- custom announcement copy, and adds a super_admin-gated fan-out RPC that writes
-- one in-app notification per targeted user (each insert also fires the push).
-- (Applied to the live DB as migration 0041_admin_broadcast.)

create or replace function public.dispatch_push_notification()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
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
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    return null;
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
    when 'post_like' then 'New reaction'
    when 'comment' then 'New reply'
    when 'community_approved' then 'Community approved'
    when 'event_approved' then 'Event approved'
    when 'community_post_approved' then 'Post approved'
    when 'community_post_rejected' then 'Post update'
    when 'announcement' then coalesce(new.data ->> 'title', 'FAST SOCIO')
    else 'FAST SOCIO'
  end;

  v_body := case new.type
    when 'match' then actor_name || ' matched with you'
    when 'message_request' then actor_name || ' wants to chat'
    when 'message' then 'sent you a message'
    when 'post_like' then actor_name ||
      case when v_is_community then ' reacted to your community post' else ' reacted to your post' end
    when 'comment' then actor_name ||
      case when v_is_community then ' replied to your community post' else ' replied to your post' end
    when 'community_approved' then 'Your community is now live'
    when 'event_approved' then 'Your event is now live'
    when 'community_post_approved' then 'Your community post is live'
    when 'community_post_rejected' then 'A moderator reviewed your community post'
    when 'announcement' then coalesce(new.data ->> 'body', 'You have a new notification')
    else 'You have a new notification'
  end;

  v_url := case new.type
    when 'message' then coalesce('/chat/' || (new.data ->> 'conversation_id'), '/chat')
    when 'message_request' then '/chat'
    when 'match' then '/chat'
    when 'post_like' then coalesce('/post/' || (new.data ->> 'post_id'), '/activity')
    when 'comment' then coalesce('/post/' || (new.data ->> 'post_id'), '/activity')
    when 'community_approved' then coalesce('/communities/' || (new.data ->> 'community_id'), '/communities')
    when 'community_post_approved' then coalesce('/communities/' || (new.data ->> 'community_id'), '/communities')
    when 'community_post_rejected' then coalesce('/communities/' || (new.data ->> 'community_id'), '/communities')
    when 'event_approved' then coalesce('/events/' || (new.data ->> 'event_id'), '/events')
    when 'announcement' then coalesce(new.data ->> 'url', '/activity')
    else '/activity'
  end;

  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    body := jsonb_build_object('user_id', new.user_id, 'title', v_title, 'body', v_body, 'url', v_url)
  );

  return null;
end;
$function$;

create or replace function public.admin_broadcast(
  p_title text, p_body text, p_url text default null,
  p_segment text default 'all', p_department text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  perform public._admin_guard_super();
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;

  with tgt as (
    select id from public.profiles
    where not is_banned and onboarding_completed
      and (p_department is null or department = p_department)
      and (p_segment = 'all' or (p_segment = 'verified' and verified))
  ), ins as (
    insert into public.notifications (user_id, type, data)
    select id, 'announcement',
      jsonb_build_object('title', p_title, 'body', p_body,
                         'url', coalesce(nullif(trim(p_url), ''), '/activity'))
    from tgt
    returning 1
  )
  select count(*) into v_count from ins;

  perform public.log_admin_action('broadcast', p_title, null, null, null,
    jsonb_build_object('segment', p_segment, 'department', p_department,
                       'recipients', v_count, 'body', p_body));
  return v_count;
end $$;

grant execute on function public.admin_broadcast(text, text, text, text, text) to authenticated;
