-- =============================================================================
-- Verification for migration 0179 — conversation parity on the non-DM surfaces.
--
-- Run against the target project AFTER applying 0179. Everything happens inside
-- a transaction that is ROLLED BACK, so it writes nothing permanent — but it
-- does exercise real inserts against real tables, so run it on dev first.
--
--   psql "$DB_URL" -f supabase/tests/conversation_parity_verification.sql
--
-- Every check raises on failure, so a run ending in "ALL CHECKS PASSED" is the
-- pass condition. A silent run is NOT a pass.
--
-- WHY THE FUNCTIONS ARE EXECUTED, NOT JUST COUNTED. `check_function_bodies` is
-- off in every migration in this repo, so a function referring to a column that
-- does not exist is created happily and fails at CALL time. Existence checks
-- alone have missed exactly that before (migration 0143 is the canonical case),
-- so every guard below is actually invoked.
--
-- The impersonation trick is the same one uat18_verification.sql uses: set
-- `request.jwt.claims`, which is what `auth.uid()` reads.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structural: the objects exist, with the right posture.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text[] := '{}';
  fn text;
begin
  foreach fn in array array[
    'send_community_message', 'edit_community_chat_message',
    'set_community_chat_pin', 'toggle_community_chat_reaction',
    'can_moderate_community_chat', 'enforce_community_reply_same_room',
    'edit_event_message', 'delete_event_message',
    'toggle_event_message_reaction', 'can_post_event_message',
    'can_moderate_event_messages', 'enforce_event_reply_same_event',
    'edit_society_announcement'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    ) then
      missing := missing || fn;
    end if;
  end loop;
  if array_length(missing, 1) is not null then
    raise exception 'FAIL: missing functions: %', missing;
  end if;
  raise notice 'OK: all 0179 functions present';
end $$;

-- send_community_message MUST be unique. If the 3-argument form survived the
-- drop, the deployed client's 3-named-argument call matches both candidates and
-- PostgreSQL answers "function is not unique" — every chat room breaks.
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'send_community_message';
  if n <> 1 then
    raise exception 'FAIL: send_community_message has % overloads, expected 1', n;
  end if;
  -- Matched on the PARAMETER NAME, not on a type list:
  -- `pg_get_function_identity_arguments` returns "p_community_id uuid,
  -- p_body text, ..." — names included — so a pattern like '%uuid, text%'
  -- never matches and reports a perfectly good function as broken.
  if (select pg_get_function_identity_arguments(p.oid)
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'send_community_message')
     not like '%p_reply_to uuid%' then
    raise exception 'FAIL: send_community_message does not take the reply target';
  end if;
  raise notice 'OK: send_community_message is unique and takes p_reply_to';
end $$;

-- anon must hold EXECUTE on none of the new writers.
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('edit_community_chat_message','set_community_chat_pin',
                       'toggle_community_chat_reaction','edit_event_message',
                       'delete_event_message','toggle_event_message_reaction',
                       'edit_society_announcement')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'FAIL: anon can execute % of the new RPCs', n;
  end if;

  -- The two RLS-backed event RPCs must stay SECURITY INVOKER: they are written
  -- so the POLICY is the authorization, and a DEFINER slip would bypass it.
  if (select bool_or(p.prosecdef)
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public'
         and p.proname in ('edit_event_message','delete_event_message')) then
    raise exception 'FAIL: an event message RPC is SECURITY DEFINER';
  end if;
  raise notice 'OK: grants and definer posture correct';
end $$;

-- The view carries the three appended columns, and is still security_invoker.
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'community_chat_view'
     and column_name in ('edited_at', 'pinned_at', 'reply_to_id');
  if n <> 3 then
    raise exception 'FAIL: community_chat_view is missing % of 3 new columns', 3 - n;
  end if;
  -- `reloptions` stores whatever spelling the ALTER used, so this must accept
  -- both: `set (security_invoker = on)` records `security_invoker=on`, while
  -- `= true` records `security_invoker=true`. Matching only one of them is a
  -- false alarm on a view that is perfectly correct.
  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'community_chat_view'
       and c.reloptions::text[] && array['security_invoker=on','security_invoker=true']
  ) then
    raise exception 'FAIL: community_chat_view is no longer security_invoker';
  end if;
  raise notice 'OK: community_chat_view updated and still security_invoker';
