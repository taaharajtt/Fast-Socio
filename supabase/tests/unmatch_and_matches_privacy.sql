-- =============================================================================
-- Verification for migration 0182 — "Hide my matches", the authorised
-- second-degree list, and unmatch_user().
--
-- Run against a database that already has 0182 applied. Everything happens
-- inside a transaction that is ROLLED BACK, so it writes nothing permanent —
-- but it does exercise real inserts, triggers and RLS, so run it on dev first.
--
--   psql "$DB_URL" -f supabase/tests/unmatch_and_matches_privacy.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition. A silent run is NOT a pass.
--
-- WHY THE FUNCTIONS ARE EXECUTED, NOT JUST COUNTED. `check_function_bodies` is
-- off in every migration in this repo, so a function referring to a column that
-- does not exist is created happily and only fails when called. Existence
-- checks alone have missed exactly that before (0143). Every guard below is
-- actually invoked.
--
-- Impersonation is the same trick uat18_verification.sql uses: set
-- `request.jwt.claims`, which is what auth.uid() reads. Where RLS itself is
-- under test the role is switched to `authenticated` as well, because policies
-- do not apply to a superuser.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structure
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'show_matches'
  ) then
    raise exception 'FAIL: profiles.show_matches is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'conversations'
       and column_name = 'closed_at'
  ) then
    raise exception 'FAIL: conversations.closed_at is missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'unmatch_user'
  ) then
    raise exception 'FAIL: unmatch_user() is missing';
  end if;

  -- The column must default OPEN, or deploying this migration silently hides
  -- every existing user's matches from their matches.
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'show_matches') not like 'true%' then
    raise exception 'FAIL: show_matches does not default to true';
  end if;

  raise notice 'OK: schema and functions present, show_matches defaults open';
end $$;

-- anon must not be able to call either RPC.
do $$
declare fn text;
begin
  foreach fn in array array['unmatch_user(uuid)', 'get_matches_of(uuid)'] loop
    if has_function_privilege('anon', 'public.' || fn, 'execute') then
      raise exception 'FAIL: anon holds EXECUTE on %', fn;
    end if;
    if not has_function_privilege('authenticated', 'public.' || fn, 'execute') then
      raise exception 'FAIL: authenticated lacks EXECUTE on %', fn;
    end if;
  end loop;
  raise notice 'OK: grants are authenticated-only';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Fixtures: four live accounts. A↔B matched, B↔C matched, D matched with
--    nobody. Any pre-existing relationship between them is cleared first so the
--    assertions below describe only what this script created.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid; b uuid; c uuid; d uuid;
  ids uuid[];
  conv uuid;
  n int;
  aura_before int;
  ok boolean;
