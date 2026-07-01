-- =============================================================================
-- FAST SOCIO — Notifications (Phase 10, part 1: in-app feed)
-- In-app notifications are the universal fallback (work without Web Push / an
-- installed PWA). Created by triggers on key events, respecting
-- notification_preferences. Web Push dispatch is layered on top separately.
-- =============================================================================

set check_function_bodies = off;

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  type        text not null,
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy "users read their notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- Users may only mark their own notifications read (via the RLS update).
create policy "users update their notifications"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No client insert: notifications are created by SECURITY DEFINER triggers.

-- ---------------------------------------------------------------------------
-- create_notification: insert a notification if the recipient's preference for
-- `pref_col` is enabled (and it isn't a self-notification).
-- ---------------------------------------------------------------------------
create or replace function public.create_notification(
  p_recipient uuid,
  p_actor uuid,
  p_type text,
  p_pref_col text,
  p_data jsonb default '{}'::jsonb
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
    return; -- preference off (or no row) → skip
  end if;
  insert into public.notifications (user_id, actor_id, type, data)
    values (p_recipient, p_actor, p_type, coalesce(p_data, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Event triggers
-- ---------------------------------------------------------------------------

-- New match → notify both participants.
create or replace function public.notify_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(new.user_low, new.user_high, 'match', 'matches',
    jsonb_build_object('user_id', new.user_high));
  perform public.create_notification(new.user_high, new.user_low, 'match', 'matches',
    jsonb_build_object('user_id', new.user_low));
  return null;
end;
$$;
create trigger matches_notify after insert on public.matches
  for each row execute function public.notify_match();

-- New message request → notify recipient.
create or replace function public.notify_message_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(new.recipient_id, new.sender_id,
    'message_request', 'messages', jsonb_build_object('request_id', new.id));
  return null;
end;
$$;
create trigger message_requests_notify after insert on public.message_requests
  for each row execute function public.notify_message_request();

-- New chat message → notify the other participant.
create or replace function public.notify_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other uuid;
begin
  select case when c.user_low = new.sender_id then c.user_high else c.user_low end
    into other
  from public.conversations c where c.id = new.conversation_id;
  perform public.create_notification(other, new.sender_id, 'message', 'messages',
    jsonb_build_object('conversation_id', new.conversation_id));
  return null;
end;
$$;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_message();

-- Post like → notify the post author.
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
  perform public.create_notification(author, new.user_id, 'post_like', 'likes',
    jsonb_build_object('post_id', new.post_id));
  return null;
end;
$$;
create trigger post_likes_notify after insert on public.post_likes
  for each row execute function public.notify_post_like();

-- Comment → notify the post author.
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
  perform public.create_notification(author, new.author_id, 'comment', 'likes',
    jsonb_build_object('post_id', new.post_id));
  return null;
end;
$$;
create trigger post_comments_notify after insert on public.post_comments
  for each row execute function public.notify_comment();

-- ---------------------------------------------------------------------------
-- Mark all as read helper.
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null;
$$;

revoke all on function public.mark_notifications_read() from public;
grant execute on function public.mark_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- Extend the moderation functions to notify the owner/host on approval.
-- ---------------------------------------------------------------------------
create or replace function public.moderate_community(
  p_community_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  owner uuid;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  perform set_config('app.community_moderation', '1', true);
  update public.communities
     set status = case when p_approve then 'approved'::public.community_status
                       else 'rejected'::public.community_status end
   where id = p_community_id
   returning owner_id into owner;
  perform set_config('app.community_moderation', '0', true);

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id,
            case when p_approve then 'approve_community' else 'reject_community' end,
            'community', p_community_id, null);

  if p_approve then
    perform public.create_notification(owner, null, 'community_approved', 'communities',
      jsonb_build_object('community_id', p_community_id));
  end if;
end;
$$;

create or replace function public.moderate_event(
  p_event_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  host uuid;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  perform set_config('app.event_moderation', '1', true);
  update public.events
     set status = case when p_approve then 'approved'::public.event_status
                       else 'rejected'::public.event_status end
   where id = p_event_id
   returning host_id into host;
  perform set_config('app.event_moderation', '0', true);

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id,
            case when p_approve then 'approve_event' else 'reject_event' end,
            'event', p_event_id, null);

  if p_approve then
    perform public.create_notification(host, null, 'event_approved', 'events',
      jsonb_build_object('event_id', p_event_id));
  end if;
end;
$$;
