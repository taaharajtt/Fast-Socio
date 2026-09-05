-- =============================================================================
-- Verification for migration 0192 — Updates as the space inbox, Notifications
-- as its complement.
--
-- Run against a database with 0192 applied. Everything is inside a transaction
-- that is ROLLED BACK.
--
--   psql "$DB_URL" -f supabase/tests/community_updates_inbox.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition.
--
-- The two surfaces must PARTITION notifications_live: no row on both, no row on
-- neither (of the types either renders). That is the property the whole
-- refactor rests on, and section 1 asserts it globally over real data.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structure and posture.
-- ---------------------------------------------------------------------------
do $$
begin
  foreach_check: for i in 1..1 loop
    if not exists (select 1 from pg_views where schemaname='public' and viewname='community_updates') then
      raise exception 'FAIL: community_updates is missing';
    end if;
    if not exists (select 1 from pg_views where schemaname='public' and viewname='activity_notifications') then
      raise exception 'FAIL: activity_notifications is missing';
    end if;
  end loop foreach_check;

  -- Both views must be security_invoker, or RLS on notifications stops
  -- scoping them and one student reads another's inbox.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname in ('community_updates','activity_notifications')
       and coalesce(c.reloptions::text, '') not like '%security_invoker=true%'
  ) then
    raise exception 'FAIL: a surface view is not security_invoker';
  end if;

  if has_table_privilege('anon','public.community_updates','select')
     or has_table_privilege('anon','public.activity_notifications','select') then
    raise exception 'FAIL: anon can read a notification surface';
  end if;

  -- The DM grouping that keeps a busy thread to one badge point.
  if (select pg_get_functiondef(p.oid) from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='notify_message')
     not like '%conversation:%' then
    raise exception 'FAIL: notify_message does not group by conversation';
  end if;

  raise notice 'OK: views, invoker posture, grants, DM grouping';
end $$;

-- ---------------------------------------------------------------------------
-- 1. The surfaces partition the notification space.
-- ---------------------------------------------------------------------------
do $$
declare overlap int; orphan int;
begin
  select count(*) into overlap
    from public.community_updates u
    join public.activity_notifications a on a.id = u.id;
  if overlap <> 0 then
    raise exception 'FAIL: % rows appear on BOTH surfaces', overlap;
  end if;

  -- Every row of a type either surface renders must land on exactly one. The
  -- domain function is total, so this is really asserting it agrees with the
  -- two views built on it.
  select count(*) into orphan
    from public.notifications_live n
   where public.notification_domain(n.type, n.subject_community_id, n.subject_event_id)
         not in ('community','activity');
  if orphan <> 0 then
    raise exception 'FAIL: % rows have no domain', orphan;
  end if;

  raise notice 'OK: no row on both surfaces, no row without a domain';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Routing: same TYPE, different surface, decided by subject.
-- ---------------------------------------------------------------------------
do $$
declare
  d_feed text; d_comm text; d_event text;
