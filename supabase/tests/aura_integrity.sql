-- =============================================================================
-- Verification for migrations 0186–0188 — Aura anti-farming.
--
-- Run against a database that already has 0186, 0187 and 0188 applied, IN THAT
-- ORDER. Everything happens inside a transaction that is ROLLED BACK.
--
--   psql "$DB_URL" -f supabase/tests/aura_integrity.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition. A silent run is NOT a pass.
--
-- THE ONE INVARIANT EVERY SECTION IS REALLY TESTING: no loop of create/delete,
-- match/unmatch, RSVP/withdraw, select/reselect or retry leaves a user richer
-- than doing the thing once. Each section ends by asserting the net.
--
-- Fixtures only ADD, and select accounts with no existing posts, comments,
-- matches or event history so the arithmetic describes only what is created
-- here.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structure and permissions.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='aura_grants') then
    raise exception 'FAIL: aura_grants is missing';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname='public' and tablename='aura_grants'
      and indexdef like '%UNIQUE%' and indexdef like '%source_key%'
      and indexdef like '%reversed_at IS NULL%'
  ) then
    raise exception 'FAIL: the one-active-grant-per-source index is missing';
  end if;

  -- Clients must not reach the register, the ledger writers, or any award path.
  if has_table_privilege('authenticated','public.aura_grants','select')
     or has_table_privilege('authenticated','public.aura_grants','insert')
     or has_table_privilege('authenticated','public.aura_grants','update')
     or has_table_privilege('authenticated','public.aura_grants','delete') then
    raise exception 'FAIL: authenticated can reach aura_grants';
  end if;
  if has_table_privilege('authenticated','public.aura_transactions','insert')
     or has_table_privilege('authenticated','public.aura_transactions','update')
     or has_table_privilege('authenticated','public.aura_transactions','delete') then
    raise exception 'FAIL: authenticated can write the ledger';
  end if;
  foreach fn in array array[
    'aura_award(uuid, integer, public.aura_reason, text, text, jsonb)',
    'aura_reverse(text, jsonb)',
    'recompute_xp_for(uuid)',
    'reconcile_achievements(uuid)',
    'check_achievements(uuid)'
  ] loop
    if has_function_privilege('authenticated', 'public.' || fn, 'execute') then
      raise exception 'FAIL: authenticated can execute %', fn;
    end if;
  end loop;

  raise notice 'OK: register exists, uniqueness enforced, no client access';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Posts, comments, and the create/delete loop.
