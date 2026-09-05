-- =============================================================================
-- Verification for migration 0185 — anonymous, grouped incoming-like interest.
--
-- Run against a database that already has 0185 applied. Everything happens
-- inside a transaction that is ROLLED BACK, so it writes nothing permanent —
-- but it exercises real triggers and RLS, so run it on dev first.
--
--   psql "$DB_URL" -f supabase/tests/incoming_match_interest.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition. A silent run is NOT a pass.
--
-- FIXTURES ONLY ADD. They select accounts that are in no swipe, match, block or
-- mute to begin with, so nothing has to be deleted to make room — the lesson
-- from the 0182 script, which tried to clear real users' relationships and was
-- correctly refused by dm_report_evidence_immutable.
--
-- create_notification() and this feature both honour notification_preferences,
-- and an ABSENT row counts as off, so the fixtures seed `matches = true`
-- explicitly. Without that every assertion below would pass on an empty set for
-- the wrong reason.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structure, grants, and the privacy posture.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reconcile_incoming_match_interest'
  ) then
    raise exception 'FAIL: reconcile_incoming_match_interest is missing';
  end if;

  -- NOT client-callable: it takes a recipient, so exposing it would answer
  -- "how many people like <anyone>".
  if has_function_privilege('authenticated',
       'public.reconcile_incoming_match_interest(uuid, boolean)', 'execute') then
    raise exception 'FAIL: authenticated can call the reconcile function';
  end if;
  if has_function_privilege('anon',
       'public.reconcile_incoming_match_interest(uuid, boolean)', 'execute') then
    raise exception 'FAIL: anon can call the reconcile function';
  end if;

  -- The wake ledger names who liked whom. It must be unreachable.
  if has_table_privilege('authenticated', 'public.incoming_interest_wakes', 'select')
     or has_table_privilege('anon', 'public.incoming_interest_wakes', 'select') then
    raise exception 'FAIL: the wake ledger is client-readable';
  end if;
  if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname='public' and c.relname='incoming_interest_wakes') then
    raise exception 'FAIL: RLS is off on the wake ledger';
  end if;
  if exists (select 1 from pg_policies
              where schemaname='public' and tablename='incoming_interest_wakes') then
    raise exception 'FAIL: the wake ledger has a policy; it should have none';
  end if;

  -- swipes RLS unchanged: a student reads only their OWN swipes, so incoming
  -- likes cannot be enumerated directly.
  if exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='swipes' and cmd='SELECT'
       and qual not like '%swiper_id%'
  ) then
    raise exception 'FAIL: a swipes SELECT policy no longer scopes to the swiper';
  end if;

  raise notice 'OK: structure, grants, ledger privacy, swipes RLS';
end $$;

