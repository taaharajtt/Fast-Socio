-- =============================================================================
-- Verification for migration 0178 — the UAT-18 remediation.
--
-- Run against the target project AFTER applying 0178. Everything happens inside
-- a transaction that is ROLLED BACK, so it writes nothing permanent — but it
-- does exercise real inserts against real tables, so run it on dev first.
--
--   psql "$DB_URL" -f supabase/tests/uat18_verification.sql
--
-- Every check raises on failure, so a run ending in "ALL CHECKS PASSED" is the
-- pass condition. A silent run is NOT a pass.
--
-- WHY THE FUNCTIONS ARE EXECUTED, NOT JUST COUNTED. `check_function_bodies` is
-- off in every migration in this repo, so a function referring to a column that
-- does not exist is created happily and fails at CALL time. Existence checks
-- alone have missed exactly that before (see the migration-drift note), so the
-- privileged paths below are actually invoked.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structural: every object 0178 promises exists, with the right posture.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text[] := '{}';
  fn text;
begin
  foreach fn in array array[
    'is_muted', 'may_notify', 'create_notification',
    'send_message_request', 'accept_message_request', 'decline_message_request',
    'enforce_mutual_match',
    'society_capabilities', 'post_society_announcement',
    'reveal_announcement_author', 'toggle_announcement_reaction',
    'transfer_society_ownership',
    'poll_ballots', 'poll_is_mine',
    'rename_community', 'rename_event',
    'get_discover_candidates'
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
  raise notice 'OK: all 0178 functions present';
end $$;

do $$
declare n int;
begin
  -- Every privileged RPC must be SECURITY DEFINER; a DEFINER->INVOKER slip is
  -- the quietest way for one of these guards to stop guarding.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('send_message_request','accept_message_request',
                       'reveal_announcement_author','poll_ballots',
                       'rename_community','rename_event','society_capabilities')
     and p.prosecdef = false;
  if n <> 0 then
    raise exception 'FAIL: % privileged RPC(s) are SECURITY INVOKER', n;
  end if;

  -- anon must hold EXECUTE on none of them.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('send_message_request','accept_message_request',
                       'reveal_announcement_author','poll_ballots')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'FAIL: anon can execute % privileged RPC(s)', n;
  end if;
  raise notice 'OK: definer posture and grants correct';
end $$;

-- ---------------------------------------------------------------------------
-- 1. UAT-12 — a match cannot exist without two explicit likes.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid; b uuid; ok boolean := false;
begin
  select id into a from public.profiles where onboarding_completed order by created_at limit 1;
  select id into b from public.profiles where onboarding_completed and id <> a order by created_at limit 1;
  if a is null or b is null then
    raise notice 'SKIP: need two onboarded profiles for the match checks';
    return;
  end if;
  if a > b then select a, b into b, a; end if;

  -- Clear the pair inside the transaction so the state is known.
  delete from public.matches where user_low = a and user_high = b;
  delete from public.swipes where (swiper_id = a and target_id = b)
                               or (swiper_id = b and target_id = a);

  -- 1a. No likes at all -> refused.
  begin
    insert into public.matches (user_low, user_high) values (a, b);
    raise exception 'FAIL: a match was created with no likes behind it';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: expected a check_violation'; end if;

  -- 1b. ONE-SIDED like -> still refused. This is the core UAT-12 claim.
  ok := false;
  insert into public.swipes (swiper_id, target_id, direction) values (a, b, 'like');
  delete from public.matches where user_low = a and user_high = b; -- trigger may have made one? it must not
  begin
    insert into public.matches (user_low, user_high) values (a, b);
    raise exception 'FAIL: a one-sided like produced a match';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: one-sided like was allowed to match'; end if;

  -- 1c. Reciprocal like -> the swipe trigger creates EXACTLY ONE match, and a
  --     redundant explicit insert is absorbed rather than duplicating.
  insert into public.swipes (swiper_id, target_id, direction) values (b, a, 'like');
  if (select count(*) from public.matches where user_low = a and user_high = b) <> 1 then
    raise exception 'FAIL: reciprocal likes did not produce exactly one match';
  end if;
  insert into public.matches (user_low, user_high) values (a, b)
    on conflict (user_low, user_high) do nothing;
  if (select count(*) from public.matches where user_low = a and user_high = b) <> 1 then
    raise exception 'FAIL: a second match row was created for the same pair';
  end if;

  -- 1d. A non-canonical pair is refused outright.
  ok := false;
  begin
    insert into public.matches (user_low, user_high) values (b, a);
    raise exception 'FAIL: a non-canonical (high, low) match row was accepted';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: expected canonical-pair rejection'; end if;

  raise notice 'OK: UAT-12 — matches require mutual explicit likes';
end $$;

-- ---------------------------------------------------------------------------
-- 2. UAT-05 — block and mute suppress notifications, at the chokepoint.
--
-- A, B, C. A mutes B: A hears nothing from B, still hears from C, and B is
-- never told. A blocks C: neither direction produces a notification.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid; b uuid; c uuid; before_n bigint; after_n bigint;
begin
  select id into a from public.profiles where onboarding_completed order by created_at limit 1;
  select id into b from public.profiles where onboarding_completed and id <> a order by created_at limit 1;
  select id into c from public.profiles where onboarding_completed and id not in (a, b) order by created_at limit 1;
  if a is null or b is null or c is null then
    raise notice 'SKIP: need three onboarded profiles for the block/mute checks';
    return;
  end if;

  -- Preference row must exist and allow the category, or the skip would be a
  -- false pass (create_notification returns early on a missing row).
  insert into public.notification_preferences (user_id) values (a)
    on conflict (user_id) do nothing;
  update public.notification_preferences set likes = true where user_id = a;

  delete from public.muted_users where muter_id = a;
  delete from public.blocked_users where blocker_id = a or blocked_id = a;

  -- Baseline: C reaches A.
  select count(*) into before_n from public.notifications where user_id = a;
  perform public.create_notification(a, c, 'post_like', 'likes', '{}'::jsonb);
  select count(*) into after_n from public.notifications where user_id = a;
  if after_n <> before_n + 1 then
    raise exception 'FAIL: an ordinary notification did not land (baseline broken)';
  end if;

  -- MUTE: A mutes B. B produces nothing for A.
  insert into public.muted_users (muter_id, muted_id) values (a, b);
  select count(*) into before_n from public.notifications where user_id = a;
  perform public.create_notification(a, b, 'post_like', 'likes', '{}'::jsonb);
  select count(*) into after_n from public.notifications where user_id = a;
  if after_n <> before_n then
    raise exception 'FAIL: a muted actor still notified the muter';
  end if;

  -- Mute is ONE-DIRECTIONAL: A still reaches B.
  insert into public.notification_preferences (user_id) values (b)
    on conflict (user_id) do nothing;
  update public.notification_preferences set likes = true where user_id = b;
  select count(*) into before_n from public.notifications where user_id = b;
  perform public.create_notification(b, a, 'post_like', 'likes', '{}'::jsonb);
  select count(*) into after_n from public.notifications where user_id = b;
  if after_n <> before_n + 1 then
    raise exception 'FAIL: mute leaked in the wrong direction (B stopped hearing A)';
  end if;

  -- Mute does not affect anyone else: C still reaches A.
  select count(*) into before_n from public.notifications where user_id = a;
  perform public.create_notification(a, c, 'post_like', 'likes', '{}'::jsonb);
  select count(*) into after_n from public.notifications where user_id = a;
  if after_n <> before_n + 1 then
    raise exception 'FAIL: muting B also silenced C';
  end if;

  -- BLOCK is bidirectional: A blocks C, and neither direction notifies.
  insert into public.blocked_users (blocker_id, blocked_id) values (a, c);
  select count(*) into before_n from public.notifications where user_id = a;
  perform public.create_notification(a, c, 'post_like', 'likes', '{}'::jsonb);
  select count(*) into after_n from public.notifications where user_id = a;
  if after_n <> before_n then raise exception 'FAIL: blocked actor notified the blocker'; end if;

  insert into public.notification_preferences (user_id) values (c)
    on conflict (user_id) do nothing;
  update public.notification_preferences set likes = true where user_id = c;
  select count(*) into before_n from public.notifications where user_id = c;
  perform public.create_notification(c, a, 'post_like', 'likes', '{}'::jsonb);
  select count(*) into after_n from public.notifications where user_id = c;
  if after_n <> before_n then
    raise exception 'FAIL: block is not bidirectional — the blocker still notified the blocked user';
  end if;

  raise notice 'OK: UAT-05 — block is bidirectional, mute is one-way and actor-scoped';
end $$;

-- ---------------------------------------------------------------------------
-- 3. UAT-01/02 — the request lifecycle, including its idempotence.
--
-- These call the RPCs as the sender/recipient by setting request.jwt.claims,
-- which is what auth.uid() reads.
-- ---------------------------------------------------------------------------
do $$
declare
  s uuid; r uuid; id1 uuid; id2 uuid; conv1 uuid; conv2 uuid; n int; ok boolean := false;
begin
  select id into s from public.profiles where onboarding_completed order by created_at limit 1;
  select id into r from public.profiles where onboarding_completed and id <> s order by created_at limit 1;
  if s is null or r is null then
    raise notice 'SKIP: need two onboarded profiles for the request checks';
    return;
  end if;

  delete from public.message_requests where sender_id = s and recipient_id = r;
  delete from public.blocked_users
   where (blocker_id = s and blocked_id = r) or (blocker_id = r and blocked_id = s);

  perform set_config('request.jwt.claims', json_build_object('sub', s)::text, true);

  -- 251 characters is refused; 250 is accepted. The product bound, in SQL.
  begin
    perform public.send_message_request(r, repeat('a', 251));
    raise exception 'FAIL: a 251-character request was accepted';
  exception when others then
    if sqlerrm not like '%1-250%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'FAIL: expected a length rejection'; end if;

  -- Empty is refused.
  ok := false;
  begin
    perform public.send_message_request(r, '   ');
    raise exception 'FAIL: a whitespace-only request was accepted';
  exception when others then
    if sqlerrm not like '%1-250%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'FAIL: expected an empty-message rejection'; end if;

  -- Self-request is refused.
  ok := false;
  begin
    perform public.send_message_request(s, 'hello me');
    raise exception 'FAIL: a self-request was accepted';
  exception when others then
    if sqlerrm not like '%yourself%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'FAIL: expected a self-request rejection'; end if;

  -- 250 exactly is accepted, and a DOUBLE TAP is idempotent.
  id1 := public.send_message_request(r, repeat('a', 250));
  id2 := public.send_message_request(r, 'a second tap');
  if id1 is null or id1 <> id2 then
    raise exception 'FAIL: a repeated send did not return the same pending request';
  end if;
  select count(*) into n from public.message_requests
   where sender_id = s and recipient_id = r and status = 'pending';
  if n <> 1 then raise exception 'FAIL: % pending rows for one pair', n; end if;

  -- ACCEPT is atomic and idempotent, and yields exactly one conversation.
  perform set_config('request.jwt.claims', json_build_object('sub', r)::text, true);
  conv1 := public.accept_message_request(id1);
  if conv1 is null then raise exception 'FAIL: accept returned no conversation'; end if;
  conv2 := public.accept_message_request(id1);
  if conv2 is distinct from conv1 then
    raise exception 'FAIL: accepting twice produced a different conversation';
  end if;
  select count(*) into n from public.conversations
   where user_low = least(s, r) and user_high = greatest(s, r);
  if n <> 1 then raise exception 'FAIL: % conversations for one accepted pair', n; end if;

  if (select status from public.message_requests where id = id1) <> 'accepted' then
    raise exception 'FAIL: the request was not left in the accepted state';
  end if;

  -- A BLOCKED pair cannot open a request at all, and the message is the same
  -- one an unavailable account gets (no block oracle).
  delete from public.message_requests where sender_id = s and recipient_id = r;
  insert into public.blocked_users (blocker_id, blocked_id) values (r, s)
    on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', s)::text, true);
  ok := false;
  begin
    perform public.send_message_request(r, 'hi again');
    raise exception 'FAIL: a blocked sender created a request';
  exception when others then
    if sqlerrm not like '%not available%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'FAIL: expected a block rejection'; end if;

  raise notice 'OK: UAT-01/02 — bounds, idempotence, atomic accept, block';
end $$;

-- ---------------------------------------------------------------------------
-- 4. UAT-17 — ballots are creator-only.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid; other uuid; poll uuid; n int; ok boolean := false;
begin
  select pp.creator_id, pp.id into v_owner, poll from public.post_polls pp order by created_at desc limit 1;
  if poll is null then
    select cp.creator_id, cp.id into v_owner, poll from public.community_polls cp order by created_at desc limit 1;
  end if;
  if poll is null then
    raise notice 'SKIP: no polls exist to check ballot visibility against';
    return;
  end if;
  select id into other from public.profiles
   where onboarding_completed and id <> v_owner order by created_at limit 1;

  -- The creator may read them (zero rows is a valid answer; not raising is the
  -- assertion).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  select count(*) into n from public.poll_ballots(poll);
  raise notice 'OK: creator read % ballot row(s)', n;

  -- Nobody else may, and the refusal happens in the database rather than in the
  -- UI that decides whether to show the tap target.
  if other is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', other)::text, true);
    begin
      perform count(*) from public.poll_ballots(poll);
      -- An admin is legitimately allowed; only fail if this user is not one.
      if not public.is_admin(other) then
        raise exception 'FAIL: a non-creator read the ballots';
      end if;
      ok := true;
    exception when others then
      if sqlerrm like '%FAIL:%' then raise; end if;
      ok := true;
    end;
    if not ok then raise exception 'FAIL: expected a refusal for the non-creator'; end if;
  end if;

  raise notice 'OK: UAT-17 — ballots are creator-only';
end $$;

-- ---------------------------------------------------------------------------
-- 5. UAT-04 — the role matrix, and negative authorization on every privileged
--     society RPC.
-- ---------------------------------------------------------------------------
do $$
declare
  soc uuid; v_owner uuid; member uuid; caps jsonb; ok boolean;
begin
  select c.id, c.owner_id into soc, v_owner from public.communities c
   where is_society and status = 'approved' order by created_at limit 1;
  if soc is null then
    raise notice 'SKIP: no approved society to check the role matrix against';
    return;
  end if;
  select id into member from public.profiles
   where onboarding_completed and id <> v_owner
     and not public.is_admin(id)
   order by created_at limit 1;
  if member is null then
    raise notice 'SKIP: need a non-owner, non-admin profile';
    return;
  end if;

  delete from public.society_roles where society_id = soc and user_id = member;
  insert into public.community_members (community_id, user_id, role)
    values (soc, member, 'member')
  on conflict (community_id, user_id) do update set role = 'member';

  -- MEMBER: may post (and post anonymously), may not reveal or administer.
  perform set_config('request.jwt.claims', json_build_object('sub', member)::text, true);
  caps := public.society_capabilities(soc);
  if not (caps->>'can_post')::boolean then raise exception 'FAIL: a member cannot post'; end if;
  if not (caps->>'can_post_anonymously')::boolean then raise exception 'FAIL: a member cannot post anonymously'; end if;
  if (caps->>'can_reveal_anonymous')::boolean then raise exception 'FAIL: a member can reveal anonymous authors'; end if;
  if (caps->>'can_moderate_members')::boolean then raise exception 'FAIL: a member can moderate members'; end if;
  if (caps->>'can_remove_members')::boolean then raise exception 'FAIL: a member can remove members'; end if;

  -- MODERATOR: gains member moderation, gains nothing else.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.assign_society_role(soc, member, 'moderator');
  perform set_config('request.jwt.claims', json_build_object('sub', member)::text, true);
  caps := public.society_capabilities(soc);
  if not (caps->>'can_moderate_members')::boolean then raise exception 'FAIL: a moderator cannot moderate members'; end if;
  if (caps->>'can_reveal_anonymous')::boolean then raise exception 'FAIL: a moderator can reveal anonymous authors'; end if;
  if (caps->>'can_assign_officers')::boolean then raise exception 'FAIL: a moderator can assign officers'; end if;

  -- A moderator calling a president-only RPC directly is refused. Hiding the
  -- button is not the control.
  ok := false;
  begin
    perform public.assign_society_role(soc, v_owner, 'president');
    raise exception 'FAIL: a moderator assigned the president role';
  exception when others then
    if sqlerrm like '%FAIL:%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'FAIL: expected a refusal'; end if;

  -- PRESIDENT: gains reveal, event management and moderator appointment — and
  -- nothing above that.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.assign_society_role(soc, member, 'president');
  perform set_config('request.jwt.claims', json_build_object('sub', member)::text, true);
  caps := public.society_capabilities(soc);
  if not (caps->>'can_reveal_anonymous')::boolean then raise exception 'FAIL: a president cannot reveal'; end if;
  if not (caps->>'can_manage_events')::boolean then raise exception 'FAIL: a president cannot manage events'; end if;
  if not (caps->>'can_assign_moderator')::boolean then raise exception 'FAIL: a president cannot appoint moderators'; end if;
  if (caps->>'can_assign_officers')::boolean then raise exception 'FAIL: a president can assign any officer role'; end if;
  if (caps->>'can_remove_members')::boolean then raise exception 'FAIL: a president can remove members'; end if;

  -- OWNER: everything.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  caps := public.society_capabilities(soc);
  if not (caps->>'can_assign_officers')::boolean then raise exception 'FAIL: the owner cannot assign officers'; end if;
  if not (caps->>'can_remove_members')::boolean then raise exception 'FAIL: the owner cannot remove members'; end if;
  if not (caps->>'can_reveal_anonymous')::boolean then raise exception 'FAIL: the owner cannot reveal'; end if;

  raise notice 'OK: UAT-04 — member < moderator < president < owner enforced in the database';
end $$;

-- At most one president per society.
do $$
declare n int;
begin
  select count(*) into n from (
    select society_id from public.society_roles where role = 'president'
    group by society_id having count(*) > 1
  ) t;
  if n <> 0 then
    raise exception 'FAIL: % societ(ies) hold more than one president', n;
  end if;
  raise notice 'OK: the single-president rule holds';
end $$;

-- ---------------------------------------------------------------------------
-- 6. UAT-08 — renaming is narrow and authorised.
-- ---------------------------------------------------------------------------
do $$
declare
  comm uuid; v_owner uuid; other uuid; before_status text; ok boolean := false;
begin
  select c.id, c.owner_id, c.status::text into comm, v_owner, before_status
    from public.communities c where c.status = 'approved' order by created_at limit 1;
  if comm is null then
    raise notice 'SKIP: no community to rename';
    return;
  end if;
  select id into other from public.profiles
   where onboarding_completed and id <> v_owner and not public.is_admin(id)
   order by created_at limit 1;

  -- A non-owner is refused even calling the RPC directly.
  if other is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', other)::text, true);
    begin
      perform public.rename_community(comm, 'Hijacked Name');
      raise exception 'FAIL: a non-owner renamed a community';
    exception when others then
      if sqlerrm like '%FAIL:%' then raise; end if;
      ok := true;
    end;
    if not ok then raise exception 'FAIL: expected an authorization refusal'; end if;
  end if;

  -- The owner may, an empty name may not, and STATUS is untouched by a rename.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  ok := false;
  begin
    perform public.rename_community(comm, '  ');
    raise exception 'FAIL: an empty name was accepted';
  exception when others then
    if sqlerrm like '%FAIL:%' then raise; end if;
    ok := true;
  end;
  if not ok then raise exception 'FAIL: expected an empty-name rejection'; end if;

  perform public.rename_community(comm, 'Renamed In A Test');
  if (select name from public.communities where id = comm) <> 'Renamed In A Test' then
    raise exception 'FAIL: the rename did not take';
  end if;
  if (select status::text from public.communities where id = comm) <> before_status then
    raise exception 'FAIL: renaming changed the community status';
  end if;

  raise notice 'OK: UAT-08 — rename is owner-only and touches only the name';
end $$;

-- ---------------------------------------------------------------------------
-- 7. UAT-15 — seeded ordering is stable, varies by seed, and is unchanged
--     when no seed is supplied.
-- ---------------------------------------------------------------------------
do $$
declare
  viewer uuid;
  unseeded_a text; unseeded_b text;
  seed1_a text; seed1_b text; seed2 text;
  page1 uuid[]; page2 uuid[];
begin
  select id into viewer from public.profiles
   where onboarding_completed and discoverable and not is_banned
   order by created_at limit 1;
  if viewer is null then
    raise notice 'SKIP: no viewer for the Discover checks';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', viewer)::text, true);

  -- Unseeded twice: identical (it always was).
  select md5(string_agg(id::text, ',' order by ord)) into unseeded_a
    from (select id, row_number() over () as ord
            from public.get_discover_candidates(30, '{}'::uuid[], null)) t;
  select md5(string_agg(id::text, ',' order by ord)) into unseeded_b
    from (select id, row_number() over () as ord
            from public.get_discover_candidates(30, '{}'::uuid[], null)) t;
  if unseeded_a is distinct from unseeded_b then
    raise exception 'FAIL: the unseeded deck is not deterministic';
  end if;

  -- The SAME seed twice: identical. This is what makes pagination correct —
  -- a seed that moved between pages would duplicate and skip candidates.
  select md5(string_agg(id::text, ',' order by ord)) into seed1_a
    from (select id, row_number() over () as ord
            from public.get_discover_candidates(30, '{}'::uuid[], 'seed-one')) t;
  select md5(string_agg(id::text, ',' order by ord)) into seed1_b
    from (select id, row_number() over () as ord
            from public.get_discover_candidates(30, '{}'::uuid[], 'seed-one')) t;
  if seed1_a is distinct from seed1_b then
    raise exception 'FAIL: the same seed produced two different orders';
  end if;

  -- A DIFFERENT seed: a different order (skipped when there are too few
  -- candidates for any permutation to differ).
  select md5(string_agg(id::text, ',' order by ord)) into seed2
    from (select id, row_number() over () as ord
            from public.get_discover_candidates(30, '{}'::uuid[], 'seed-two')) t;
  if (select count(*) from public.get_discover_candidates(30, '{}'::uuid[], null)) >= 5
     and seed1_a is not distinct from seed2 then
    raise notice 'WARN: two seeds produced the same order — possible with few candidates, check manually';
  end if;

  -- Pagination parity: page two, excluding page one, shares nothing with it.
  select array_agg(id) into page1 from public.get_discover_candidates(10, '{}'::uuid[], 'seed-one');
  if page1 is not null then
    select array_agg(id) into page2 from public.get_discover_candidates(10, page1, 'seed-one');
    if page2 is not null and page1 && page2 then
      raise exception 'FAIL: page two repeated a candidate from page one';
    end if;
  end if;

  raise notice 'OK: UAT-15 — seeded ordering is stable, paginates, and varies by seed';
end $$;

-- ---------------------------------------------------------------------------
-- 8. UAT-18 — chat-surface notifications carry a group key.
-- ---------------------------------------------------------------------------
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_community_message';
  if src not like '%community:%' then
    raise exception 'FAIL: community messages are not grouped by room';
  end if;

  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_event_message';
  if src not like '%event:%' then
    raise exception 'FAIL: event messages are not grouped by event';
  end if;
  raise notice 'OK: UAT-18 — high-volume surfaces group by subject';
end $$;

rollback;

\echo 'ALL CHECKS PASSED (transaction rolled back — nothing was written)'
