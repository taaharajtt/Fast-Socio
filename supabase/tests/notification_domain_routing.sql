-- =============================================================================
-- Verification for migration 0195 — direct messages are Chat, not Community.
--
-- Run against a database with 0195 applied. Everything is inside a transaction
-- that is ROLLED BACK.
--
--   psql "$DB_URL" -f supabase/tests/notification_domain_routing.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition.
--
-- THE REGRESSION THIS FILE FENCES
-- Migration 0192 put 'message', 'message_request', 'message_request_accepted'
-- and 'message_reaction' into community_update_types(). Private conversation
-- traffic then rendered inside Community → Updates and counted towards the
-- Community dock badge: five unread DMs plus three unread community updates
-- showed as 8. Section 2 is that exact arithmetic, run against real rows.
--
-- The complementary property matters just as much and is asserted alongside:
-- community ROOM conversation (community_message, event_message,
-- society_announcement) is NOT chat and must stay in Updates.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structure: chat is a domain of its own, and the blind rule is gone.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'chat_notification_types') then
    raise exception 'FAIL: chat_notification_types() is missing';
  end if;

  if not exists (select 1 from pg_views where schemaname='public' and viewname='chat_notifications') then
    raise exception 'FAIL: chat_notifications is missing';
  end if;

  -- The 3-argument domain rule cannot see a conversation. It must not survive
  -- as a second, wrong answer that something could still call.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'notification_domain'
       and p.pronargs = 3
  ) then
    raise exception 'FAIL: the 3-argument notification_domain() still exists';
  end if;

  -- The two type lists must be DISJOINT. This is the single assertion that
  -- would have caught 0192 before it shipped.
  if public.community_update_types() && public.chat_notification_types() then
    raise exception 'FAIL: a direct-message type is in the Community list';
  end if;

  -- All four DM types accounted for.
  if not ('message' = any (public.chat_notification_types()))
     or not ('message_request' = any (public.chat_notification_types()))
     or not ('message_request_accepted' = any (public.chat_notification_types()))
     or not ('message_reaction' = any (public.chat_notification_types())) then
    raise exception 'FAIL: the chat list is incomplete';
  end if;

  -- Space conversation stayed put.
  if not ('community_message' = any (public.community_update_types()))
     or not ('event_message' = any (public.community_update_types()))
     or not ('society_announcement' = any (public.community_update_types())) then
    raise exception 'FAIL: space conversation left Community Updates';
  end if;

  -- Every view that reads `notifications` must be security_invoker or RLS
  -- stops scoping it and one student reads another's inbox.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('community_updates','activity_notifications',
                         'chat_notifications','notifications_live')
       and coalesce(c.reloptions::text, '') not like '%security_invoker=true%'
  ) then
    raise exception 'FAIL: a surface view is not security_invoker';
  end if;

  if has_table_privilege('anon','public.chat_notifications','select') then
    raise exception 'FAIL: anon can read chat_notifications';
  end if;

  raise notice 'OK: chat is its own domain; the lists are disjoint; the blind rule is gone';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Routing, type by type, on the function itself.