end $$;

-- Reaction tables are deliberately NOT in the realtime publication (they
-- synchronise by broadcast), and society_announcements now IS.
do $$
declare n int;
begin
  select count(*) into n from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('community_chat_reactions','event_message_reactions',
                       'society_announcement_reactions');
  if n <> 0 then
    raise exception 'FAIL: % reaction table(s) are published to realtime; see the 0179 header on apply_rls cost', n;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'society_announcements'
  ) then
    raise exception 'FAIL: society_announcements is not published, so the broadcast channel is still not live';
  end if;
  raise notice 'OK: realtime publication is as intended';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Community chat: replies stay in their room, and a non-member cannot react.
-- ---------------------------------------------------------------------------
do $$
declare
  room_a  uuid;
  room_b  uuid;
  member  uuid;
  outsider uuid;
  msg_a   uuid;
  msg_b   uuid;
  ok boolean := false;
begin
  select cm.community_id, cm.user_id into room_a, member
    from public.community_members cm
    join public.communities c on c.id = cm.community_id
   where c.status = 'approved'
   limit 1;
  if room_a is null then
    raise notice 'SKIP: no approved community with a member on this database';
    return;
  end if;

  select c.id into room_b from public.communities c
   where c.status = 'approved' and c.id <> room_a
     and exists (select 1 from public.community_members m
                  where m.community_id = c.id and m.user_id = member)
   limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', member)::text, true);

  -- A plain message, then a reply to it in the same room: allowed.
  msg_a := public.send_community_message(room_a, 'parity check A', false, null);
  msg_b := public.send_community_message(room_a, 'parity check B', false, msg_a);
  if msg_b is null then
    raise exception 'FAIL: a same-room reply was not written';
  end if;

  -- A reply pointing at another room must be rejected by the trigger.
  if room_b is not null then
    declare other_msg uuid;
    begin
      other_msg := public.send_community_message(room_b, 'parity check C', false, null);
      begin
        perform public.send_community_message(room_a, 'cross-room reply', false, other_msg);
      exception when others then
        ok := true;
      end;
      if not ok then
        raise exception 'FAIL: a reply targeting another room was accepted';
      end if;
      raise notice 'OK: cross-room replies are refused';
    end;
  else
    raise notice 'SKIP: cross-room reply check (member is only in one room)';
  end if;

  -- Editing is the author's alone, and text only.
  perform public.edit_community_chat_message(msg_a, 'parity check A (edited)');
  if not exists (
    select 1 from public.community_chat_messages
     where id = msg_a and edited_at is not null and body = 'parity check A (edited)'
  ) then
    raise exception 'FAIL: the author could not edit their own message';
  end if;

  -- A non-member can neither react nor edit.
  select p.id into outsider from public.profiles p
   where not exists (select 1 from public.community_members m
                      where m.community_id = room_a and m.user_id = p.id)
   limit 1;
  if outsider is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', outsider)::text, true);
    ok := false;
    begin
      perform public.toggle_community_chat_reaction(msg_a, '🔥');
    exception when others then
      ok := true;
    end;
    if not ok then
      raise exception 'FAIL: a non-member reacted to a room message';
    end if;

    ok := false;
    begin
      perform public.edit_community_chat_message(msg_a, 'hijacked');
    exception when others then
      ok := true;
    end;
    if not ok then
      raise exception 'FAIL: a non-author edited someone else''s room message';
    end if;
    raise notice 'OK: a non-member can neither react to nor edit a room message';
  else
    raise notice 'SKIP: outsider checks (every profile is a member of this room)';
  end if;

  -- The member CAN react to a message in their own room.
  perform set_config('request.jwt.claims', json_build_object('sub', member)::text, true);
  if public.toggle_community_chat_reaction(msg_a, '🔥') is not true then
    raise exception 'FAIL: a member could not react in their own room';
  end if;
  -- ...and the same emoji again clears it (one reaction per user).
  if public.toggle_community_chat_reaction(msg_a, '🔥') is not false then
    raise exception 'FAIL: re-tapping the same emoji did not clear the reaction';
  end if;
  raise notice 'OK: room reactions toggle one-per-user';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Community chat: pinning is a MODERATION power, not an authorship one.