-- ---------------------------------------------------------------------------
do $$
declare
  author uuid; alice uuid; bob uuid;
  ids uuid[];
  p1 uuid; p2 uuid; c1 uuid; c2 uuid;
  base int; v int; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false)=false
       and not exists (select 1 from public.posts x where x.author_id = p.id)
       and not exists (select 1 from public.post_comments x where x.author_id = p.id)
     order by p.created_at limit 3
  ) s;
  if coalesce(array_length(ids,1),0) < 3 then
    raise exception 'need 3 profiles with no post/comment history';
  end if;
  author := ids[1]; alice := ids[2]; bob := ids[3];

  select coalesce(aura_score,0) into base from public.profiles where id = author;

  -- create awards once
  insert into public.posts (author_id, body, is_anonymous)
    values (author, 'aura fixture 1', false) returning id into p1;
  select coalesce(aura_score,0) into v from public.profiles where id = author;
  if v <> base + 2 then
    raise exception 'FAIL: post create awarded % (want +2)', v - base;
  end if;
  if (select count(*) from public.aura_grants
       where source_key = 'post:' || p1::text and reversed_at is null) <> 1 then
    raise exception 'FAIL: post grant not active';
  end if;

  -- anonymous posts earn nothing
  insert into public.posts (author_id, body, is_anonymous)
    values (author, 'anonymous fixture', true) returning id into p2;
  select coalesce(aura_score,0) into v from public.profiles where id = author;
  if v <> base + 2 then
    raise exception 'FAIL: an anonymous post earned Aura';
  end if;

  -- two commenters: +2 each, once
  insert into public.post_comments (post_id, author_id, body)
    values (p1, alice, 'one') returning id into c1;
  insert into public.post_comments (post_id, author_id, body)
    values (p1, alice, 'two');
  insert into public.post_comments (post_id, author_id, body)
    values (p1, bob, 'three') returning id into c2;
  -- self-comment earns nothing
  insert into public.post_comments (post_id, author_id, body)
    values (p1, author, 'mine');

  select coalesce(aura_score,0) into v from public.profiles where id = author;
  if v <> base + 2 + 4 then
    raise exception 'FAIL: two commenters gave % (want +4)', v - base - 2;
  end if;

  -- 100 comments by one person add nothing further
  for n in 1..20 loop
    insert into public.post_comments (post_id, author_id, body)
      values (p1, alice, 'spam ' || n);
  end loop;
  select coalesce(aura_score,0) into v from public.profiles where id = author;
  if v <> base + 6 then
    raise exception 'FAIL: repeat comments earned more (%)', v - base;
  end if;

  -- THE HOLE 0181 LEFT: deleting the post must reverse the post reward AND
  -- every active comment reward.
  delete from public.posts where id = p1;
  select coalesce(aura_score,0) into v from public.profiles where id = author;
  if v <> base then
    raise exception 'FAIL: deleting the post left % unsupported Aura', v - base;
  end if;
  if exists (select 1 from public.aura_grants
              where source_key like 'comment:' || p1::text || ':%' and reversed_at is null) then
    raise exception 'FAIL: comment grants survived the post deletion';
  end if;

  -- create/delete loop nets to zero, however many laps
  for n in 1..5 loop
    insert into public.posts (author_id, body, is_anonymous)
      values (author, 'loop ' || n, false) returning id into p1;
    delete from public.posts where id = p1;
  end loop;
  select coalesce(aura_score,0) into v from public.profiles where id = author;
  if v <> base then
    raise exception 'FAIL: a create/delete loop netted % Aura', v - base;
  end if;

  raise notice 'OK: posts + comments award once, reverse once, loop to zero';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Match / unmatch / rematch.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid; b uuid; ids uuid[];
  base_a int; base_b int; v_a int; v_b int; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false)=false
       and not exists (select 1 from public.swipes s
                        where s.swiper_id = p.id or s.target_id = p.id)
       and not exists (select 1 from public.matches m
                        where m.user_low = p.id or m.user_high = p.id)
     order by p.created_at limit 2
  ) s;
  if coalesce(array_length(ids,1),0) < 2 then
    raise exception 'need 2 profiles with no swipe/match history';
  end if;
  a := ids[1]; b := ids[2];

  select coalesce(aura_score,0) into base_a from public.profiles where id = a;
  select coalesce(aura_score,0) into base_b from public.profiles where id = b;

  for n in 1..3 loop
    insert into public.swipes (swiper_id, target_id, direction) values (a, b, 'like')
      on conflict (swiper_id, target_id) do update set direction = 'like';
    insert into public.swipes (swiper_id, target_id, direction) values (b, a, 'like')
      on conflict (swiper_id, target_id) do update set direction = 'like';

    select coalesce(aura_score,0) into v_a from public.profiles where id = a;
    select coalesce(aura_score,0) into v_b from public.profiles where id = b;
    if v_a <> base_a + 10 or v_b <> base_b + 10 then
      raise exception 'FAIL: lap % match paid a=% b=%', n, v_a - base_a, v_b - base_b;
    end if;

    -- exactly one active grant per side
    if (select count(*) from public.aura_grants
         where source_key like 'match:%' and reversed_at is null
           and user_id in (a, b)) <> 2 then
      raise exception 'FAIL: lap % has the wrong number of active match grants', n;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
    perform public.unmatch_user(b);

    select coalesce(aura_score,0) into v_a from public.profiles where id = a;
    select coalesce(aura_score,0) into v_b from public.profiles where id = b;
    if v_a <> base_a or v_b <> base_b then
      raise exception 'FAIL: lap % unmatch left a=% b=%', n, v_a - base_a, v_b - base_b;
    end if;
  end loop;

  raise notice 'OK: match/unmatch/rematch cycles net to zero, three laps';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Events — RSVP pays nothing, verified check-in pays 20 once.
