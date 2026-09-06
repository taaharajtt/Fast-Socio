-- =============================================================================
-- Verification for migration 0196 — "Disable message requests".
--
-- Run against a database with 0196 applied. Everything is inside a transaction
-- that is ROLLED BACK.
--
--   psql "$DB_URL" -f supabase/tests/disable_message_requests.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition.
--
-- The property under test is narrow and must stay narrow: the setting stops
-- NEW message requests and nothing else. Sections 5 and 6 are the "and nothing
-- else" half, and they matter as much as sections 2 and 3.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. The column: default off, never null, backfilled.
-- ---------------------------------------------------------------------------
do $$
declare v_default text; v_nullable text; v_nulls int;
begin
  select column_default, is_nullable into v_default, v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name = 'disable_message_requests';

  if v_default is null then
    raise exception 'FAIL: disable_message_requests is missing';
  end if;
  if v_default not like '%false%' then
    raise exception 'FAIL: default is %, expected false', v_default;
  end if;
  if v_nullable <> 'NO' then
    raise exception 'FAIL: column is nullable';
  end if;

  -- Every EXISTING profile was backfilled by the not-null default.
  select count(*) into v_nulls
    from public.profiles where disable_message_requests is null;
  if v_nulls <> 0 then
    raise exception 'FAIL: % existing profiles have a null setting', v_nulls;
  end if;

  raise notice 'OK: column exists, defaults false, not null, fully backfilled';
end $$;

-- A NEW profile inherits the default without anyone setting it.
do $$
declare v_id uuid := gen_random_uuid(); v_val boolean;
begin
  insert into auth.users (id, email) values (v_id, v_id::text || '@isb.nu.edu.pk');
  insert into public.profiles (id, full_name) values (v_id, 'Default fixture');
  select disable_message_requests into v_val from public.profiles where id = v_id;
  if v_val is not false then
    raise exception 'FAIL: a new profile defaulted to %', v_val;
  end if;
  raise notice 'OK: a new profile defaults to false';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Only the owner may change it.
-- ---------------------------------------------------------------------------
do $$
declare me uuid; other uuid; ids uuid[]; v_val boolean;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and p.admin_role is null
     order by p.created_at limit 2) s;
  me := ids[1]; other := ids[2];

  update public.profiles set disable_message_requests = false where id in (me, other);

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';

  -- My own row: allowed.
  update public.profiles set disable_message_requests = true where id = me;

  -- Someone else's row: the UPDATE policy's `id = auth.uid()` means this
  -- matches nothing. It does not raise — it silently affects zero rows, which
  -- is the behaviour to assert.
  update public.profiles set disable_message_requests = true where id = other;

  execute 'set local role postgres';

  select disable_message_requests into v_val from public.profiles where id = me;
  if v_val is not true then
    raise exception 'FAIL: a user could not set their own preference';
  end if;
  select disable_message_requests into v_val from public.profiles where id = other;
  if v_val is not false then
    raise exception 'FAIL: a user changed ANOTHER user''s preference';
  end if;

  raise notice 'OK: self-update allowed, cross-user update affects nothing';
end $$;