-- ---------------------------------------------------------------------------
-- 1. The whole lifecycle.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  ids uuid[];
  n int; cnt int; v_actor uuid; v_data jsonb; v_id uuid; v_group text;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null
       and coalesce(p.is_banned, false) = false
       and coalesce(p.shadow_banned, false) = false
       and p.onboarding_completed = true
       and p.discoverable = true
       and not exists (select 1 from public.swipes s
                        where s.swiper_id = p.id or s.target_id = p.id)
       and not exists (select 1 from public.matches m
                        where m.user_low = p.id or m.user_high = p.id)
       and not exists (select 1 from public.blocked_users b
                        where b.blocker_id = p.id or b.blocked_id = p.id)
       and not exists (select 1 from public.muted_users mu
                        where mu.muter_id = p.id or mu.muted_id = p.id)
     order by p.created_at limit 5
  ) s;
  if coalesce(array_length(ids, 1), 0) < 5 then
    raise exception 'need 5 profiles with no swipe/match/block/mute history';
  end if;
  me := ids[1]; l1 := ids[2]; l2 := ids[3]; l3 := ids[4]; l4 := ids[5];

  insert into public.notification_preferences (user_id, matches)
    select unnest(ids), true
  on conflict (user_id) do update set matches = true;

  -- ---- 1. One one-sided like -> ONE notification, count 1. ----------------
  insert into public.swipes (swiper_id, target_id, direction) values (l1, me, 'like');

  select count(*), max(group_count) into n, cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 1 or cnt <> 1 then
    raise exception 'FAIL: first like produced % rows / count %', n, cnt;
  end if;

  -- ---- 9 + 10. The row is anonymous. --------------------------------------
  select id, actor_id, data, group_key into v_id, v_actor, v_data, v_group
    from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;

  if v_actor is not null then
    raise exception 'FAIL: actor_id is not null — the liker is named';
  end if;
  -- The payload may carry the push destination and nothing else.
  if (select count(*) from jsonb_object_keys(v_data) k where k <> 'url') > 0 then
    raise exception 'FAIL: data carries keys beyond url: %', v_data;
  end if;
  if v_data->>'url' <> '/discover' then
    raise exception 'FAIL: destination is % not /discover', v_data->>'url';
  end if;
  -- No liker id anywhere on the row, including the group key and the subject
  -- columns the cascade populates.
  if v_data::text like '%' || l1::text || '%'
     or v_group like '%' || l1::text || '%' then
    raise exception 'FAIL: the liker id appears on the notification row';
  end if;
  if v_group <> 'incoming_match_interest:' || me::text then
    raise exception 'FAIL: group key is not recipient-scoped: %', v_group;
  end if;
  if exists (
    select 1 from public.notifications
     where id = v_id
       and (subject_post_id is not null or subject_community_id is not null
         or subject_event_id is not null or subject_conversation_id is not null
         or subject_message_id is not null)
  ) then
    raise exception 'FAIL: a subject reference was linked to the anonymous row';
  end if;

  -- ---- 2. A second unique liker -> the SAME row, count 2. -----------------
  insert into public.swipes (swiper_id, target_id, direction) values (l2, me, 'like');
  select count(*), max(group_count) into n, cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 1 or cnt <> 2 then
    raise exception 'FAIL: second liker gave % rows / count %, wanted 1 / 2', n, cnt;
  end if;

  -- ---- 3. A retried / like -> like write changes nothing. -----------------
  update public.swipes set direction = 'like'
   where swiper_id = l1 and target_id = me;
  insert into public.swipes (swiper_id, target_id, direction)
    values (l1, me, 'like')
  on conflict (swiper_id, target_id) do update set direction = 'like';
  select count(*), max(group_count) into n, cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 1 or cnt <> 2 then
    raise exception 'FAIL: a retry moved the aggregate to % rows / count %', n, cnt;
  end if;

  -- ---- 4. A pass creates nothing. -----------------------------------------
  insert into public.swipes (swiper_id, target_id, direction) values (l3, me, 'pass');
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 2 then
    raise exception 'FAIL: a pass changed the count to %', cnt;
  end if;

  -- ---- 5. like -> pass decreases the aggregate. ---------------------------
  update public.swipes set direction = 'pass'
   where swiper_id = l2 and target_id = me;
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: withdrawing a like left the count at %', cnt;
  end if;

  raise notice 'OK: create, group, dedup, pass, withdrawal';

  -- ---- 12. Ineligible accounts do not count. ------------------------------
  insert into public.swipes (swiper_id, target_id, direction) values (l4, me, 'like');
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 2 then
    raise exception 'FAIL: expected 2 before the eligibility sweep, got %', cnt;
  end if;

  update public.profiles set is_banned = true where id = l4;
  perform public.reconcile_incoming_match_interest(me, false);
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: a banned liker still counts (%)', cnt;
  end if;

  update public.profiles set is_banned = false, deactivated_at = now() where id = l4;
  perform public.reconcile_incoming_match_interest(me, false);
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: a deactivated liker still counts (%)', cnt;
  end if;

  update public.profiles
     set deactivated_at = null, suspended_until = now() + interval '1 day'
   where id = l4;
  perform public.reconcile_incoming_match_interest(me, false);
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: a suspended liker still counts (%)', cnt;
  end if;

  update public.profiles set suspended_until = null, shadow_banned = true where id = l4;
  perform public.reconcile_incoming_match_interest(me, false);
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: a shadow-banned liker still counts (%)', cnt;
  end if;

  update public.profiles set shadow_banned = false, discoverable = false where id = l4;
  perform public.reconcile_incoming_match_interest(me, false);
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: an undiscoverable liker still counts (%)', cnt;
  end if;
  update public.profiles set discoverable = true where id = l4;

  -- ---- 7 (blocks). A block removes the pair, silently. --------------------
  insert into public.blocked_users (blocker_id, blocked_id) values (me, l4);
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: a blocked liker still counts (%)', cnt;
  end if;
  delete from public.blocked_users where blocker_id = me and blocked_id = l4;

  -- A mute is the other half of may_notify()'s rules.
  insert into public.muted_users (muter_id, muted_id) values (me, l4);
  perform public.reconcile_incoming_match_interest(me, false);
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: a muted liker still counts (%)', cnt;
  end if;
  delete from public.muted_users where muter_id = me and muted_id = l4;

  raise notice 'OK: banned / deactivated / suspended / shadow-banned / hidden / blocked / muted all excluded';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Matching takes over from the anonymous aggregate.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; l1 uuid; l2 uuid;
  ids uuid[];
  n int; cnt int; aura_before int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and coalesce(p.shadow_banned,false) = false
       and p.onboarding_completed = true and p.discoverable = true
       and not exists (select 1 from public.swipes s
                        where s.swiper_id = p.id or s.target_id = p.id)
       and not exists (select 1 from public.matches m
                        where m.user_low = p.id or m.user_high = p.id)
     order by p.created_at limit 3
  ) s;
  if coalesce(array_length(ids,1),0) < 3 then
    raise exception 'need 3 clean profiles for the matching section';
  end if;
  me := ids[1]; l1 := ids[2]; l2 := ids[3];

  insert into public.notification_preferences (user_id, matches)
    select unnest(ids), true
  on conflict (user_id) do update set matches = true;

  -- Two people like me.
  insert into public.swipes (swiper_id, target_id, direction) values (l1, me, 'like');
  insert into public.swipes (swiper_id, target_id, direction) values (l2, me, 'like');
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 2 then
    raise exception 'FAIL: expected 2 pending, got %', cnt;
  end if;

  select count(*) into aura_before from public.aura_transactions
   where user_id in (me, l1) and reason = 'match';

  -- ---- 6. I like l1 back: exactly ONE match, and the NAMED notifications. -
  insert into public.swipes (swiper_id, target_id, direction) values (me, l1, 'like');

  select count(*) into n from public.matches
   where user_low = least(me, l1) and user_high = greatest(me, l1);
  if n <> 1 then
    raise exception 'FAIL: reciprocal likes produced % match rows', n;
  end if;
  select count(*) into n from public.notifications
   where type = 'match'
     and ((user_id = me and actor_id = l1) or (user_id = l1 and actor_id = me));
  if n <> 2 then
    raise exception 'FAIL: expected 2 named match notifications, got %', n;
  end if;

  -- ---- 18. Aura still awarded exactly once per side. ----------------------
  select count(*) into n from public.aura_transactions
   where user_id in (me, l1) and reason = 'match';
  if n <> aura_before + 2 then
    raise exception 'FAIL: match Aura awards went from % to %', aura_before, n;
  end if;

  -- ---- 7 + 8. The matched pair stops counting; the other liker remains. ---
  select max(group_count) into cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if cnt <> 1 then
    raise exception 'FAIL: after matching l1, the anonymous count is % (want 1, l2 only)', cnt;
  end if;

  -- l1's own side: I had liked nobody before, so l1 has nothing pending, and
  -- the match must not have left a one-sided row behind on their side either.
  select count(*) into n from public.notifications
   where user_id = l1 and type = 'incoming_match_interest' and read_at is null;
  if n <> 0 then
    raise exception 'FAIL: the matched liker kept % anonymous rows', n;
  end if;

  -- When the last pending liker also matches, the row RESOLVES.
  insert into public.swipes (swiper_id, target_id, direction) values (me, l2, 'like');
  select count(*) into n from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 0 then
    raise exception 'FAIL: no pending likers left but % anonymous rows remain', n;
  end if;

  -- ---- 13. Unmatching does not resurrect the old anonymous notification. --
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  perform public.unmatch_user(l1);
  select count(*) into n from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 0 then
    raise exception 'FAIL: unmatching resurrected % anonymous rows', n;
  end if;
  -- ...and the swipes really are gone, so there is nothing left to count.
  select count(*) into n from public.swipes
   where (swiper_id = l1 and target_id = me) or (swiper_id = me and target_id = l1);
  if n <> 0 then
    raise exception 'FAIL: unmatch_user left % swipe rows', n;
  end if;

  raise notice 'OK: match replaces interest, Aura intact, others remain, unmatch quiet';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Read semantics, re-notification, and the preference.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; l1 uuid; l2 uuid;
  ids uuid[];
  n int; cnt int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and coalesce(p.shadow_banned,false) = false
       and p.onboarding_completed = true and p.discoverable = true
       and not exists (select 1 from public.swipes s
                        where s.swiper_id = p.id or s.target_id = p.id)
       and not exists (select 1 from public.matches m
                        where m.user_low = p.id or m.user_high = p.id)
     order by p.created_at limit 3
  ) s;
  me := ids[1]; l1 := ids[2]; l2 := ids[3];
  insert into public.notification_preferences (user_id, matches)
    select unnest(ids), true
  on conflict (user_id) do update set matches = true;

  insert into public.swipes (swiper_id, target_id, direction) values (l1, me, 'like');

  -- ---- 14. Reading it does not delete the swipe, and nothing re-wakes it. -
  update public.notifications set read_at = now()
   where user_id = me and type = 'incoming_match_interest' and read_at is null;

  -- Churn that is NOT a new liker: a retry, an unrelated reconcile.
  update public.swipes set direction = 'like' where swiper_id = l1 and target_id = me;
  perform public.reconcile_incoming_match_interest(me, false);
  select count(*) into n from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 0 then
    raise exception 'FAIL: a read notification was resurrected without a new liker';
  end if;
  if not exists (select 1 from public.swipes where swiper_id = l1 and target_id = me) then
    raise exception 'FAIL: reading the notification destroyed the underlying swipe';
  end if;

  -- ---- 15. A genuinely NEW liker creates exactly one unread row, and its
  --          count is the TOTAL pending (l1 + l2), not just the new one.
  insert into public.swipes (swiper_id, target_id, direction) values (l2, me, 'like');
  select count(*), max(group_count) into n, cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 1 then
    raise exception 'FAIL: a new liker produced % unread rows', n;
  end if;
  if cnt <> 2 then
    raise exception 'FAIL: reactivated count is % — it must show all pending, not only the new one', cnt;
  end if;

  -- ---- Anti-spam: the same pair toggling cannot wake it again. ------------
  update public.notifications set read_at = now()
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  update public.swipes set direction = 'pass' where swiper_id = l2 and target_id = me;
  update public.swipes set direction = 'like' where swiper_id = l2 and target_id = me;
  select count(*) into n from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 0 then
    raise exception 'FAIL: like/pass toggling re-woke the notification (% rows)', n;
  end if;

  -- ---- 17. Preference off: nothing is created, and what exists resolves. --
  update public.notifications set read_at = null
   where user_id = me and type = 'incoming_match_interest';
  update public.notification_preferences set matches = false where user_id = me;
  perform public.reconcile_incoming_match_interest(me, false);
  select count(*) into n from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 0 then
    raise exception 'FAIL: preference off left % unread rows', n;
  end if;

  -- ...and a brand new liker while it is off creates nothing at all.
  insert into public.swipes (swiper_id, target_id, direction)
    values (ids[3], me, 'like')
  on conflict (swiper_id, target_id) do update set direction = 'like';
  select count(*) into n from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 0 then
    raise exception 'FAIL: a preference-disabled user was notified (% rows)', n;
  end if;
  update public.notification_preferences set matches = true where user_id = me;

  raise notice 'OK: read semantics, reactivation total, toggle anti-spam, preference';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Concurrency: two likes in flight must not lose a count or duplicate rows.