-- ---------------------------------------------------------------------------
do $$
declare
  host uuid; goer uuid; ids uuid[];
  ev uuid; code uuid; base int; v int; r record;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false)=false
       and not exists (select 1 from public.event_attendees a where a.user_id = p.id)
     order by p.created_at limit 2
  ) s;
  host := ids[1]; goer := ids[2];

  perform set_config('app.event_moderation','1',true);
  insert into public.events (host_id, title, starts_at, status)
    values (host, 'Aura fixture event', now() + interval '1 day', 'approved')
    returning id into ev;
  perform set_config('app.event_moderation','0',true);

  select coalesce(aura_score,0) into base from public.profiles where id = goer;

  -- RSVP alone pays nothing now.
  insert into public.event_attendees (event_id, user_id) values (ev, goer);
  select coalesce(aura_score,0) into v from public.profiles where id = goer;
  if v <> base then
    raise exception 'FAIL: an RSVP paid % Aura', v - base;
  end if;

  -- Withdrawal before check-in: nothing out, nothing back.
  delete from public.event_attendees where event_id = ev and user_id = goer;
  select coalesce(aura_score,0) into v from public.profiles where id = goer;
  if v <> base then
    raise exception 'FAIL: withdrawal moved % Aura', v - base;
  end if;

  -- Check in for real.
  insert into public.event_attendees (event_id, user_id) values (ev, goer);
  select check_in_code into code from public.event_attendees
   where event_id = ev and user_id = goer;

  perform set_config('request.jwt.claims', json_build_object('sub', host)::text, true);
  for r in select * from public.check_in_attendee(ev, code) loop
    if r.result <> 'checked_in' then
      raise exception 'FAIL: check-in returned %', r.result;
    end if;
  end loop;

  select coalesce(aura_score,0) into v from public.profiles where id = goer;
  if v <> base + 20 then
    raise exception 'FAIL: check-in paid % (want +20)', v - base;
  end if;

  -- Repeated check-in pays nothing more, and neither does a direct re-award.
  for r in select * from public.check_in_attendee(ev, code) loop null; end loop;
  perform public.aura_award(goer, 20, 'event_attend', 'event_checkin',
    'event-checkin:' || ev::text || ':' || goer::text, '{}'::jsonb);
  select coalesce(aura_score,0) into v from public.profiles where id = goer;
  if v <> base + 20 then
    raise exception 'FAIL: repeated check-in paid again (now %)', v - base;
  end if;

  -- Withdrawing AFTER attendance keeps the credit, and the evidence survives.
  delete from public.event_attendees where event_id = ev and user_id = goer;
  select coalesce(aura_score,0) into v from public.profiles where id = goer;
  if v <> base + 20 then
    raise exception 'FAIL: verified attendance was lost on withdrawal (%)', v - base;
  end if;
  if not exists (select 1 from public.event_checkins
                  where event_id = ev and user_id = goer) then
    raise exception 'FAIL: check-in evidence disappeared with the RSVP';
  end if;

  -- ...and even deleting the EVENT leaves the evidence that justifies it.
  delete from public.events where id = ev;
  if not exists (select 1 from public.event_checkins
                  where event_id = ev and user_id = goer) then
    raise exception 'FAIL: check-in evidence was destroyed with the event';
  end if;

  raise notice 'OK: RSVP pays nothing, check-in pays 20 once, evidence survives';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Help — one active reward per REQUEST, transferable.