-- ---------------------------------------------------------------------------
-- 2. OFF (default): a request goes through.  ON: it is refused.
-- ---------------------------------------------------------------------------
do $$
declare
  sender uuid; recipient uuid; ids uuid[]; v_id uuid; n int; caught text;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and p.admin_role is null
     order by p.created_at limit 2) s;
  sender := ids[1]; recipient := ids[2];

  delete from public.message_requests
   where sender_id in (sender, recipient) and recipient_id in (sender, recipient);
  delete from public.blocked_users
   where blocker_id in (sender, recipient) and blocked_id in (sender, recipient);
  update public.profiles set disable_message_requests = false where id = recipient;

  -- ---- OFF: accepted -----------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';
  v_id := public.send_message_request(recipient, 'hello there');
  execute 'set local role postgres';

  if v_id is null then
    raise exception 'FAIL: a request was refused while the setting was off';
  end if;
  select count(*) into n from public.message_requests
   where sender_id = sender and recipient_id = recipient and status = 'pending';
  if n <> 1 then
    raise exception 'FAIL: % pending rows after one send, expected 1', n;
  end if;

  -- ---- ON, and the sender has no existing request ------------------------
  delete from public.message_requests where sender_id = sender and recipient_id = recipient;
  update public.profiles set disable_message_requests = true where id = recipient;

  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';
  begin
    v_id := public.send_message_request(recipient, 'hello again');
    execute 'set local role postgres';
    raise exception 'FAIL: a request was created while the setting was ON';
  exception when others then
    execute 'set local role postgres';
    caught := sqlerrm;
    if caught like 'FAIL:%' then raise; end if;
  end;

  -- The error must be RECOGNISABLE — the app maps this sentence onto
  -- "This person isn't accepting message requests."
  if position('not accepting message requests' in caught) = 0 then
    raise exception 'FAIL: unrecognisable error: %', caught;
  end if;

  -- ...and nothing was written.
  select count(*) into n from public.message_requests
   where sender_id = sender and recipient_id = recipient;
  if n <> 0 then
    raise exception 'FAIL: % rows written despite the refusal', n;
  end if;

  -- ---- Re-enabling makes it work again -----------------------------------
  update public.profiles set disable_message_requests = false where id = recipient;
  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';
  v_id := public.send_message_request(recipient, 'third time');
  execute 'set local role postgres';
  if v_id is null then
    raise exception 'FAIL: re-enabling did not restore first contact';
  end if;

  raise notice 'OK: off -> allowed, on -> refused with a recognisable error, re-enable -> allowed';
end $$;

-- ---------------------------------------------------------------------------
-- 3. A DIRECT RPC call cannot bypass it, and neither can a direct INSERT.
-- ---------------------------------------------------------------------------
do $$
declare
  sender uuid; recipient uuid; ids uuid[]; n int; ok boolean := false;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and p.admin_role is null
     order by p.created_at limit 2) s;
  sender := ids[1]; recipient := ids[2];

  delete from public.message_requests
   where sender_id in (sender, recipient) and recipient_id in (sender, recipient);
  update public.profiles set disable_message_requests = true where id = recipient;

  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';

  -- The RPC is the documented path; calling it straight from the client (which
  -- is what PostgREST does) is exactly this.
  begin
    perform public.send_message_request(recipient, 'straight at the rpc');
  exception when others then
    ok := true;
  end;

  -- And the table itself. `message_requests` DOES carry a client INSERT policy
  -- (mig 0004), so this is a real door and not a theoretical one — mig 0197
  -- adds `accepts_message_requests(recipient_id)` to its WITH CHECK so a
  -- hand-written insert is refused the same way the RPC refuses.
  begin
    insert into public.message_requests (sender_id, recipient_id, message)
      values (sender, recipient, 'straight at the table');
  exception when others then
    null;
  end;

  execute 'set local role postgres';

  if not ok then
    raise exception 'FAIL: a direct RPC call bypassed the setting';
  end if;
  select count(*) into n from public.message_requests
   where sender_id = sender and recipient_id = recipient;
  if n <> 0 then
    raise exception 'FAIL: % rows reached the table by a direct write', n;
  end if;

  raise notice 'OK: neither the RPC nor a direct INSERT can bypass the setting';
end $$;

