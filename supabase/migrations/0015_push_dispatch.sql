-- =============================================================================
-- FAST SOCIO — Web Push dispatch (Phase 10, part 2)
-- On notification insert, if the recipient has a push subscription, POST to the
-- send-push Edge Function via pg_net. The dispatch secret + function URL live in
-- a non-public config table (private schema is not exposed by PostgREST); the
-- secret VALUE is inserted out-of-band, never committed to a migration.
-- =============================================================================

set check_function_bodies = off;

create extension if not exists pg_net;

create schema if not exists private;

create table if not exists private.app_config (
  key   text primary key,
  value text not null
);
-- private schema is not in the exposed schemas list, so it is unreachable via
-- the API. No RLS needed; only SECURITY DEFINER functions read it.

-- ---------------------------------------------------------------------------
-- Dispatch trigger: fire a Web Push for a new notification.
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
    when 'post_like' then 'New like'
    when 'comment' then 'New comment'
    when 'community_approved' then 'Community approved'
    when 'event_approved' then 'Event approved'
    else 'FAST SOCIO'
  end;

  v_body := case new.type
    when 'match' then actor_name || ' matched with you'
    when 'message_request' then actor_name || ' wants to chat'
    when 'message' then 'sent you a message'
    when 'post_like' then actor_name || ' liked your post'
    when 'comment' then actor_name || ' commented on your post'
    when 'community_approved' then 'Your community is now live'
    when 'event_approved' then 'Your event is now live'
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

create trigger notifications_dispatch_push
  after insert on public.notifications
  for each row execute function public.dispatch_push_notification();