-- ---------------------------------------------------------------------------
do $$
declare
  owner uuid; h1 uuid; h2 uuid; ids uuid[];
  req uuid; r1 uuid; r2 uuid; rs uuid;
  b1 int; b2 int; v1 int; v2 int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false)=false
     order by p.created_at limit 3
  ) s;
  owner := ids[1]; h1 := ids[2]; h2 := ids[3];

  insert into public.help_requests (author_id, title, body, category)
    values (owner, 'Aura fixture help', 'body', 'other') returning id into req;
  insert into public.help_responses (request_id, author_id, body)
    values (req, h1, 'me') returning id into r1;
  insert into public.help_responses (request_id, author_id, body)
    values (req, h2, 'no me') returning id into r2;
  insert into public.help_responses (request_id, author_id, body)
    values (req, owner, 'myself') returning id into rs;

  select coalesce(aura_score,0) into b1 from public.profiles where id = h1;
  select coalesce(aura_score,0) into b2 from public.profiles where id = h2;

  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);

  perform public.select_help_response(r1);
  select coalesce(aura_score,0) into v1 from public.profiles where id = h1;
  if v1 <> b1 + 15 then
    raise exception 'FAIL: selection paid % (want +15)', v1 - b1;
  end if;

  -- Selecting the SAME response again is a no-op in net terms.
  perform public.select_help_response(r1);
  select coalesce(aura_score,0) into v1 from public.profiles where id = h1;
  if v1 <> b1 + 15 then
    raise exception 'FAIL: reselecting the same helper changed the total (%)', v1 - b1;
  end if;

  -- THE 0110 EXPLOIT: selecting the other response must TRANSFER, not add.
  perform public.select_help_response(r2);
  select coalesce(aura_score,0) into v1 from public.profiles where id = h1;
  select coalesce(aura_score,0) into v2 from public.profiles where id = h2;
  if v1 <> b1 then
    raise exception 'FAIL: the previous helper kept the reward (%)', v1 - b1;
  end if;
  if v2 <> b2 + 15 then
    raise exception 'FAIL: the new helper got % (want +15)', v2 - b2;
  end if;
  if (select count(*) from public.aura_grants
       where source_key = 'help:' || req::text and reversed_at is null) <> 1 then
    raise exception 'FAIL: the request has more than one active reward';
  end if;

  -- The author cannot pay themselves.
  perform public.select_help_response(rs);
  if (select count(*) from public.aura_grants
       where source_key = 'help:' || req::text and reversed_at is null) <> 0 then
    raise exception 'FAIL: a self-selected response holds a reward';
  end if;

  -- Reopening withdraws it; deleting the request cannot leave one behind.
  perform public.select_help_response(r1);
  perform public.reopen_help_request(req);
  select coalesce(aura_score,0) into v1 from public.profiles where id = h1;
  if v1 <> b1 then
    raise exception 'FAIL: reopening left % Aura', v1 - b1;
  end if;

  perform public.select_help_response(r1);
  delete from public.help_requests where id = req;
  select coalesce(aura_score,0) into v1 from public.profiles where id = h1;
  if v1 <> b1 then
    raise exception 'FAIL: deleting the request left % Aura', v1 - b1;
  end if;

  raise notice 'OK: one reward per request, transfers, no self-reward, reopen/delete clean';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Profile completion — the race, and XP.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; base int; v int; n int;
begin
  select id into me from public.profiles
   where deactivated_at is null and coalesce(is_banned,false)=false
     and not exists (select 1 from public.aura_transactions t
                      where t.user_id = profiles.id and t.reason='profile_completed')
   order by created_at limit 1;
  if me is null then
    raise notice 'SKIP: no profile without an existing completion bonus';
    return;
  end if;

  select coalesce(aura_score,0) into base from public.profiles where id = me;
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);

  for n in 1..5 loop
    perform public.award_completion_bonus();
  end loop;

  select coalesce(aura_score,0) into v from public.profiles where id = me;
  if v <> base and v <> base + 25 then
    raise exception 'FAIL: five completion calls moved % Aura', v - base;
  end if;
  if (select count(*) from public.aura_grants
       where source_key = 'profile-completed:' || me::text and reversed_at is null) > 1 then
    raise exception 'FAIL: more than one active completion grant';
  end if;

  raise notice 'OK: completion bonus is paid at most once';
end $$;

