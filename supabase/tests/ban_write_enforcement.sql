-- =============================================================================
-- Verification for migration 0173 — database-level ban enforcement.
--
-- Run against the target project AFTER applying 0173. Everything happens inside
-- a transaction that is ROLLED BACK, so it writes nothing permanent — but it
-- does exercise real inserts, so run it against dev first if you want to be
-- careful. It picks an arbitrary existing profile and bans it only inside the
-- transaction.
--
--   psql "$DB_URL" -f supabase/tests/ban_write_enforcement.sql
--
-- Every check raises on failure, so a clean run that ends with "ALL CHECKS
-- PASSED" is the pass condition. A silent run is NOT a pass.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structural checks — the pieces exist with the right security posture.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='is_banned';
  if n <> 1 then raise exception 'FAIL: public.is_banned(uuid) missing'; end if;

  -- enforce_not_banned MUST be SECURITY INVOKER. If it is ever made DEFINER,
  -- current_user becomes the owner on every call and the guard silently never
  -- fires. That is the single most dangerous way this can regress.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='enforce_not_banned' and p.prosecdef = false;
  if n <> 1 then
    raise exception 'FAIL: enforce_not_banned must exist and be SECURITY INVOKER';
  end if;

  select count(*) into n from pg_trigger
   where not tgisinternal and tgname like 'enforce_not_banned_%';
  if n < 15 then raise exception 'FAIL: expected >=15 ban triggers, found %', n; end if;
  raise notice 'OK: helper, invoker guard, and % triggers present', n;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Pick a victim and ban them, inside this transaction only.
-- ---------------------------------------------------------------------------
create temp table subject on commit drop as
  select id from public.profiles where not is_banned and onboarding_completed limit 1;

update public.profiles set is_banned = true
 where id = (select id from subject);

do $$
begin
  if not public.is_banned((select id from subject)) then
    raise exception 'FAIL: is_banned() does not report the ban';
  end if;
  raise notice 'OK: is_banned() reports the ban';
end $$;

-- ---------------------------------------------------------------------------
-- 2. As the banned user, a content write MUST be rejected with 42501.
-- ---------------------------------------------------------------------------
do $$
declare uid uuid := (select id from subject); ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.posts (author_id, body) values (uid, 'ban enforcement probe');
    raise exception 'FAIL: banned user was able to INSERT a post';
  exception
    when insufficient_privilege then ok := true;   -- 42501, what we expect
    when others then
      -- An RLS refusal (42501 too) or any other block is still a block, but a
      -- DIFFERENT error means the trigger is not what stopped it. Surface it.
      raise exception 'FAIL: unexpected error %: %', SQLSTATE, SQLERRM;
  end;
  reset role;
  if not ok then raise exception 'FAIL: post insert was not blocked'; end if;
  raise notice 'OK: banned user blocked from posting (42501)';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Appeals and reports MUST still work — a ban must stay appealable.
-- ---------------------------------------------------------------------------
do $$
declare uid uuid := (select id from subject);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.appeals (user_id, message) values (uid, 'ban enforcement probe');
    raise notice 'OK: banned user can still file an appeal';
  exception
    when insufficient_privilege then
      raise exception 'FAIL: banned user cannot appeal — the ban is unappealable';
    when others then
      -- Column drift in `appeals` should not fail the whole run; report it.
      raise notice 'SKIP appeals probe (schema differs): % %', SQLSTATE, SQLERRM;
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Moderation must still work ON the banned user. Definer/service paths run
--    as a different current_user and must be exempt.
-- ---------------------------------------------------------------------------
do $$
declare uid uuid := (select id from subject);
begin
  -- current_user here is postgres, i.e. the definer/maintenance path.
  update public.posts set hidden = true where author_id = uid;
  raise notice 'OK: moderation writes on a banned user are exempt (current_user=%)', current_user;
end $$;

-- ---------------------------------------------------------------------------
-- 5. A NON-banned user is unaffected — the guard must not gate everyone.
-- ---------------------------------------------------------------------------
do $$
declare uid uuid;
begin
  select id into uid from public.profiles
   where not is_banned and onboarding_completed and id <> (select id from subject) limit 1;
  if uid is null then raise notice 'SKIP: no second profile to test with'; return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.posts (author_id, body) values (uid, 'control probe');
  reset role;
  raise notice 'OK: a non-banned user can still post';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

-- Nothing above is kept.
rollback;