begin
  -- UNINVOLVED accounts only. An earlier version took the first four profiles
  -- and deleted whatever relationships they had, which on a real database meant
  -- deleting a live conversation — and `dm_report_evidence_immutable` (mig
  -- 0161) correctly refuses to let a filed DM report's evidence be unlinked.
  -- The fixture must not need to destroy anything: pick accounts that are in no
  -- match, no conversation, no message request and no block to begin with.
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned, false) = false
       and not exists (select 1 from public.matches m
                        where m.user_low = p.id or m.user_high = p.id)
       and not exists (select 1 from public.conversations c
                        where c.user_low = p.id or c.user_high = p.id)
       and not exists (select 1 from public.message_requests r
                        where r.sender_id = p.id or r.recipient_id = p.id)
       and not exists (select 1 from public.blocked_users b
                        where b.blocker_id = p.id or b.blocked_id = p.id)
       and not exists (select 1 from public.swipes s
                        where s.swiper_id = p.id or s.target_id = p.id)
     order by p.created_at
     limit 4
  ) s;
  if coalesce(array_length(ids, 1), 0) < 4 then
    raise exception 'need 4 profiles with no existing match/chat/request/block to run this verification';
  end if;
  a := ids[1]; b := ids[2]; c := ids[3]; d := ids[4];

  update public.profiles set show_matches = true where id in (a, b, c, d);

  -- Matches are created the only way they can be: two explicit likes (0178's
  -- trigger rejects anything else).
  insert into public.swipes (swiper_id, target_id, direction) values
    (a, b, 'like'), (b, a, 'like'),
    (b, c, 'like'), (c, b, 'like');

  if not exists (select 1 from public.matches
                  where user_low = least(a, b) and user_high = greatest(a, b)) then
    raise exception 'FAIL: fixture A-B match was not created';
  end if;

  -- -------------------------------------------------------------------------
  -- 2. get_matches_of — the one hop, the owner's preference, the stranger.
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);

  select count(*) into n from public.get_matches_of(b);
  if n <> 1 then
    raise exception 'FAIL: A should see B''s one other match (C), got %', n;
  end if;
  if not exists (select 1 from public.get_matches_of(b) g where g.id = c) then
    raise exception 'FAIL: C is missing from B''s list as seen by A';
  end if;

  -- The list must never carry a percentage between two other people.
  if (select pg_get_function_result(p.oid)
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'get_matches_of')
     like '%percentage%' then
    raise exception 'FAIL: get_matches_of exposes a match percentage';
  end if;

  -- Owner hides the list: even a current match gets nothing.
  update public.profiles set show_matches = false where id = b;
  select count(*) into n from public.get_matches_of(b);
  if n <> 0 then
    raise exception 'FAIL: hidden list still returned % rows to a match', n;
  end if;

  -- ...and the owner still sees their own, which is the whole point.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  select count(*) into n from public.get_my_matches();
  if n <> 2 then
    raise exception 'FAIL: owner sees % of their own 2 matches while hidden', n;
  end if;

  update public.profiles set show_matches = true where id = b;

  -- A stranger gets nothing even when the list is public.
  perform set_config('request.jwt.claims', json_build_object('sub', d)::text, true);
  select count(*) into n from public.get_matches_of(b);
  if n <> 0 then
    raise exception 'FAIL: a non-match retrieved % rows of B''s list', n;
  end if;

  -- An unauthenticated caller gets nothing (auth.uid() is null).
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.get_matches_of(b);
  if n <> 0 then
    raise exception 'FAIL: an anonymous caller retrieved % rows', n;
  end if;

  -- A block ends the view even while the match row still exists.
  insert into public.blocked_users (blocker_id, blocked_id) values (b, a);
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  select count(*) into n from public.get_matches_of(b);
  if n <> 0 then
    raise exception 'FAIL: a blocked viewer retrieved % rows', n;
  end if;
  delete from public.blocked_users where blocker_id = b and blocked_id = a;

  raise notice 'OK: get_matches_of honours the hop, the preference, blocks and auth';

  -- -------------------------------------------------------------------------
  -- 3. Fixture state around the A-B pair, then unmatch.
  -- -------------------------------------------------------------------------
  insert into public.conversations (user_low, user_high)
    values (least(a, b), greatest(a, b))
  returning id into conv;

  insert into public.messages (conversation_id, sender_id, body)
    values (conv, a, 'before the unmatch');

  insert into public.message_requests (sender_id, recipient_id, message, status)
    values (b, a, 'let us talk', 'accepted');

  insert into public.notifications (user_id, actor_id, type, data)
    values (a, b, 'match', jsonb_build_object('user_id', b)),
           (b, a, 'match', jsonb_build_object('user_id', a));

  select count(*) into aura_before
    from public.aura_transactions
   where user_id in (a, b) and reason = 'match';

  -- A forged call cannot touch a relationship the caller is not in: the only
  -- parameter is the other party, and D is matched with nobody.
  perform set_config('request.jwt.claims', json_build_object('sub', d)::text, true);
  select public.unmatch_user(b) into ok;
  if ok then
    raise exception 'FAIL: a stranger''s unmatch reported success';
  end if;
  if not exists (select 1 from public.matches
                  where user_low = least(a, b) and user_high = greatest(a, b)) then
    raise exception 'FAIL: a stranger''s unmatch destroyed the A-B match';
  end if;

  -- The real thing.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  select public.unmatch_user(b) into ok;
  if not ok then
    raise exception 'FAIL: unmatch_user reported no match to end';
  end if;

  if exists (select 1 from public.matches
              where user_low = least(a, b) and user_high = greatest(a, b)) then
    raise exception 'FAIL: the match row survived the unmatch';
  end if;

  if exists (select 1 from public.swipes
              where (swiper_id = a and target_id = b)
                 or (swiper_id = b and target_id = a)) then
    raise exception 'FAIL: swipes survived — Discover would still exclude the pair';
  end if;

  if (select closed_at from public.conversations where id = conv) is null then
    raise exception 'FAIL: the conversation was not closed';
  end if;

  -- History is retained: deleting it would take DM report evidence with it.
  if not exists (select 1 from public.messages where conversation_id = conv) then
    raise exception 'FAIL: message history was destroyed by the unmatch';
  end if;

  if exists (
    select 1 from public.message_requests
     where status in ('pending', 'accepted')
       and ((sender_id = a and recipient_id = b) or (sender_id = b and recipient_id = a))
  ) then
    raise exception 'FAIL: an accepted request survived as a second key to chat';
  end if;

  if exists (
    select 1 from public.notifications
     where type = 'match'
       and ((user_id = a and actor_id = b) or (user_id = b and actor_id = a))
  ) then
    raise exception 'FAIL: stale match notifications survived';
  end if;

  if (select count(*) from public.aura_transactions
       where user_id in (a, b) and reason = 'match') <> aura_before then
    raise exception 'FAIL: the Aura ledger was rewritten by the unmatch';
  end if;

  -- Idempotent.
  select public.unmatch_user(b) into ok;
  if ok then
    raise exception 'FAIL: a second unmatch reported success';
  end if;

  -- A former match can no longer read their list either.
  select count(*) into n from public.get_matches_of(b);
  if n <> 0 then
    raise exception 'FAIL: a former match still reads the list (% rows)', n;
  end if;

  raise notice 'OK: unmatch_user is complete, forged-call-safe and idempotent';

  -- -------------------------------------------------------------------------
  -- 4. The closed channel really is closed.
  -- -------------------------------------------------------------------------
  begin
    perform public.get_or_create_conversation(b);
    raise exception 'FAIL: get_or_create_conversation reopened a closed channel';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAIL:%' then raise; end if;
      -- 'not connected' — the expected refusal.
  end;

  -- A stale reciprocal like must not instantly re-form the match.
  insert into public.swipes (swiper_id, target_id, direction) values (a, b, 'like');
  if exists (select 1 from public.matches
              where user_low = least(a, b) and user_high = greatest(a, b)) then
    raise exception 'FAIL: the match re-formed from a single like';
  end if;

  -- Both sides liking again is a NEW match, and it reopens the channel.
  insert into public.swipes (swiper_id, target_id, direction) values (b, a, 'like');
  if not exists (select 1 from public.matches
                  where user_low = least(a, b) and user_high = greatest(a, b)) then
    raise exception 'FAIL: a fresh mutual like did not re-create the match';
  end if;
  if (select closed_at from public.conversations where id = conv) is not null then
    raise exception 'FAIL: re-matching did not reopen the conversation';
  end if;

  raise notice 'OK: closed channel refuses, no instant re-match, re-match reopens';
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS: a closed conversation takes no new message, whoever asks.
--    Policies do not apply to a superuser, so this half runs as `authenticated`.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid; b uuid;
  conv uuid;
  ids uuid[];