-- ---------------------------------------------------------------------------
-- 6. XP cannot be laundered, and the caches agree with their sources.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; base_xp int; v_xp int; p1 uuid; n int;
begin
  select id into me from public.profiles
   where deactivated_at is null and coalesce(is_banned,false)=false
   order by created_at limit 1;

  select coalesce(xp,0) into base_xp from public.profiles where id = me;

  -- The classic laundering loop: earn, then destroy the source.
  for n in 1..5 loop
    insert into public.posts (author_id, body, is_anonymous)
      values (me, 'xp loop ' || n, false) returning id into p1;
    delete from public.posts where id = p1;
  end loop;

  select coalesce(xp,0) into v_xp from public.profiles where id = me;
  if v_xp <> base_xp then
    raise exception 'FAIL: a create/delete loop inflated XP by %', v_xp - base_xp;
  end if;

  -- Global invariants.
  if exists (
    select 1 from public.profiles p
     left join (select user_id, sum(delta) t from public.aura_transactions group by user_id) s
       on s.user_id = p.id
     where coalesce(p.aura_score,0) <> coalesce(s.t,0)
  ) then
    raise exception 'FAIL: profiles.aura_score no longer equals the ledger sum';
  end if;

  if exists (
    select 1 from public.profiles p
     left join (select user_id, sum(amount) t from public.aura_grants
                 where reversed_at is null group by user_id) g on g.user_id = p.id
     where coalesce(p.xp,0) <> coalesce(g.t,0)
  ) then
    raise exception 'FAIL: profiles.xp no longer equals the active-grant sum';
  end if;

  if exists (
    select 1 from public.profiles
     where coalesce(level,1) <> public.xp_level(coalesce(xp,0))
  ) then
    raise exception 'FAIL: a level does not follow its XP';
  end if;

  raise notice 'OK: XP survives no laundering; aura_score, xp and level all agree';
end $$;

-- ---------------------------------------------------------------------------
-- 7. The award/reverse primitives themselves.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; base int; v int; ok boolean;
begin
  select id into me from public.profiles order by created_at limit 1;
  select coalesce(aura_score,0) into base from public.profiles where id = me;

  -- Awarding the same source twice pays once.
  if not public.aura_award(me, 7, 'admin_adjust', 'test', 'test:dup', '{}'::jsonb) then
    raise exception 'FAIL: the first award did not report success';
  end if;
  if public.aura_award(me, 7, 'admin_adjust', 'test', 'test:dup', '{}'::jsonb) then
    raise exception 'FAIL: a duplicate award reported success';
  end if;
  select coalesce(aura_score,0) into v from public.profiles where id = me;
  if v <> base + 7 then
    raise exception 'FAIL: duplicate award paid % ', v - base;
  end if;

  -- Reversing twice deducts once. THIS is the property that makes every
  -- cascade path safe.
  if not public.aura_reverse('test:dup', '{}'::jsonb) then
    raise exception 'FAIL: the first reversal did not report success';
  end if;
  if public.aura_reverse('test:dup', '{}'::jsonb) then
    raise exception 'FAIL: a second reversal reported success';
  end if;
  select coalesce(aura_score,0) into v from public.profiles where id = me;
  if v <> base then
    raise exception 'FAIL: double reversal netted % ', v - base;
  end if;

  -- Reversing something that never existed is a no-op, not a deduction.
  if public.aura_reverse('test:never-existed', '{}'::jsonb) then
    raise exception 'FAIL: reversing a missing source reported success';
  end if;
  select coalesce(aura_score,0) into v from public.profiles where id = me;
  if v <> base then
    raise exception 'FAIL: reversing a missing source moved % Aura', v - base;
  end if;

  raise notice 'OK: award and reverse are both idempotent';
end $$;

-- ---------------------------------------------------------------------------
-- 8. A client cannot touch any of it.
-- ---------------------------------------------------------------------------
do $$
declare me uuid; other uuid; ids uuid[];
begin
  select array_agg(id) into ids from (
    select id from public.profiles order by created_at limit 2) s;
  me := ids[1]; other := ids[2];

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.aura_transactions (user_id, delta, reason)
      values (me, 1000, 'admin_adjust');
    execute 'set local role postgres';
    raise exception 'FAIL: a client inserted a ledger row';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.aura_grants limit 1;
    execute 'set local role postgres';
    raise exception 'FAIL: a client read aura_grants';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.aura_award(other, 9999, 'admin_adjust', 'x', 'x:forged', '{}'::jsonb);
    execute 'set local role postgres';
    raise exception 'FAIL: a client awarded Aura to another user';
  exception when insufficient_privilege then null;
  end;

  execute 'set local role postgres';
  raise notice 'OK: ledger, register and award path are all closed to clients';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