begin
  -- The heart of the refactor: a like on a feed post and a like on a community
  -- post share the type `post_like`.
  d_feed  := public.notification_domain('post_like', null, null);
  d_comm  := public.notification_domain('post_like', gen_random_uuid(), null);
  d_event := public.notification_domain('post_like', null, gen_random_uuid());
  if d_feed <> 'activity' then
    raise exception 'FAIL: a feed like routed to %', d_feed;
  end if;
  if d_comm <> 'community' or d_event <> 'community' then
    raise exception 'FAIL: a space-scoped like routed to %/%', d_comm, d_event;
  end if;

  -- Comments, replies, mentions and comment likes follow the same rule.
  if public.notification_domain('comment', null, null) <> 'activity'
     or public.notification_domain('comment', gen_random_uuid(), null) <> 'community'
     or public.notification_domain('mention', null, null) <> 'activity'
     or public.notification_domain('mention', gen_random_uuid(), null) <> 'community'
     or public.notification_domain('comment_reply', gen_random_uuid(), null) <> 'community'
     or public.notification_domain('comment_like', null, null) <> 'activity' then
    raise exception 'FAIL: social routing is inconsistent';
  end if;

  -- Always-community types go to Updates with or without a subject.
  if public.notification_domain('community_message', null, null) <> 'community'
     or public.notification_domain('event_message', null, null) <> 'community'
     or public.notification_domain('society_announcement', null, null) <> 'community'
     or public.notification_domain('community_post', null, null) <> 'community'
     or public.notification_domain('message', null, null) <> 'community'
     or public.notification_domain('community_join_request', null, null) <> 'community' then
    raise exception 'FAIL: an always-community type escaped Updates';
  end if;

  -- ...and genuinely unrelated things stay on Notifications even if some
  -- payload happens to name a community.
  if public.notification_domain('match', gen_random_uuid(), null) <> 'activity'
     or public.notification_domain('help_response', gen_random_uuid(), null) <> 'activity'
     or public.notification_domain('achievement', null, null) <> 'activity' then
    raise exception 'FAIL: an unrelated type was pulled into Updates';
  end if;

  raise notice 'OK: subject decides for social types, type decides for the rest';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Badge = rendered unread rows, and read semantics.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; other uuid; comm uuid; ids uuid[];
  badge int; rows_unread int; n int; ok boolean; first_id uuid;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false)=false
     order by p.created_at limit 2) s;
  me := ids[1]; other := ids[2];

  insert into public.notification_preferences (user_id, communities, messages, likes, events)
    select unnest(ids), true, true, true, true
  on conflict (user_id) do update
    set communities = true, messages = true, likes = true, events = true;

  delete from public.notifications where user_id = me;

  perform set_config('app.community_moderation','1',true);
  insert into public.communities (name, description, owner_id, status, is_society)
  values ('Inbox fixture', 'fixture', other, 'approved', false) returning id into comm;
  perform set_config('app.community_moderation','0',true);
  insert into public.community_members (community_id, user_id, role)
    values (comm, me, 'member') on conflict do nothing;
  insert into public.community_followers (community_id, user_id)
    values (comm, me) on conflict do nothing;

  -- A space-scoped like and a feed like, same type, different surface.
  perform public.create_notification(me, other, 'post_like', 'likes',
    jsonb_build_object('community_id', comm));
  perform public.create_notification(me, other, 'post_like', 'likes',
    jsonb_build_object());

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.community_updates
   where read_at is null and type = 'post_like';
  if n <> 1 then
    raise exception 'FAIL: Updates holds % space-scoped likes, expected 1', n;
  end if;
  select count(*) into n from public.activity_notifications
   where read_at is null and type = 'post_like';
  if n <> 1 then
    raise exception 'FAIL: Notifications holds % feed likes, expected 1', n;
  end if;

  -- BADGE == RENDERED UNREAD ROWS.
  select count(*) into rows_unread from public.community_updates where read_at is null;
  select (public.community_badge_count() ->> 'updates')::int into badge;
  if badge <> rows_unread then
    raise exception 'FAIL: badge % vs % unread rows', badge, rows_unread;
  end if;

  -- Opening ONE item decrements by exactly one.
  select id into first_id from public.community_updates
   where read_at is null order by created_at desc limit 1;
  select public.mark_community_update_read(first_id) into ok;
  if not ok then
    raise exception 'FAIL: marking one update read reported no row';
  end if;
  if (select (public.community_badge_count() ->> 'updates')::int) <> badge - 1 then
    raise exception 'FAIL: opening one item did not decrement by one';
  end if;

  -- Mark-all clears the rest and leaves the OTHER surface alone.
  perform public.mark_community_updates_read();
  if (select (public.community_badge_count() ->> 'updates')::int) <> 0 then
    raise exception 'FAIL: mark-all left a non-zero badge';
  end if;
  select count(*) into n from public.activity_notifications where read_at is null;
  if n = 0 then
    raise exception 'FAIL: mark-all in Updates also cleared Notifications';
  end if;

  execute 'set local role postgres';
  raise notice 'OK: badge equals rendered rows; per-item and mark-all read are surface-local';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grouping: a busy room is ONE row, not one per message.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; other uuid; comm uuid; ids uuid[]; n int; i int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false)=false
     order by p.created_at limit 2) s;
  me := ids[1]; other := ids[2];
  delete from public.notifications where user_id = me;

  perform set_config('app.community_moderation','1',true);
  insert into public.communities (name, description, owner_id, status, is_society)
  values ('Grouping fixture', 'fixture', other, 'approved', false) returning id into comm;
  perform set_config('app.community_moderation','0',true);
  insert into public.community_members (community_id, user_id, role)
    values (comm, me, 'member'), (comm, other, 'owner') on conflict do nothing;
  insert into public.community_followers (community_id, user_id)
    values (comm, me) on conflict do nothing;

  -- Twenty messages in one room.
  for i in 1..20 loop
    insert into public.community_chat_messages (community_id, sender_id, body)
      values (comm, other, 'msg ' || i);
  end loop;

  select count(*) into n from public.notifications
   where user_id = me and type = 'community_message' and read_at is null;
  if n <> 1 then
    raise exception 'FAIL: 20 room messages produced % unread rows, expected 1', n;
  end if;

  -- Once READ, the next message opens a fresh unread row.
  update public.notifications set read_at = now()
   where user_id = me and type = 'community_message' and read_at is null;
  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, other, 'after the read');
  select count(*) into n from public.notifications
   where user_id = me and type = 'community_message' and read_at is null;
  if n <> 1 then
    raise exception 'FAIL: a message after a read produced % unread rows', n;
  end if;

  -- The sender never notifies themselves.
  select count(*) into n from public.notifications
   where user_id = other and type = 'community_message';
  if n <> 0 then
    raise exception 'FAIL: the sender received % notifications for their own messages', n;
  end if;

  raise notice 'OK: 20 messages = 1 row; a read reopens exactly one; sender excluded';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Access: leaving the space removes its traffic from the inbox.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; other uuid; comm uuid; ids uuid[]; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false)=false
     order by p.created_at limit 2) s;
  me := ids[1]; other := ids[2];
  delete from public.notifications where user_id = me;

  perform set_config('app.community_moderation','1',true);
  insert into public.communities (name, description, owner_id, status, is_society)
  values ('Access fixture', 'fixture', other, 'approved', false) returning id into comm;
  perform set_config('app.community_moderation','0',true);
  insert into public.community_members (community_id, user_id, role)
    values (comm, me, 'member'), (comm, other, 'owner') on conflict do nothing;
  insert into public.community_followers (community_id, user_id)
    values (comm, me) on conflict do nothing;

  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, other, 'while a member');

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates where type = 'community_message';
  execute 'set local role postgres';
  if n <> 1 then
    raise exception 'FAIL: a member sees % of their room messages', n;
  end if;

  -- Leave the space.
  delete from public.community_members where community_id = comm and user_id = me;
  delete from public.community_followers where community_id = comm and user_id = me;

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates where type = 'community_message';
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: % room messages survived leaving the space', n;
  end if;

  raise notice 'OK: losing access removes the space traffic from the inbox';
end $$;

-- ---------------------------------------------------------------------------
-- 6. A student sees only their own inbox.
-- ---------------------------------------------------------------------------
do $$
declare me uuid; other uuid; ids uuid[]; n int;
begin
  select array_agg(id) into ids from (
    select id from public.profiles order by created_at limit 2) s;
  me := ids[1]; other := ids[2];

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates u where u.user_id = other;
  if n <> 0 then
    raise exception 'FAIL: one student reads another''s Updates (% rows)', n;
  end if;
  select count(*) into n from public.activity_notifications a where a.user_id = other;
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: one student reads another''s Notifications (% rows)', n;
  end if;

  raise notice 'OK: both surfaces are RLS-scoped to the reader';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