-- ---------------------------------------------------------------------------
do $$
declare conv uuid := gen_random_uuid(); comm uuid := gen_random_uuid();
begin
  -- DMs are chat whatever subject they carry — including a payload that
  -- (wrongly, or maliciously) names a community.
  if public.notification_domain('message', null, null, conv) <> 'chat'
     or public.notification_domain('message', comm, null, conv) <> 'chat'
     or public.notification_domain('message_request', null, null, null) <> 'chat'
     or public.notification_domain('message_request_accepted', null, null, null) <> 'chat'
     or public.notification_domain('message_reaction', null, null, conv) <> 'chat' then
    raise exception 'FAIL: a DM type escaped the chat domain';
  end if;

  -- A bare conversation subject is chat even for a type nobody listed: the
  -- future-proofing clause, so a new DM-shaped notification cannot land in
  -- Updates by being forgotten.
  if public.notification_domain('some_future_dm_type', null, null, conv) <> 'chat' then
    raise exception 'FAIL: an unlisted conversation-subject type was not routed to chat';
  end if;

  -- ...but a space subject still wins when a row names both.
  if public.notification_domain('mention', comm, null, conv) <> 'community_updates' then
    raise exception 'FAIL: a space-scoped row with a conversation id left Updates';
  end if;

  -- Room conversation is Community, and the word "message" decides nothing.
  if public.notification_domain('community_message', comm, null, null) <> 'community_updates'
     or public.notification_domain('event_message', null, comm, null) <> 'community_updates'
     or public.notification_domain('society_announcement', comm, null, null) <> 'community_updates' then
    raise exception 'FAIL: space conversation left Community Updates';
  end if;

  -- Admin broadcasts are a modal, not a row on any list.
  if public.notification_domain('announcement', null, null, null) <> 'system' then
    raise exception 'FAIL: announcement is not in the system domain';
  end if;

  raise notice 'OK: routing is decided by subject, not by the word "message"';
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE NUMBER FROM THE BRIEF: 5 DMs + 3 Community updates = badge 3.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; other uuid; third uuid; ids uuid[];
  comm uuid; conv1 uuid; conv2 uuid;
  badge int; rows_unread int; n int; i int;
  chat_convs_before int; chat_convs_after int;
  first_id uuid; ok boolean;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       -- NOT an admin: the notifications SELECT policy lets admins read every
       -- row, so an admin fixture would count the whole platform's rows.
       and p.admin_role is null
     order by p.created_at limit 3) s;
  me := ids[1]; other := ids[2]; third := ids[3];

  insert into public.notification_preferences (user_id, communities, messages, likes, events)
    select unnest(ids), true, true, true, true
  on conflict (user_id) do update
    set communities = true, messages = true, likes = true, events = true;

  delete from public.notifications where user_id = me;

  -- ---- three COMMUNITY updates ------------------------------------------
  perform set_config('app.community_moderation','1',true);
  insert into public.communities (name, description, owner_id, status, is_society)
  values ('Routing fixture', 'fixture', other, 'approved', false) returning id into comm;
  perform set_config('app.community_moderation','0',true);
  insert into public.community_members (community_id, user_id, role)
    values (comm, me, 'member'), (comm, other, 'owner') on conflict do nothing;
  insert into public.community_followers (community_id, user_id)
    values (comm, me) on conflict do nothing;

  -- 1: a room message (grouped, so one row however many messages)
  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, other, 'room message one'), (comm, other, 'room message two');
  -- 2: a post in the community
  perform public.create_notification(me, other, 'community_post', 'communities',
    jsonb_build_object('community_id', comm));
  -- 3: a like on a community post — a GENERIC type routed by subject
  perform public.create_notification(me, other, 'post_like', 'likes',
    jsonb_build_object('community_id', comm));

  -- ---- five CHAT things --------------------------------------------------
  insert into public.conversations (user_low, user_high)
  values (least(me, other), greatest(me, other))
  on conflict (user_low, user_high) do update set last_message_at = now()
  returning id into conv1;
  insert into public.conversations (user_low, user_high)
  values (least(me, third), greatest(me, third))
  on conflict (user_low, user_high) do update set last_message_at = now()
  returning id into conv2;
  update public.conversations set closed_at = null where id in (conv1, conv2);

  select coalesce((public.chat_badge_count() ->> 'conversations')::int, 0)
    into chat_convs_before;

  -- Five unread direct messages: three in one thread, two in another. The
  -- notify_message trigger groups them per conversation.
  for i in 1..3 loop
    insert into public.messages (conversation_id, sender_id, body)
      values (conv1, other, 'dm ' || i);
  end loop;
  for i in 1..2 loop
    insert into public.messages (conversation_id, sender_id, body)
      values (conv2, third, 'dm ' || i);
  end loop;
  -- ...plus the other three shapes of chat notification.
  perform public.create_notification(me, other, 'message_request', 'messages',
    jsonb_build_object());
  perform public.create_notification(me, third, 'message_request_accepted', 'messages',
    jsonb_build_object());
  perform public.create_notification(me, other, 'message_reaction', 'messages',
    jsonb_build_object('conversation_id', conv1));

  -- ---- read it all back AS the student -----------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';

  -- Not one chat row may appear in Updates.
  select count(*) into n from public.community_updates
   where type = any (public.chat_notification_types());
  if n <> 0 then
    raise exception 'FAIL: % chat rows are in Community Updates', n;
  end if;
  select count(*) into n from public.community_updates
   where subject_conversation_id is not null;
  if n <> 0 then
    raise exception 'FAIL: % rows with a chat conversation subject are in Updates', n;
  end if;

  -- THE ARITHMETIC. Three community updates, five unread DMs, badge of 3.
  select count(*) into rows_unread from public.community_updates where read_at is null;
  select (public.community_badge_count() ->> 'updates')::int into badge;
  if badge <> 3 or rows_unread <> 3 then
    raise exception 'FAIL: badge % / % unread rows, expected 3 (DMs leaked in)',
      badge, rows_unread;
  end if;

  select count(*) into n from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.conversation_id in (conv1, conv2)
     and m.sender_id <> me and m.read_at is null;
  if n <> 5 then
    raise exception 'FAIL: % unread DMs in the fixture, expected 5', n;
  end if;

  -- The chat rows still EXIST — they are routed, not deleted — and they are
  -- on the chat surface and nowhere else.
  select count(*) into n from public.chat_notifications where read_at is null;
  if n < 5 then
    raise exception 'FAIL: % unread chat notification rows, expected 5', n;
  end if;
  select count(*) into n
    from public.chat_notifications c join public.community_updates u on u.id = c.id;
  if n <> 0 then
    raise exception 'FAIL: % rows are on BOTH the chat and community surfaces', n;
  end if;
  select count(*) into n
    from public.chat_notifications c join public.activity_notifications a on a.id = c.id;
  if n <> 0 then
    raise exception 'FAIL: % chat rows are also on the Notifications page', n;
  end if;

  -- The general Notifications page carries neither category.
  select count(*) into n from public.activity_notifications
   where type = any (public.chat_notification_types())
      or type = any (public.community_update_types())
      or subject_community_id is not null;
  if n <> 0 then
    raise exception 'FAIL: % community/chat rows are duplicated on Notifications', n;
  end if;

  -- The Chat badge DOES count them: one new unread conversation per thread.
  select coalesce((public.chat_badge_count() ->> 'conversations')::int, 0)
    into chat_convs_after;
  if chat_convs_after <> chat_convs_before + 2 then
    raise exception 'FAIL: the Chat badge moved by % conversations, expected 2',
      chat_convs_after - chat_convs_before;
  end if;

  -- ---- opening the NOTIFICATIONS page clears only its own domain ---------
  perform public.mark_notifications_read();
  if (select (public.community_badge_count() ->> 'updates')::int) <> 3 then
    raise exception 'FAIL: opening Notifications cleared the Community badge';
  end if;
  select count(*) into n from public.chat_notifications where read_at is null;
  if n < 5 then
    raise exception 'FAIL: opening Notifications marked chat rows read';
  end if;

  -- ---- opening a CHAT conversation clears only chat ----------------------
  perform public.mark_conversation_read(conv1);
  if (select (public.community_badge_count() ->> 'updates')::int) <> 3 then
    raise exception 'FAIL: opening a chat conversation cleared Community updates';
  end if;
  select count(*) into n from public.messages
   where conversation_id = conv1 and sender_id <> me and read_at is null;
  if n <> 0 then
    raise exception 'FAIL: opening the conversation left % unread messages', n;
  end if;
  select count(*) into n from public.messages
   where conversation_id = conv2 and sender_id <> me and read_at is null;
  if n <> 2 then
    raise exception 'FAIL: opening one conversation touched another (% unread)', n;
  end if;

  -- ---- opening ONE community update touches nothing in Chat --------------
  select id into first_id from public.community_updates
   where read_at is null order by created_at desc limit 1;
  select public.mark_community_update_read(first_id) into ok;
  if not ok then
    raise exception 'FAIL: marking one update read reported no row';
  end if;
  if (select (public.community_badge_count() ->> 'updates')::int) <> 2 then
    raise exception 'FAIL: opening one update did not decrement by one';
  end if;
  select count(*) into n from public.messages
   where conversation_id = conv2 and sender_id <> me and read_at is null;
  if n <> 2 then
    raise exception 'FAIL: opening a community update marked DMs read';
  end if;

  -- ---- Mark all as read in Updates leaves DM unread state alone ----------
  perform public.mark_community_updates_read();
  if (select (public.community_badge_count() ->> 'updates')::int) <> 0 then
    raise exception 'FAIL: mark-all left a non-zero Community badge';
  end if;
  select count(*) into n from public.messages
   where conversation_id = conv2 and sender_id <> me and read_at is null;
  if n <> 2 then
    raise exception 'FAIL: Community mark-all marked % DMs read', 2 - n;
  end if;
  select count(*) into n from public.chat_notifications where read_at is null;
  if n = 0 then
    raise exception 'FAIL: Community mark-all cleared the chat notification rows';
  end if;
  if (select coalesce((public.chat_badge_count() ->> 'conversations')::int, 0))
     <> chat_convs_before + 1 then
    raise exception 'FAIL: the Chat badge moved when Community was cleared';
  end if;

  execute 'set local role postgres';
  raise notice 'OK: 5 DMs + 3 updates = badge 3; every read action stays in its own domain';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Access: an inaccessible or deleted subject stops counting.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; other uuid; ids uuid[]; comm uuid; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and p.admin_role is null
     order by p.created_at limit 2) s;
  me := ids[1]; other := ids[2];
  delete from public.notifications where user_id = me;

  perform set_config('app.community_moderation','1',true);
  insert into public.communities (name, description, owner_id, status, is_society)
  values ('Access fixture 195', 'fixture', other, 'approved', false) returning id into comm;
  perform set_config('app.community_moderation','0',true);
  insert into public.community_members (community_id, user_id, role)
    values (comm, me, 'member'), (comm, other, 'owner') on conflict do nothing;
  insert into public.community_followers (community_id, user_id)
    values (comm, me) on conflict do nothing;
  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, other, 'while a member');

  -- RLS: a NON-member cannot read the room's messages at all.
  perform set_config('request.jwt.claims', json_build_object('sub', other)::text, true);
  delete from public.community_members where community_id = comm and user_id = other;
  execute 'set local role authenticated';
  select count(*) into n from public.community_chat_messages where community_id = comm;
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: a non-member read % messages from a room', n;
  end if;

  -- The member's own update is there...
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates where type = 'community_message';
  execute 'set local role postgres';
  if n <> 1 then
    raise exception 'FAIL: a member sees % of their room messages', n;
  end if;

  -- ...and deleting the space removes it, badge included.
  delete from public.communities where id = comm;
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  select (public.community_badge_count() ->> 'updates')::int into n;
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: % updates survived deleting their community', n;
  end if;

  raise notice 'OK: inaccessible rooms are unreadable; a deleted subject stops counting';
