-- =============================================================================
-- Verification for migrations 0190 + 0191 — the 100 Aura welcome gift.
--
-- Run against a database that already has 0190 and 0191 applied, in that order.
-- Everything happens inside a transaction that is ROLLED BACK.
--
--   psql "$DB_URL" -f supabase/tests/signup_welcome_bonus.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition. A silent run is NOT a pass.
--
-- THIS SCRIPT CREATES REAL auth.users ROWS. That is the only honest way to test
-- a trigger on auth.users — calling handle_new_user() by hand would prove that
-- the function works, not that signup awards the bonus and that nothing else
-- does. The rollback removes them; the email domain is one the signup guard
-- accepts (enforce_signup_email_domain fires BEFORE INSERT on the same table).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structure.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'aura_reason' and e.enumlabel = 'signup_bonus'
  ) then
    raise exception 'FAIL: signup_bonus is not in the aura_reason enum';
  end if;

  -- The uniqueness must be the DATABASE's, not a read-then-write.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'aura_transactions_signup_bonus_uidx'
       and indexdef like '%UNIQUE%'
       and indexdef like '%signup_bonus%'
  ) then
    raise exception 'FAIL: the one-bonus-per-user unique index is missing';
  end if;

  -- The award path must not be reachable by a client.
  if has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
     or has_function_privilege('anon', 'public.handle_new_user()', 'execute') then
    raise exception 'FAIL: a client can execute handle_new_user';
  end if;
  if has_table_privilege('authenticated', 'public.aura_transactions', 'insert') then
    raise exception 'FAIL: a client can insert ledger rows';
  end if;

  -- The trigger must fire on INSERT ONLY. This is the entire timing guarantee:
  -- login, refresh, confirm and reset are UPDATEs to auth.users.
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'on_auth_user_created'
       and pg_get_triggerdef(t.oid) like '%AFTER INSERT ON auth.users%'
       and pg_get_triggerdef(t.oid) not like '%UPDATE%'
  ) then
    raise exception 'FAIL: on_auth_user_created is not AFTER INSERT only';
  end if;

  raise notice 'OK: enum, unique index, grants, INSERT-only trigger';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Signup awards exactly one +100, and the cached balance follows.