-- ---------------------------------------------------------------------------
-- A true two-session race cannot be staged inside one transaction, so this
-- asserts the two properties that make the race safe: the reconcile serialises
-- on the recipient (so the second transaction recomputes AFTER the first
-- commits rather than overwriting with a stale number), and the unique index
-- makes a duplicate unread row impossible even if two inserts did collide.
do $$
declare
  me uuid; l1 uuid; l2 uuid;
  ids uuid[];
  n int; cnt int;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname='public' and p.proname='reconcile_incoming_match_interest'
       and pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%'
  ) then
    raise exception 'FAIL: the reconcile does not serialise per recipient';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and tablename='notifications'
       and indexdef like '%user_id, type, group_key%'
       and indexdef like '%read_at IS NULL%'
  ) then
    raise exception 'FAIL: the partial unique index that prevents duplicate unread rows is missing';
  end if;

  -- Both likes inside one transaction is the strongest single-session
  -- approximation: the second reconcile must see the first swipe and land on 2,
  -- in ONE row.
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and coalesce(p.shadow_banned,false) = false
       and p.onboarding_completed = true and p.discoverable = true
       and not exists (select 1 from public.swipes s
                        where s.swiper_id = p.id or s.target_id = p.id)
       and not exists (select 1 from public.matches m
                        where m.user_low = p.id or m.user_high = p.id)
     order by p.created_at limit 3
  ) s;
  me := ids[1]; l1 := ids[2]; l2 := ids[3];
  insert into public.notification_preferences (user_id, matches)
    select unnest(ids), true
  on conflict (user_id) do update set matches = true;

  insert into public.swipes (swiper_id, target_id, direction)
    values (l1, me, 'like'), (l2, me, 'like');

  select count(*), max(group_count) into n, cnt from public.notifications
   where user_id = me and type = 'incoming_match_interest' and read_at is null;
  if n <> 1 or cnt <> 2 then
    raise exception 'FAIL: simultaneous likes gave % rows / count %, wanted 1 / 2', n, cnt;
  end if;

  raise notice 'OK: serialised reconcile, one row, no lost count';
