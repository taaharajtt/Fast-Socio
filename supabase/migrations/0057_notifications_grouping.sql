-- =============================================================================
-- FAST SOCIO — Refactor Phase 7: Notifications hardening.
--
-- Prevents notification fatigue without dropping any existing behaviour:
--   * Collapse + dedup: a group_key buckets like/comment storms into a single
--     row ("Alice and 3 others reacted…") via an ON CONFLICT upsert against a
--     partial unique index. Same-actor spam (like/unlike/relike) refreshes the
--     row without inflating the count.
--   * Quiet hours: per-user window that suppresses PUSH delivery only — the
--     in-app row is still written, so nothing is missed.
--   * Push copy for the Phase 5/6 notification types.
--
-- create_notification keeps its old 5-arg call sites working: the signature is
-- re-created with a defaulted p_group_key, so ungrouped callers insert exactly
-- as before.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Grouping columns + the partial unique index that drives collapse/dedup.
--    At most one UNREAD row per (user, type, bucket); read rows fall out of the
--    index so fresh activity after a read starts a new notification.
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists group_key   text,
  add column if not exists group_count integer not null default 1;

create unique index if not exists notifications_group_unique
  on public.notifications (user_id, type, group_key)
  where read_at is null and group_key is not null;

-- ---------------------------------------------------------------------------
-- 2. create_notification with optional grouping. Recreated (not overloaded) so
--    5-arg callers resolve to this via the default.
-- ---------------------------------------------------------------------------
drop function if exists public.create_notification(uuid, uuid, text, text, jsonb);

create function public.create_notification(
  p_recipient uuid,
  p_actor     uuid,
  p_type      text,
  p_pref_col  text,
  p_data      jsonb default '{}'::jsonb,
  p_group_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  enabled boolean;
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  execute format(
    'select %I from public.notification_preferences where user_id = $1', p_pref_col
  ) into enabled using p_recipient;
  if enabled is distinct from true then
    return; -- category muted (or no row) → skip
  end if;

  if p_group_key is null then
    insert into public.notifications (user_id, actor_id, type, data)
      values (p_recipient, p_actor, p_type, coalesce(p_data, '{}'::jsonb));
  else
    -- Collapse into the live unread row for this bucket, if any.
    insert into public.notifications
      (user_id, actor_id, type, data, group_key, group_count)
      values (p_recipient, p_actor, p_type, coalesce(p_data, '{}'::jsonb), p_group_key, 1)
    on conflict (user_id, type, group_key) where read_at is null and group_key is not null
    do update set
      -- Only count a genuinely different actor (dedup same-actor toggling).
      group_count = notifications.group_count
        + case when notifications.actor_id is distinct from excluded.actor_id then 1 else 0 end,
      actor_id   = excluded.actor_id,
      data       = excluded.data,
      created_at = now();
  end if;
end;
$$;

revoke all on function
  public.create_notification(uuid, uuid, text, text, jsonb, text) from public;

-- ---------------------------------------------------------------------------
-- 3. Group like + comment notifications by the target post.
-- ---------------------------------------------------------------------------
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
  perform public.create_notification(
    author, new.user_id, 'post_like', 'likes',
    jsonb_build_object('post_id', new.post_id),
    'post_like:' || new.post_id
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
  perform public.create_notification(
    author, new.author_id, 'comment', 'likes',
    jsonb_build_object('post_id', new.post_id),
    'comment:' || new.post_id
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Quiet hours (PKT window). Suppresses push only; in-app rows still land.
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists quiet_hours_enabled boolean  not null default false,
  add column if not exists quiet_start          smallint not null default 22
    check (quiet_start between 0 and 23),
  add column if not exists quiet_end            smallint not null default 7
    check (quiet_end between 0 and 23);

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