-- ---------------------------------------------------------------------------
do $$
declare
  room   uuid;
  plain  uuid;
  msg    uuid;
  ok boolean := false;
begin
  select cm.community_id, cm.user_id into room, plain
    from public.community_members cm
    join public.communities c on c.id = cm.community_id
   where c.status = 'approved' and cm.role = 'member'
     and not public.is_admin(cm.user_id)
   limit 1;
  if room is null then
    raise notice 'SKIP: no plain member of an approved community on this database';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', plain)::text, true);
  msg := public.send_community_message(room, 'pin check', false, null);

  begin
    perform public.set_community_chat_pin(msg, true);
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL: a plain member pinned a message in a room they do not moderate';
  end if;
  raise notice 'OK: pinning refuses a plain member, even on their own message';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Event discussion: attendee gating survives every new capability.
--
-- ROLE SWITCHING IS LOAD-BEARING IN THIS SECTION, and it is the one thing that
-- makes the difference between a real check and a green tick. The event thread
-- is guarded by RLS POLICIES rather than by definer RPCs, and RLS does not
-- apply to the table owner — so every assertion below that depends on a policy
-- would pass for anybody if it ran as the connection's default (superuser)
-- role. `set local role authenticated` is what puts the policies back in the
-- path; setup queries stay outside it so they can still read what they need.
-- ---------------------------------------------------------------------------
do $$
declare
  ev        uuid;
  attendee  uuid;
  outsider  uuid;
  msg       uuid;
  other_ev  uuid;
  other_msg uuid;
  ok boolean := false;