begin
  -- The same pair section 1 used, found the same way (its fixtures were rolled
  -- back with that block, so this re-creates what it needs).
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned, false) = false
       and not exists (select 1 from public.matches m
                        where m.user_low = p.id or m.user_high = p.id)
       and not exists (select 1 from public.conversations c
                        where c.user_low = p.id or c.user_high = p.id)
       and not exists (select 1 from public.message_requests r
                        where r.sender_id = p.id or r.recipient_id = p.id)
       and not exists (select 1 from public.blocked_users b
                        where b.blocker_id = p.id or b.blocked_id = p.id)
       and not exists (select 1 from public.swipes s
                        where s.swiper_id = p.id or s.target_id = p.id)
     order by p.created_at limit 2
  ) s;
  if coalesce(array_length(ids, 1), 0) < 2 then
    raise exception 'need 2 uninvolved profiles for the RLS section';
  end if;
  a := ids[1]; b := ids[2];

  insert into public.conversations (user_low, user_high)
    values (least(a, b), greatest(a, b))
  on conflict (user_low, user_high) do nothing;

  select id into conv from public.conversations
   where user_low = least(a, b) and user_high = greatest(a, b);
  update public.conversations
     set closed_at = now(), closed_reason = 'unmatched'
   where id = conv;

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.messages (conversation_id, sender_id, body)
      values (conv, a, 'after the unmatch');
    execute 'set local role postgres';
    raise exception 'FAIL: RLS allowed a message into a closed conversation';
  exception
    when insufficient_privilege then
      execute 'set local role postgres';
      raise notice 'OK: RLS refuses a message in a closed conversation';
  end;

  -- ...and still accepts one once the conversation is open again.
  update public.conversations set closed_at = null, closed_reason = null
   where id = conv;
  execute 'set local role authenticated';
  insert into public.messages (conversation_id, sender_id, body)
    values (conv, a, 'after re-matching');
  execute 'set local role postgres';
  raise notice 'OK: an open conversation still accepts messages';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
