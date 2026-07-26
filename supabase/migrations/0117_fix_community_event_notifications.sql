-- =============================================================================
-- FAST SOCIO — Community chat unread tracking + missing notifications
--
--   1. community_chat_reads: per-user last-read marker for a community's chat
--      room (the DM equivalent is messages.read_at; community chat had no
--      analogue, so the Messages list could never compute unread state).
--   2. notify_community_message: community chat previously fired zero
--      notifications on send — members only ever found new messages by
--      opening the room.
--   3. notify_community_post: a community post becoming visible (insert as
--      already-approved, or an owner/mod approving a pending one) now notifies
--      members, mirroring the existing approve/reject-to-author notification.
--   4. notify_event_post_request: event discussion messages (event_messages)
--      now notify the host + all co-organizers, excluding the sender.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. community_chat_reads
-- ---------------------------------------------------------------------------
create table if not exists public.community_chat_reads (
  community_id  uuid not null references public.communities (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (community_id, user_id)
);

alter table public.community_chat_reads enable row level security;

create policy "users manage own community chat reads"
  on public.community_chat_reads for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- mark_community_chat_read: upserts the caller's last_read_at to now() for a
-- room they belong to. Called when the chat room is opened.
create or replace function public.mark_community_chat_read(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = me
  ) then
    return;
  end if;

  insert into public.community_chat_reads (community_id, user_id, last_read_at)
    values (p_community_id, me, now())
  on conflict (community_id, user_id)
    do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.mark_community_chat_read(uuid) from public;
grant execute on function public.mark_community_chat_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. community_message notifications
-- ---------------------------------------------------------------------------
create or replace function public.notify_community_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text;
  v_member  record;
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
      'community_message', 'communities',
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

create trigger community_chat_messages_notify
  after insert on public.community_chat_messages
  for each row execute function public.notify_community_message();

revoke all on function public.notify_community_message() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. community_post notifications (fires once a post is/becomes visible)
-- ---------------------------------------------------------------------------
create or replace function public.notify_community_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text;
  v_member  record;
begin
  if new.community_id is null or new.moderation_status <> 'approved' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.moderation_status = 'approved' then
    return null; -- already notified on a prior transition
  end if;

  select name into v_name from public.communities where id = new.community_id;

  for v_member in
    select m.user_id
      from public.community_members m
     where m.community_id = new.community_id
       and m.user_id <> new.author_id
  loop
    perform public.create_notification(
      v_member.user_id, new.author_id, 'community_post', 'communities',
      jsonb_build_object(
        'community_id', new.community_id,
        'post_id', new.id,
        'community_name', v_name
      )
    );
  end loop;
  return null;
end;
$$;

create trigger posts_notify_community_post
  after insert or update of moderation_status on public.posts
  for each row execute function public.notify_community_post();

revoke all on function public.notify_community_post() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. event_post_request notifications — host + co-organizers, sender excluded.
-- ---------------------------------------------------------------------------
create or replace function public.notify_event_post_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host  uuid;
  v_title text;
  v_org   record;
begin
  select host_id, title into v_host, v_title
    from public.events where id = new.event_id;

  if v_host is not null and v_host <> new.sender_id then
    perform public.create_notification(
      v_host, new.sender_id, 'event_post_request', 'events',
      jsonb_build_object('event_id', new.event_id, 'message_id', new.id, 'event_title', v_title)
    );
  end if;

  for v_org in
    select o.user_id
      from public.event_organizers o
     where o.event_id = new.event_id
       and o.user_id <> new.sender_id
       and o.user_id <> v_host
  loop
    perform public.create_notification(
      v_org.user_id, new.sender_id, 'event_post_request', 'events',
      jsonb_build_object('event_id', new.event_id, 'message_id', new.id, 'event_title', v_title)
    );
  end loop;
  return null;
end;
$$;

create trigger event_messages_notify_organizers
  after insert on public.event_messages
  for each row execute function public.notify_event_post_request();

revoke all on function public.notify_event_post_request() from public, anon, authenticated;