-- ---------------------------------------------------------------------------
do $$
declare
  uid   uuid := gen_random_uuid();
  email text := 'i' || (floor(random() * 900000 + 100000))::int || '@nu.edu.pk';
  n int; total int; cached int; v_xp int; v_lvl int;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role,
                          instance_id, created_at, updated_at)
  values (uid, email, jsonb_build_object('full_name', 'Welcome Fixture'),
          'authenticated', 'authenticated',
          '00000000-0000-0000-0000-000000000000', now(), now());

  -- 1a. The profile was bootstrapped.
  if not exists (select 1 from public.profiles where id = uid) then
    raise exception 'FAIL: signup did not create a profile';
  end if;
  if not exists (select 1 from public.notification_preferences where user_id = uid) then
    raise exception 'FAIL: signup did not create notification preferences';
  end if;

  -- 1b. Exactly ONE bonus, worth exactly 100.
  select count(*), coalesce(sum(delta), 0) into n, total
    from public.aura_transactions
   where user_id = uid and reason = 'signup_bonus';
  if n <> 1 then
    raise exception 'FAIL: signup produced % signup_bonus rows, expected 1', n;
  end if;
  if total <> 100 then
    raise exception 'FAIL: the welcome gift was worth %, expected 100', total;
  end if;

  -- 1c. The cached balance is exactly 100, and it came from the LEDGER.
  select coalesce(aura_score, 0) into cached from public.profiles where id = uid;
  if cached <> 100 then
    raise exception 'FAIL: a brand-new account holds % Aura, expected 100', cached;
  end if;
  if cached <> (select coalesce(sum(delta),0) from public.aura_transactions where user_id = uid) then
    raise exception 'FAIL: aura_score does not equal the ledger sum';
  end if;

  -- 1d. Metadata carries the source tag and nothing identifying.
  if (select metadata->>'source' from public.aura_transactions
       where user_id = uid and reason = 'signup_bonus') <> 'welcome_invitation' then
    raise exception 'FAIL: the source tag is missing';
  end if;
  if exists (
    select 1 from public.aura_transactions
     where user_id = uid and reason = 'signup_bonus'
       and (metadata::text ilike '%@%' or metadata ? 'email' or metadata ? 'full_name')
  ) then
    raise exception 'FAIL: the ledger metadata carries personal information';
  end if;

  -- 1e. IT IS A GIFT, NOT PARTICIPATION: no grant, therefore no XP, and the
  --     account is still level 1.
  if exists (select 1 from public.aura_grants where user_id = uid) then
    raise exception 'FAIL: the welcome gift created an XP-bearing grant';
  end if;
  -- Qualified, and the locals renamed: bare `xp`/`level` are ambiguous between
  -- a PL/pgSQL variable and the column of the same name.
  select coalesce(p.xp, 0), coalesce(p.level, 1) into v_xp, v_lvl
    from public.profiles p where p.id = uid;
  if v_xp <> 0 then
    raise exception 'FAIL: the welcome gift granted % XP, expected 0', v_xp;
  end if;
  if v_lvl <> 1 then
    raise exception 'FAIL: a brand-new account is level %, expected 1', v_lvl;
  end if;

  -- 1f. It unlocks no contribution achievement.
  if exists (select 1 from public.user_achievements where user_id = uid) then
    raise exception 'FAIL: registering unlocked an achievement';
  end if;

  raise notice 'OK: signup awards exactly one +100, no XP, no level, no badge';

  -- -------------------------------------------------------------------------
  -- 2. Nothing that is not account creation can award it again.
  -- -------------------------------------------------------------------------
  -- Each of these is what the real event looks like at the database: an UPDATE
  -- to auth.users, or a write to profiles. The trigger is AFTER INSERT, so none
  -- of them reach it — and the unique index would refuse anyway.
  update auth.users set last_sign_in_at = now() where id = uid;              -- login
  update auth.users set last_sign_in_at = now(), updated_at = now() where id = uid; -- login again
  update auth.users set email_confirmed_at = now() where id = uid;           -- confirm email
  update auth.users set encrypted_password = 'x', updated_at = now() where id = uid; -- set/reset password
  update auth.users set raw_user_meta_data =
    coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('onboarded', true)
   where id = uid;                                                            -- onboarding
  update public.profiles set full_name = 'Renamed', bio = 'hello' where id = uid;
  update public.profiles set deactivated_at = now() where id = uid;           -- deactivate
  update public.profiles set deactivated_at = null where id = uid;            -- reactivate
  insert into public.profiles (id, full_name, username)
    values (uid, 'Dup', 'dupfixture') on conflict (id) do nothing;            -- bootstrap retry
  insert into public.notification_preferences (user_id)
    values (uid) on conflict (user_id) do nothing;

  select count(*) into n from public.aura_transactions
   where user_id = uid and reason = 'signup_bonus';
  if n <> 1 then
    raise exception 'FAIL: post-signup activity produced % bonuses, expected 1', n;
  end if;
  if (select coalesce(aura_score,0) from public.profiles where id = uid) <> 100 then
    raise exception 'FAIL: the balance moved after non-signup activity';
  end if;

  -- 2b. A direct retry of the exact award is refused by the index.
  begin
    insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (uid, 100, 'signup_bonus', jsonb_build_object('source','welcome_invitation'));
    raise exception 'FAIL: a second signup_bonus row was accepted';
  exception
    when unique_violation then null;   -- expected
  end;

  -- ...and the conflict-safe form is a silent no-op, which is what the trigger
  -- uses, so a retried bootstrap cannot duplicate it.
  insert into public.aura_transactions (user_id, delta, reason, metadata)
  values (uid, 100, 'signup_bonus', jsonb_build_object('source','welcome_invitation'))
  on conflict (user_id) where reason = 'signup_bonus' do nothing;

  select count(*), coalesce(sum(delta),0) into n, total
    from public.aura_transactions where user_id = uid and reason = 'signup_bonus';
  if n <> 1 or total <> 100 then
    raise exception 'FAIL: retry left % rows totalling %', n, total;
  end if;

  raise notice 'OK: login, confirm, reset, onboarding, upserts and retries award nothing';

  -- -------------------------------------------------------------------------
  -- 3. It does not inflate the weekly rankings.
  -- -------------------------------------------------------------------------
  -- The account has 100 Aura, all of it from this week's welcome gift. If the
  -- leaderboard counted it, this brand-new user would appear on it.
  if exists (
    select 1 from public.get_weekly_leaderboard(100) w where w.user_id = uid
  ) then
    raise exception 'FAIL: the welcome gift put a new account on the leaderboard';
  end if;

  raise notice 'OK: the gift is invisible to the weekly leaderboard';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Existing users are untouched, and earned rewards still work.
-- ---------------------------------------------------------------------------
do $$
declare
  existing uuid;
  before_total int; after_total int;
  author uuid; p1 uuid; base int; v int;
begin
  -- Nobody who already existed received one. (This also proves the migration
  -- itself did not backfill: it ran before this script.)
  select count(*) into after_total
    from public.aura_transactions t
   where t.reason = 'signup_bonus'
     and t.user_id in (
       select id from public.profiles where created_at < now() - interval '1 hour'
     );
  if after_total <> 0 then
    raise exception 'FAIL: % pre-existing users were backfilled', after_total;
  end if;

  -- A normal earned reward still works end to end (the welcome gift must not
  -- have disturbed the grant-backed paths).
  select p.id into author from public.profiles p
   where p.deactivated_at is null and coalesce(p.is_banned,false) = false
   order by p.created_at limit 1;

  select coalesce(sum(delta),0) into base from public.aura_transactions
   where user_id = author and reason = 'post_created';

  insert into public.posts (author_id, body, is_anonymous)
    values (author, 'welcome-bonus regression fixture', false) returning id into p1;
  select coalesce(sum(delta),0) into v from public.aura_transactions
   where user_id = author and reason = 'post_created';
  if v <> base + 2 then
    raise exception 'FAIL: a normal post reward moved % instead of +2', v - base;
  end if;

  delete from public.posts where id = p1;
  select coalesce(sum(delta),0) into v from public.aura_transactions
   where user_id = author and reason = 'post_created';
  if v <> base then
    raise exception 'FAIL: post reversal still broken (net %)', v - base;
  end if;

  -- Global cache invariant, with the new reason in play.
  if exists (
    select 1 from public.profiles p
     left join (select user_id, sum(delta) t from public.aura_transactions group by user_id) s
       on s.user_id = p.id
     where coalesce(p.aura_score,0) <> coalesce(s.t,0)
  ) then
    raise exception 'FAIL: aura_score no longer equals the ledger sum';
  end if;

  raise notice 'OK: no backfill, earned rewards intact, cache consistent';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