-- ---------------------------------------------------------------------------
-- 4. A PENDING request stays actionable; the sender's retry is idempotent.
-- ---------------------------------------------------------------------------
-- This is the "stale UI" case from the other side: the request exists, then the
-- recipient closes their door. The request they already received is still
-- theirs to accept or decline, and the sender's retry returns the same row
-- rather than erroring or creating a second one.
do $$
declare
  sender uuid; recipient uuid; ids uuid[]; v_first uuid; v_again uuid; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and p.admin_role is null
     order by p.created_at limit 2) s;
  sender := ids[1]; recipient := ids[2];

  delete from public.message_requests
   where sender_id in (sender, recipient) and recipient_id in (sender, recipient);
  update public.profiles set disable_message_requests = false where id = recipient;

  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';
  v_first := public.send_message_request(recipient, 'before the door closed');
  execute 'set local role postgres';

  -- The recipient now disables requests.
  update public.profiles set disable_message_requests = true where id = recipient;

  -- The pending row is still there and still visible to the recipient.
  perform set_config('request.jwt.claims', json_build_object('sub', recipient)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.message_requests
   where id = v_first and status = 'pending';
  execute 'set local role postgres';
  if n <> 1 then
    raise exception 'FAIL: a pending request became invisible to its recipient';
  end if;

  -- The sender retrying gets the SAME row back, not an error and not a second.
  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';
  v_again := public.send_message_request(recipient, 'retrying');
  execute 'set local role postgres';

  if v_again is distinct from v_first then
    raise exception 'FAIL: a retry produced % instead of the existing %', v_again, v_first;
  end if;
  select count(*) into n from public.message_requests
   where sender_id = sender and recipient_id = recipient;
  if n <> 1 then
    raise exception 'FAIL: % rows after a retry, expected 1', n;
  end if;

  -- ...and it is still acceptable, which is the point of keeping it.
  perform set_config('request.jwt.claims', json_build_object('sub', recipient)::text, true);
  execute 'set local role authenticated';
  perform public.accept_message_request(v_first);
  execute 'set local role postgres';
  select count(*) into n from public.message_requests
   where id = v_first and status = 'accepted';
  if n <> 1 then
    raise exception 'FAIL: a pending request could not be accepted';
  end if;

  raise notice 'OK: pending requests survive, stay acceptable, and retries stay idempotent';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Every OTHER rule still applies. The new check must not have displaced one.
-- ---------------------------------------------------------------------------
do $$
declare
  sender uuid; recipient uuid; ids uuid[]; caught text; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and p.admin_role is null
     order by p.created_at limit 2) s;
  sender := ids[1]; recipient := ids[2];
  delete from public.message_requests
   where sender_id in (sender, recipient) and recipient_id in (sender, recipient);
  delete from public.blocked_users
   where blocker_id in (sender, recipient) and blocked_id in (sender, recipient);
  update public.profiles set disable_message_requests = false where id = recipient;

  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';

  -- Self-send.
  begin
    perform public.send_message_request(sender, 'to myself');
    execute 'set local role postgres';
    raise exception 'FAIL: a self-request was accepted';
  exception when others then
    caught := sqlerrm;
    if caught like 'FAIL:%' then execute 'set local role postgres'; raise; end if;
    if position('yourself' in caught) = 0 then
      execute 'set local role postgres';
      raise exception 'FAIL: wrong error for a self-request: %', caught;
    end if;
  end;

  -- Length bounds, both ends.
  begin
    perform public.send_message_request(recipient, '   ');
    execute 'set local role postgres';
    raise exception 'FAIL: an empty message was accepted';
  exception when others then
    caught := sqlerrm;
    if caught like 'FAIL:%' then execute 'set local role postgres'; raise; end if;
  end;
  begin
    perform public.send_message_request(recipient, repeat('x', 251));
    execute 'set local role postgres';
    raise exception 'FAIL: a 251-character message was accepted';
  exception when others then
    caught := sqlerrm;
    if caught like 'FAIL:%' then execute 'set local role postgres'; raise; end if;
    if position('1-250' in caught) = 0 then
      execute 'set local role postgres';
      raise exception 'FAIL: wrong error for an over-long message: %', caught;
    end if;
  end;

  execute 'set local role postgres';

  -- Blocks, still bidirectional and still silent.
  insert into public.blocked_users (blocker_id, blocked_id)
    values (recipient, sender) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';
  begin
    perform public.send_message_request(recipient, 'through a block');
    execute 'set local role postgres';
    raise exception 'FAIL: a blocked sender got through';
  exception when others then
    caught := sqlerrm;
    execute 'set local role postgres';
    if caught like 'FAIL:%' then raise; end if;
    if position('not available' in caught) = 0 then
      raise exception 'FAIL: a block leaked a distinguishable error: %', caught;
    end if;
  end;
  delete from public.blocked_users where blocker_id = recipient and blocked_id = sender;

  -- A banned recipient, still refused with the same undistinguished message.
  update public.profiles set is_banned = true where id = recipient;
  perform set_config('request.jwt.claims', json_build_object('sub', sender)::text, true);
  execute 'set local role authenticated';
  begin
    perform public.send_message_request(recipient, 'to a banned account');
    execute 'set local role postgres';
    raise exception 'FAIL: a request to a banned account was accepted';
  exception when others then
    caught := sqlerrm;
    execute 'set local role postgres';
    if caught like 'FAIL:%' then raise; end if;
    if position('not available' in caught) = 0 then
      raise exception 'FAIL: wrong error for a banned recipient: %', caught;
    end if;
  end;
  update public.profiles set is_banned = false where id = recipient;

  select count(*) into n from public.message_requests
   where sender_id = sender and recipient_id = recipient;
  if n <> 0 then
    raise exception 'FAIL: % rows slipped through the other rules', n;
  end if;

  raise notice 'OK: self-send, length, blocks and bans all still enforced';