end $$;

-- ---------------------------------------------------------------------------
-- 5. A student cannot enumerate who liked them, by any route.
-- ---------------------------------------------------------------------------
do $$
declare
  me uuid; l1 uuid; ids uuid[]; n int;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false) = false
       and not exists (select 1 from public.swipes s
                        where s.swiper_id = p.id or s.target_id = p.id)
     order by p.created_at limit 2
  ) s;
  me := ids[1]; l1 := ids[2];
  insert into public.notification_preferences (user_id, matches)
    select unnest(ids), true
  on conflict (user_id) do update set matches = true;

  insert into public.swipes (swiper_id, target_id, direction) values (l1, me, 'like');

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';

  -- 11. The incoming swipe row itself is invisible.
  select count(*) into n from public.swipes s where s.target_id = me;
  if n <> 0 then
    raise exception 'FAIL: a student can read % incoming swipe rows', n;
  end if;

  -- The ledger is unreadable (this must ERROR, not return rows).
  begin
    perform 1 from public.incoming_interest_wakes limit 1;
    execute 'set local role postgres';
    raise exception 'FAIL: a student read the wake ledger';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  -- The reconcile RPC is not callable.
  begin
    perform public.reconcile_incoming_match_interest(me, false);
    execute 'set local role postgres';
    raise exception 'FAIL: a student called the reconcile function';
  exception
    when insufficient_privilege then null;  -- expected
  end;

  -- What they CAN see is their own aggregate, and only the aggregate.
  select count(*) into n from public.notifications
   where type = 'incoming_match_interest' and actor_id is not null;
  execute 'set local role postgres';
  if n <> 0 then
    raise exception 'FAIL: % anonymous notifications carry an actor', n;
  end if;

  raise notice 'OK: incoming swipes, ledger and RPC are all closed to students';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