end $$;

-- ---------------------------------------------------------------------------
-- 4. One student's inbox is their own, on all three surfaces.
-- ---------------------------------------------------------------------------
do $$
declare me uuid; other uuid; ids uuid[]; n int;
begin
  select array_agg(id) into ids from (
    select id from public.profiles where admin_role is null
     order by created_at limit 2) s;
  me := ids[1]; other := ids[2];

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.chat_notifications c where c.user_id = other;
  if n <> 0 then
    raise exception 'FAIL: one student reads another''s chat rows (% rows)', n;
  end if;
  select count(*) into n from public.community_updates u where u.user_id = other;
  if n <> 0 then
    raise exception 'FAIL: one student reads another''s Updates (% rows)', n;
  end if;
  select count(*) into n from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.user_low <> me and c.user_high <> me;
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: a student read % messages from a conversation they are not in', n;
  end if;

  raise notice 'OK: every surface is RLS-scoped to the reader';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Preferences stay separated: Community controls Community, not DMs.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; other uuid; ids uuid[]; comm uuid; conv uuid; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and p.admin_role is null
     order by p.created_at limit 2) s;
  me := ids[1]; other := ids[2];
  delete from public.notifications where user_id = me;

  perform set_config('app.community_moderation','1',true);
  insert into public.communities (name, description, owner_id, status, is_society)
  values ('Prefs fixture 195', 'fixture', other, 'approved', false) returning id into comm;
  perform set_config('app.community_moderation','0',true);
  insert into public.community_members (community_id, user_id, role)
    values (comm, me, 'member'), (comm, other, 'owner') on conflict do nothing;
  insert into public.community_followers (community_id, user_id)
    values (comm, me) on conflict do nothing;

  insert into public.conversations (user_low, user_high)
  values (least(me, other), greatest(me, other))
  on conflict (user_low, user_high) do update set last_message_at = now()
  returning id into conv;
  update public.conversations set closed_at = null where id = conv;

  -- Communities OFF, messages ON: the DM still notifies, the room does not.
  insert into public.notification_preferences (user_id, communities, messages, likes, events)
  values (me, false, true, true, true)
  on conflict (user_id) do update set communities = false, messages = true;

  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, other, 'muted by prefs');
  insert into public.messages (conversation_id, sender_id, body)
    values (conv, other, 'still delivered');

  select count(*) into n from public.notifications
   where user_id = me and type = 'community_message';
  if n <> 0 then
    raise exception 'FAIL: the Community preference did not silence a room message';
  end if;
  select count(*) into n from public.notifications
   where user_id = me and type = 'message';
  if n <> 1 then
    raise exception 'FAIL: the Community preference silenced a DM (% rows)', n;
  end if;

  -- ...and the other way round.
  delete from public.notifications where user_id = me;
  update public.notification_preferences
     set communities = true, messages = false where user_id = me;

  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, other, 'delivered again');
  insert into public.messages (conversation_id, sender_id, body)
    values (conv, other, 'muted by prefs');

  select count(*) into n from public.notifications
   where user_id = me and type = 'message';
  if n <> 0 then
    raise exception 'FAIL: the messages preference did not silence a DM';
  end if;
  select count(*) into n from public.notifications
   where user_id = me and type = 'community_message';
  if n <> 1 then
    raise exception 'FAIL: the messages preference silenced a room message (% rows)', n;
  end if;

  raise notice 'OK: Community preferences control Community, message preferences control DMs';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