end $$;

-- ---------------------------------------------------------------------------
-- 6. What the setting must NOT touch.
-- ---------------------------------------------------------------------------
-- The whole risk of this feature is over-reach: "no message requests" quietly
-- becoming "no messages". Every surface below is exercised with the setting ON.
do $$
declare
  a uuid; b uuid; ids uuid[]; conv uuid; comm uuid; ev uuid; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and p.admin_role is null
     order by p.created_at limit 2) s;
  a := ids[1]; b := ids[2];

  -- BOTH sides disabled, to be sure the check is not consulted anywhere else.
  update public.profiles set disable_message_requests = true where id in (a, b);

  -- ---- an existing match may still open a conversation and send ----------
  insert into public.matches (user_low, user_high)
    values (least(a,b), greatest(a,b)) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  conv := public.get_or_create_conversation(b);
  if conv is null then
    execute 'set local role postgres';
    raise exception 'FAIL: a match could not open a conversation';
  end if;
  insert into public.messages (conversation_id, sender_id, body)
    values (conv, a, 'matches still talk');
  execute 'set local role postgres';

  select count(*) into n from public.messages where conversation_id = conv;
  if n < 1 then
    raise exception 'FAIL: a match could not send a message';
  end if;

  -- ...and the OTHER side can reply into the existing conversation.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  execute 'set local role authenticated';
  insert into public.messages (conversation_id, sender_id, body)
    values (conv, b, 'and they reply');
  execute 'set local role postgres';

  -- ---- a community room is untouched -------------------------------------
  perform set_config('app.community_moderation','1',true);
  insert into public.communities (name, description, owner_id, status, is_society)
  values ('DMR fixture room', 'fixture', b, 'approved', false) returning id into comm;
  perform set_config('app.community_moderation','0',true);
  insert into public.community_members (community_id, user_id, role)
    values (comm, a, 'member'), (comm, b, 'owner') on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, a, 'room chat still works');
  execute 'set local role postgres';
  select count(*) into n from public.community_chat_messages
   where community_id = comm and sender_id = a;
  if n <> 1 then
    raise exception 'FAIL: community room chat was affected';
  end if;

  -- ---- a Discover-created group room is the same table, also untouched ---
  update public.communities set is_discover_group = true where id = comm;
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  insert into public.community_chat_messages (community_id, sender_id, body)
    values (comm, a, 'discover group chat still works');
  execute 'set local role postgres';
  select count(*) into n from public.community_chat_messages
   where community_id = comm and sender_id = a;
  if n <> 2 then
    raise exception 'FAIL: Discover group chat was affected';
  end if;
  update public.communities set is_discover_group = false where id = comm;

  -- ---- an event discussion is untouched ----------------------------------
  insert into public.events (title, description, host_id, starts_at, status)
  values ('DMR fixture event', 'fixture', b, now() + interval '2 days', 'approved')
  returning id into ev;
  insert into public.event_attendees (event_id, user_id)
    values (ev, a), (ev, b) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';
  insert into public.event_messages (event_id, sender_id, body)
    values (ev, a, 'event chat still works');
  execute 'set local role postgres';
  select count(*) into n from public.event_messages where event_id = ev and sender_id = a;
  if n <> 1 then
    raise exception 'FAIL: event discussion was affected';
  end if;

  raise notice 'OK: matches, existing conversations, community, Discover and event chat all unaffected';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