begin
  select a.event_id, a.user_id into ev, attendee
    from public.event_attendees a
    join public.events e on e.id = a.event_id
   where e.status = 'approved'
   limit 1;
  if ev is null then
    raise notice 'SKIP: no approved event with an attendee on this database';
    return;
  end if;

  select e.id into other_ev from public.events e
   where e.status = 'approved' and e.id <> ev
     and exists (select 1 from public.event_attendees a
                  where a.event_id = e.id and a.user_id = attendee)
   limit 1;

  select p.id into outsider from public.profiles p
   where not exists (select 1 from public.event_attendees a
                      where a.event_id = ev and a.user_id = p.id)
     and not exists (select 1 from public.events e
                      where e.id = ev and e.host_id = p.id)
     and not public.is_admin(p.id)
   limit 1;

  -- ---- as the attendee, with the policies in force -------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', attendee)::text, true);
  execute 'set local role authenticated';

  insert into public.event_messages (event_id, sender_id, body)
    values (ev, attendee, 'parity check') returning id into msg;

  if public.toggle_event_message_reaction(msg, '👍') is not true then
    raise exception 'FAIL: an attendee could not react';
  end if;
  perform public.edit_event_message(msg, 'parity check (edited)');
  if not exists (select 1 from public.event_messages
                  where id = msg and edited_at is not null) then
    raise exception 'FAIL: an attendee could not edit their own message';
  end if;
  raise notice 'OK: an attendee can post, react and edit their own message';

  -- A reply must stay inside its own event (a TRIGGER, so it fires for every
  -- role — but it is checked here so the whole path is exercised at once).
  if other_ev is not null then
    insert into public.event_messages (event_id, sender_id, body)
      values (other_ev, attendee, 'other event') returning id into other_msg;
    ok := false;
    begin
      insert into public.event_messages (event_id, sender_id, body, reply_to_id)
        values (ev, attendee, 'cross-event reply', other_msg);
    exception when others then
      ok := true;
    end;
    if not ok then
      raise exception 'FAIL: a reply targeting another event was accepted';
    end if;
    raise notice 'OK: cross-event replies are refused';
  else
    raise notice 'SKIP: cross-event reply check (attendee is only at one event)';
  end if;

  -- ---- as a NON-ATTENDEE ---------------------------------------------------
  -- This is the whole point of the surface's gating and it must survive every
  -- new capability.
  if outsider is null then
    raise notice 'SKIP: outsider checks (no non-attendee profile available)';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', outsider)::text, true);

    ok := false;
    begin
      insert into public.event_messages (event_id, sender_id, body)
        values (ev, outsider, 'should be refused');
    exception when others then
      ok := true;
    end;
    if not ok then
      raise exception 'FAIL: a non-attendee posted to an event discussion';
    end if;

    ok := false;
    begin
      perform public.toggle_event_message_reaction(msg, '🔥');
    exception when others then
      ok := true;
    end;
    if not ok then
      raise exception 'FAIL: a non-attendee reacted in an event discussion';
    end if;

    ok := false;
    begin
      perform public.edit_event_message(msg, 'hijacked');
    exception when others then
      ok := true;
    end;
    if not ok then
      raise exception 'FAIL: a non-attendee edited an event message';
    end if;

    ok := false;
    begin
      perform public.delete_event_message(msg);
    exception when others then
      ok := true;
    end;
    if not ok then
      raise exception 'FAIL: a non-attendee deleted an event message';
    end if;
    raise notice 'OK: a non-attendee can neither send, react, edit nor delete';
  end if;

  -- ---- the author CAN unsend, and the tombstone keeps no content -----------
  perform set_config('request.jwt.claims', json_build_object('sub', attendee)::text, true);
  perform public.delete_event_message(msg);
  reset role;
  if not exists (
    select 1 from public.event_messages
     where id = msg and deleted_at is not null and body = ''
       and attachment_url is null
  ) then
    raise exception 'FAIL: unsend did not produce a content-free tombstone';
  end if;
  raise notice 'OK: an attendee can unsend their own message';
exception when others then
  -- Never leave the transaction wearing a restricted role: the sections after
  -- this one read catalogs and other people's rows.
  reset role;
  raise;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Broadcast channel: an officer may DELETE but must never REWRITE.
-- ---------------------------------------------------------------------------
do $$
declare
  soc     uuid;
  author  uuid;
  officer uuid;
  ann     uuid;
  ok boolean := false;
begin
  select a.society_id, a.author_id into soc, author
    from public.society_announcements a
    join public.communities c on c.id = a.society_id
   where c.status = 'approved' and a.poll_id is null
   order by a.created_at desc
   limit 1;
  if soc is null then
    raise notice 'SKIP: no broadcast on this database';
    return;
  end if;

  -- The author may edit their own.
  perform set_config('request.jwt.claims', json_build_object('sub', author)::text, true);
  select a.id into ann from public.society_announcements a
   where a.society_id = soc and a.author_id = author and a.poll_id is null limit 1;
  perform public.edit_society_announcement(ann, 'parity check (edited)');
  if not exists (select 1 from public.society_announcements
                  where id = ann and body = 'parity check (edited)') then
    raise exception 'FAIL: the author could not edit their own broadcast';
  end if;

  -- An officer who is NOT the author may not.
  select r.user_id into officer from public.society_roles r
   where r.society_id = soc and r.user_id <> author limit 1;
  if officer is null then
    select c.owner_id into officer from public.communities c
     where c.id = soc and c.owner_id <> author;
  end if;
  if officer is null then
    raise notice 'SKIP: officer-cannot-rewrite check (no officer other than the author)';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', officer)::text, true);
    begin
      perform public.edit_society_announcement(ann, 'words in their mouth');
    exception when others then
      ok := true;
    end;
    if not ok then
      raise exception 'FAIL: an officer rewrote another member''s broadcast';
    end if;
    raise notice 'OK: an officer may moderate a broadcast but not rewrite one';
  end if;
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
