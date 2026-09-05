-- =============================================================================
-- Verification for migration 0183 — Community updates: the badge, the list, and
-- everything that must NOT be in it.
--
-- Run against a database that already has 0183 applied. Everything happens
-- inside a transaction that is ROLLED BACK, so it writes nothing permanent —
-- but it does exercise real triggers, RLS and the view, so run it on dev first.
--
--   psql "$DB_URL" -f supabase/tests/community_updates.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition. A silent run is NOT a pass.
--
-- Impersonation is the usual trick (uat18_verification.sql): set
-- `request.jwt.claims`, which is what auth.uid() reads. `community_updates` and
-- `community_badge_count()` are both SECURITY INVOKER over RLS-scoped tables,
-- and RLS does not apply to a superuser — so every read of them below runs as
-- `authenticated`, or it would silently see everybody's rows and pass for the
-- wrong reason.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structure and posture.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'community_update_types', 'community_badge_count',
    'mark_community_update_read', 'mark_community_updates_read',
    'notify_event_material_update'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
    ) then
      raise exception 'FAIL: missing function %', fn;
    end if;
  end loop;

  if not exists (
    select 1 from pg_views where schemaname = 'public' and viewname = 'community_updates'
  ) then
    raise exception 'FAIL: view community_updates is missing';
  end if;

  -- security_invoker is the whole authorization story for the view. Without it
  -- the view would run as its owner and RLS on notifications would not apply —
  -- every student would read every student's updates.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'community_updates'
       and c.reloptions::text like '%security_invoker=true%'
  ) then
    raise exception 'FAIL: community_updates is not security_invoker';
  end if;

  if has_table_privilege('anon', 'public.community_updates', 'select') then
    raise exception 'FAIL: anon can read community_updates';
  end if;
  foreach fn in array array[
    'community_badge_count()', 'mark_community_update_read(uuid)',
    'mark_community_updates_read()'
  ] loop
    if has_function_privilege('anon', 'public.' || fn, 'execute') then
      raise exception 'FAIL: anon holds EXECUTE on %', fn;
    end if;
  end loop;

  -- The realtime listener needs this, and 0176 had removed it.
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'notifications'
  ) then
    raise exception 'FAIL: notifications is not in the realtime publication';
  end if;

  -- Chat must not be in the domain, at all.
  if 'community_message' = any (public.community_update_types())
     or 'event_message' = any (public.community_update_types())
     or 'message' = any (public.community_update_types()) then
    raise exception 'FAIL: a chat type is in the Community update domain';
  end if;

  raise notice 'OK: structure, grants, publication and domain';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Counting rules.
-- ---------------------------------------------------------------------------
do $$
declare
  mgr uuid; a uuid; b uuid; outsider uuid;
  ids uuid[];
  comm uuid;
  ev   uuid;
  p1 uuid; p2 uuid;
  n1 uuid;
  before_n int; n int; badge int;
begin
  select array_agg(id) into ids from (
    select id from public.profiles
     where deactivated_at is null and coalesce(is_banned, false) = false
     order by created_at limit 4
  ) s;
  if coalesce(array_length(ids, 1), 0) < 4 then
    raise exception 'need at least 4 live profiles to run this verification';
  end if;
  mgr := ids[1]; a := ids[2]; b := ids[3]; outsider := ids[4];

  -- create_notification() honours notification_preferences and SKIPS a
  -- recipient whose category is off (or who has no row at all). Seed the two
  -- categories these fixtures use, or every assertion below would pass on an
  -- empty set for the wrong reason.
  insert into public.notification_preferences (user_id, communities, events)
    select unnest(ids), true, true
  on conflict (user_id) do update
    set communities = true, events = true;

  -- A clean slate for these four, so counts describe only what we create.
  delete from public.notifications where user_id in (mgr, a, b, outsider);

  -- A community owned by the manager. `app.community_moderation` is the same
  -- escape hatch moderate_community() uses to set an approved status.
  perform set_config('app.community_moderation', '1', true);
  insert into public.communities (name, description, owner_id, status, is_society)
  values ('Verification Space', 'fixture', mgr, 'approved', false)
  returning id into comm;
  perform set_config('app.community_moderation', '0', true);

  insert into public.community_members (community_id, user_id, role)
    values (comm, mgr, 'owner') on conflict do nothing;
  insert into public.community_followers (community_id, user_id)
    values (comm, mgr) on conflict do nothing;

  -- ---- 1a. TWO pending join requests in ONE community are TWO updates. -----
  -- (The old badge collapsed them into a single "this community needs you".)
  insert into public.community_join_requests (community_id, user_id, status)
    values (comm, a, 'pending'), (comm, b, 'pending');
  perform public.create_notification(mgr, a, 'community_join_request', 'communities',
    jsonb_build_object('community_id', comm));
  perform public.create_notification(mgr, b, 'community_join_request', 'communities',
    jsonb_build_object('community_id', comm));

  perform set_config('request.jwt.claims', json_build_object('sub', mgr)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where read_at is null and type = 'community_join_request';
  execute 'set local role postgres';
  if n <> 2 then
    raise exception 'FAIL: two pending join requests counted as %, expected 2', n;
  end if;

  -- ---- 1b. TWO pending review posts are TWO updates. ----------------------
  insert into public.posts (author_id, body, community_id, moderation_status)
    values (a, 'pending one', comm, 'pending') returning id into p1;
  insert into public.posts (author_id, body, community_id, moderation_status)
    values (b, 'pending two', comm, 'pending') returning id into p2;

  perform set_config('request.jwt.claims', json_build_object('sub', mgr)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where read_at is null and type = 'community_post_review';
  execute 'set local role postgres';
  if n <> 2 then
    raise exception 'FAIL: two pending posts counted as %, expected 2', n;
  end if;

  -- ---- 1c. Two announcements in ONE followed space are TWO updates. -------
  -- (The old badge collapsed a whole space's output into one item.)
  insert into public.community_followers (community_id, user_id)
    values (comm, a) on conflict do nothing;
  perform public.notify_society_members(comm, mgr, 'society_announcement',
    jsonb_build_object('community_id', comm, 'announcement_id', gen_random_uuid()));
  perform public.notify_society_members(comm, mgr, 'society_announcement',
    jsonb_build_object('community_id', comm, 'announcement_id', gen_random_uuid()));

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where read_at is null and type = 'society_announcement';
  execute 'set local role postgres';
  if n <> 2 then
    raise exception 'FAIL: two announcements counted as %, expected 2', n;
  end if;

  -- ---- 1d. The author's OWN announcement counts 0. ------------------------
  select count(*) into n from public.notifications
   where user_id = mgr and type = 'society_announcement';
  if n <> 0 then
    raise exception 'FAIL: the author was notified of their own announcement';
  end if;

  -- ---- 1e. An announcement from BEFORE following counts 0. ---------------
  -- The fan-out happens at post time against the follower list as it then was,
  -- so `outsider` — who follows only now — has nothing from the two above.
  insert into public.community_followers (community_id, user_id)
    values (comm, outsider) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', outsider)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates where read_at is null;
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: a late follower inherited % historical updates', n;
  end if;

  -- ---- 1f. Raw community chat counts 0. ----------------------------------
  select count(*) into before_n from public.notifications where user_id = a;
  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, mgr, 'just talking');
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where type in ('community_message', 'event_message');
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: % chat rows reached the Community updates', n;
  end if;

  -- ---- 1g. A brand new community and a brand new event count 0 -----------
  -- for anybody not involved. Nothing emits a per-user record for them at all.
  select count(*) into before_n from public.notifications where user_id = outsider;
  perform set_config('app.community_moderation', '1', true);
  insert into public.communities (name, description, owner_id, status, is_society)
    values ('Irrelevant Space', 'fixture', a, 'approved', false);
  perform set_config('app.community_moderation', '0', true);
  perform set_config('app.event_moderation', '1', true);
  insert into public.events (host_id, title, starts_at, status, location)
    values (a, 'Irrelevant Event', now() + interval '10 days', 'approved', 'Old Hall')
    returning id into ev;
  perform set_config('app.event_moderation', '0', true);
  select count(*) into n from public.notifications where user_id = outsider;
  if n <> before_n then
    raise exception 'FAIL: a platform-wide creation produced % updates', n - before_n;
  end if;

  raise notice 'OK: per-item counting, own/late/chat/global exclusions';

  -- -------------------------------------------------------------------------
  -- 2. Event updates: material vs cosmetic, and one edit = one update.
  -- -------------------------------------------------------------------------
  insert into public.event_attendees (event_id, user_id) values (ev, b);
  delete from public.notifications where user_id = b and type = 'event_updated';

  -- Cosmetic: title, description, cover. Must produce nothing.
  update public.events
     set title = 'Irrelevant Event (final)', description = 'now with detail'
   where id = ev;
  select count(*) into n from public.notifications
   where user_id = b and type = 'event_updated';
  if n <> 0 then
    raise exception 'FAIL: a cosmetic edit produced % updates', n;
  end if;

  -- Material, several fields at once: exactly ONE update.
  update public.events
     set starts_at = now() + interval '12 days',
         ends_at   = now() + interval '12 days 2 hours',
         location  = 'New Hall'
   where id = ev;
  select count(*) into n from public.notifications
   where user_id = b and type = 'event_updated';
  if n <> 1 then
    raise exception 'FAIL: one material edit produced % updates, expected 1', n;
  end if;

  -- A retry / a second edit before it is read must not stack a second row —
  -- the group_key collapses them into the one unread "this event changed".
  update public.events set location = 'Newer Hall' where id = ev;
  select count(*) into n from public.notifications
   where user_id = b and type = 'event_updated' and read_at is null;
  if n <> 1 then
    raise exception 'FAIL: duplicate delivery produced % unread rows', n;
  end if;

  -- The host doing the editing is never notified of their own edit.
  select count(*) into n from public.notifications
   where user_id = a and type = 'event_updated';
  if n <> 0 then
    raise exception 'FAIL: the editor was notified of their own edit';
  end if;

  raise notice 'OK: event updates — material only, one per edit, dedup, not self';

  -- -------------------------------------------------------------------------
  -- 3. Resolution and access: an update stops counting when it stops being real.
  -- -------------------------------------------------------------------------
  -- 3a. Another manager decides one of the join requests.
  delete from public.community_join_requests where community_id = comm and user_id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', mgr)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where read_at is null and type = 'community_join_request';
  execute 'set local role postgres';
  if n <> 1 then
    raise exception 'FAIL: a resolved join request still counts (% left)', n;
  end if;

  -- 3b. A pending post is approved elsewhere.
  update public.posts set moderation_status = 'approved' where id = p1;
  perform set_config('request.jwt.claims', json_build_object('sub', mgr)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where read_at is null and type = 'community_post_review';
  execute 'set local role postgres';
  if n <> 1 then
    raise exception 'FAIL: an approved post still sits in the queue count (%)', n;
  end if;

  -- 3c. A deleted subject stops counting (notifications_live's cascade).
  delete from public.posts where id = p2;
  perform set_config('request.jwt.claims', json_build_object('sub', mgr)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where type = 'community_post_review';
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: a deleted post left % updates behind', n;
  end if;

  -- 3d. Losing follower access removes the announcements from the count.
  delete from public.community_followers where community_id = comm and user_id = a;
  delete from public.community_members where community_id = comm and user_id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where type = 'society_announcement';
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: % announcements survived leaving the space', n;
  end if;

  -- 3e. Losing manager access removes the queue from the count. The owner is
  -- swapped away, so `mgr` can no longer manage this community at all.
  perform set_config('app.community_moderation', '1', true);
  update public.communities set owner_id = outsider where id = comm;
  perform set_config('app.community_moderation', '0', true);
  delete from public.community_members where community_id = comm and user_id = mgr;
  perform set_config('request.jwt.claims', json_build_object('sub', mgr)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates
   where type in ('community_join_request', 'community_post_review');
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: % manager items survived losing the role', n;
  end if;

  raise notice 'OK: resolution, deletion and access loss all stop the count';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The badge IS the list, reads are deliberate, and nobody reads anyone else.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; other uuid;
  ids uuid[];
  ev uuid;
  n int; badge int; cleared int; ok boolean;
  first_id uuid;
begin
  select array_agg(id) into ids from (
    select id from public.profiles
     where deactivated_at is null and coalesce(is_banned, false) = false
     order by created_at limit 2
  ) s;
  me := ids[1]; other := ids[2];

  insert into public.notification_preferences (user_id, communities, events)
    select unnest(ids), true, true
  on conflict (user_id) do update
    set communities = true, events = true;

  delete from public.notifications where user_id in (me, other);

  perform set_config('app.event_moderation', '1', true);
  insert into public.events (host_id, title, starts_at, status)
    values (me, 'Badge Fixture', now() + interval '3 days', 'approved')
    returning id into ev;
  perform set_config('app.event_moderation', '0', true);

  -- Twelve informational updates, so the "> 9" rendering rule has something to
  -- render and the count is unambiguous.
  for n in 1..12 loop
    perform public.create_notification(me, null, 'event_reminder', 'events',
      jsonb_build_object('event_id', ev, 'kind', case when n = 1 then '24h' else '1h' end));
    -- create_notification is idempotent only via group_key, which reminders do
    -- not use, so each call is its own row.
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.community_updates where read_at is null;
  select (public.community_badge_count() ->> 'updates')::int into badge;
  if n <> badge then
    raise exception 'FAIL: badge says % but the list has % unread', badge, n;
  end if;
  if badge < 10 then
    raise exception 'FAIL: fixture produced only % updates, wanted >9', badge;
  end if;

  -- Opening one item clears exactly that one.
  select id into first_id from public.community_updates
   where read_at is null order by created_at desc limit 1;
  select public.mark_community_update_read(first_id) into ok;
  if not ok then
    raise exception 'FAIL: marking an own update read reported no row';
  end if;
  if (select (public.community_badge_count() ->> 'updates')::int) <> badge - 1 then
    raise exception 'FAIL: opening one item did not clear exactly one';
  end if;

  -- Idempotent: the same call again changes nothing.
  select public.mark_community_update_read(first_id) into ok;
  if ok then
    raise exception 'FAIL: marking an already-read update reported a change';
  end if;
  if (select (public.community_badge_count() ->> 'updates')::int) <> badge - 1 then
    raise exception 'FAIL: a repeated mark-read moved the count';
  end if;

  -- Mark all clears the rest, and only the rest.
  select public.mark_community_updates_read() into cleared;
  if cleared <> badge - 1 then
    raise exception 'FAIL: mark-all cleared % rows, expected %', cleared, badge - 1;
  end if;
  if (select (public.community_badge_count() ->> 'updates')::int) <> 0 then
    raise exception 'FAIL: the badge is not zero after mark-all';
  end if;
  -- Zero means no badge, and never a negative.
  if (select (public.community_badge_count() ->> 'updates')::int) < 0 then
    raise exception 'FAIL: the badge went negative';
  end if;

  execute 'set local role postgres';

  -- Another student's updates are invisible and unmarkable.
  perform public.create_notification(other, null, 'event_reminder', 'events',
    jsonb_build_object('event_id', ev, 'kind', '1h'));
  select id into first_id from public.notifications
   where user_id = other and read_at is null limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.community_updates u where u.id = first_id;
  if n <> 0 then
    raise exception 'FAIL: one student can read another''s Community updates';
  end if;
  select public.mark_community_update_read(first_id) into ok;
  execute 'set local role postgres';
  if ok then
    raise exception 'FAIL: a forged id marked another student''s update read';
  end if;
  if (select read_at from public.notifications where id = first_id) is not null then
    raise exception 'FAIL: another student''s update was actually marked read';
  end if;

  raise notice 'OK: badge = list, deliberate reads, idempotent, no cross-user access';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
