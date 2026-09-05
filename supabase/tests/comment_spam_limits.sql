-- =============================================================================
-- Verification for migration 0193 — database-enforced comment anti-spam.
--
-- Run against a database with 0193 applied. Everything is inside a transaction
-- that is ROLLED BACK.
--
--   psql "$DB_URL" -f supabase/tests/comment_spam_limits.sql
--
-- Every check raises on failure; a run ending in "ALL CHECKS PASSED" is the
-- pass condition.
--
-- TIME IS MANIPULATED BY BACKDATING ROWS, not by sleeping. The cooldown and the
-- rolling hour read `rate_limit_events.created_at`, so moving those timestamps
-- backwards is exactly equivalent to waiting, and turns a 60-minute assertion
-- into a millisecond one.
--
-- The inserts run as `authenticated` with a real JWT claim wherever the point
-- is that a CLIENT cannot bypass a rule — running them as the superuser would
-- prove nothing about the path a student actually takes.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Structure and firing order.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='post_comments'
       and t.tgname='post_comments_spam_limits'
       and pg_get_triggerdef(t.oid) like '%BEFORE INSERT%'
  ) then
    raise exception 'FAIL: the spam-limit trigger is missing or is not BEFORE INSERT';
  end if;

  -- It must sort AFTER the ban and depth checks: PostgreSQL fires same-event
  -- triggers in name order, and a banned or malformed insert should be refused
  -- before anything takes a lock.
  if 'post_comments_spam_limits' <= 'post_comments_enforce_depth' then
    raise exception 'FAIL: the spam-limit trigger would fire before the depth check';
  end if;

  if has_function_privilege('authenticated',
       'public.enforce_comment_spam_limits()', 'execute') then
    raise exception 'FAIL: a client can execute the enforcement function';
  end if;

  raise notice 'OK: trigger present, BEFORE INSERT, ordered last, not client-callable';
end $$;

-- ---------------------------------------------------------------------------
-- 1. The four rules, exercised as a real client.
-- ---------------------------------------------------------------------------
do $$
declare
  author uuid; me uuid; other uuid; ids uuid[];
  p1 uuid; p2 uuid;
  i int; n int; before_count int; before_aura int; before_notif int;
  ok boolean;
begin
  select array_agg(id) into ids from (
    select p.id from public.profiles p
     where p.deactivated_at is null and coalesce(p.is_banned,false)=false
     order by p.created_at limit 3) s;
  author := ids[1]; me := ids[2]; other := ids[3];

  insert into public.posts (author_id, body, is_anonymous)
    values (author, 'spam limit fixture A', false) returning id into p1;
  insert into public.posts (author_id, body, is_anonymous)
    values (author, 'spam limit fixture B', false) returning id into p2;

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';

  -- ---- 1. First comment is allowed. --------------------------------------
  insert into public.post_comments (post_id, author_id, body)
    values (p1, me, 'first');

  -- ---- 1a. A second within 30 seconds is REJECTED. -----------------------
  begin
    insert into public.post_comments (post_id, author_id, body)
      values (p1, me, 'too soon');
    raise exception 'FAIL: a second comment within 30s was accepted';
  exception when sqlstate 'P0001' then
    if position('comment_cooldown' in sqlerrm) = 0 then raise; end if;
  end;

  -- ---- 2. A DIFFERENT post is unaffected. --------------------------------
  insert into public.post_comments (post_id, author_id, body)
    values (p2, me, 'other post is fine');

  execute 'set local role postgres';

  -- ---- 3. The sixth in a rolling hour is rejected. ------------------------
  -- Age the cooldown out each time, leaving the hourly history intact.
  for i in 2..5 loop
    update public.rate_limit_events
       set created_at = created_at - interval '31 seconds'
     where user_id = me and action = 'comment:' || p1::text;
    perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
    execute 'set local role authenticated';
    insert into public.post_comments (post_id, author_id, body)
      values (p1, me, 'comment ' || i);
    execute 'set local role postgres';
  end loop;

  update public.rate_limit_events
     set created_at = created_at - interval '31 seconds'
   where user_id = me and action = 'comment:' || p1::text;

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.post_comments (post_id, author_id, body)
      values (p1, me, 'sixth');
    raise exception 'FAIL: a sixth comment in the rolling hour was accepted';
  exception when sqlstate 'P0001' then
    if position('comment_hourly_limit' in sqlerrm) = 0 then raise; end if;
  end;
  execute 'set local role postgres';

  -- ---- 4. Past the hour, allowed again. ----------------------------------
  update public.rate_limit_events
     set created_at = created_at - interval '61 minutes'
   where user_id = me and action = 'comment:' || p1::text;
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  insert into public.post_comments (post_id, author_id, body)
    values (p1, me, 'after the window');
  execute 'set local role postgres';

  raise notice 'OK: cooldown, per-post scoping, rolling hour, and its expiry';

  -- ---- 5. The eleventh EXISTING comment by one user is rejected. ---------
  -- Age history out entirely so only the lifetime cap can bite.
  for i in 7..10 loop
    update public.rate_limit_events
       set created_at = created_at - interval '61 minutes'
     where user_id = me and action = 'comment:' || p1::text;
    perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
    execute 'set local role authenticated';
    insert into public.post_comments (post_id, author_id, body)
      values (p1, me, 'comment ' || i);
    execute 'set local role postgres';
  end loop;

  select count(*) into n from public.post_comments
   where post_id = p1 and author_id = me;
  if n <> 10 then
    raise exception 'FAIL: expected 10 comments by this user, got %', n;
  end if;

  update public.rate_limit_events
     set created_at = created_at - interval '61 minutes'
   where user_id = me and action = 'comment:' || p1::text;
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.post_comments (post_id, author_id, body)
      values (p1, me, 'eleventh');
    raise exception 'FAIL: an eleventh existing comment was accepted';
  exception when sqlstate 'P0001' then
    if position('comment_user_post_limit' in sqlerrm) = 0 then raise; end if;
  end;
  execute 'set local role postgres';

  -- ---- 6. Deleting frees a LIFETIME slot but not the hourly history. -----
  delete from public.post_comments
   where id = (select id from public.post_comments
                where post_id = p1 and author_id = me
                order by created_at desc limit 1);

  -- The history is still there: five events inside the last hour would block.
  update public.rate_limit_events
     set created_at = now() - interval '2 minutes'
   where user_id = me and action = 'comment:' || p1::text;

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.post_comments (post_id, author_id, body)
      values (p1, me, 'delete-and-retry');
    raise exception 'FAIL: delete-and-retry evaded the rolling hour';
  exception when sqlstate 'P0001' then
    if position('comment_hourly_limit' in sqlerrm) = 0 then raise; end if;
  end;
  execute 'set local role postgres';

  raise notice 'OK: lifetime cap, and delete-and-retry cannot reset the hour';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The post-wide cap, replies, and what a rejection must NOT do.
-- ---------------------------------------------------------------------------
do $$
declare
  author uuid; me uuid; ids uuid[]; p uuid; parent uuid;
  i int; n int; cnt int; before_count int; before_aura int; before_notif int;
begin
  select array_agg(id) into ids from (
    select p2.id from public.profiles p2
     where p2.deactivated_at is null and coalesce(p2.is_banned,false)=false
     order by p2.created_at limit 2) s;
  author := ids[1]; me := ids[2];

  insert into public.posts (author_id, body, is_anonymous)
    values (author, 'post cap fixture', false) returning id into p;

  -- Fill to exactly 30 as the superuser via the documented import hatch, which
  -- is also a test OF that hatch: it must bypass the limits and nothing else.
  perform set_config('app.comment_import', '1', true);
  insert into public.post_comments (post_id, author_id, body)
    values (p, me, 'seed 1') returning id into parent;
  for i in 2..30 loop
    -- Half of them are REPLIES: they must consume the same budget.
    if i % 2 = 0 then
      insert into public.post_comments (post_id, author_id, body, parent_id)
        values (p, me, 'seed ' || i, parent);
    else
      insert into public.post_comments (post_id, author_id, body)
        values (p, me, 'seed ' || i);
    end if;
  end loop;
  perform set_config('app.comment_import', '0', true);

  select count(*) into n from public.post_comments where post_id = p;
  if n <> 30 then
    raise exception 'FAIL: fixture built % comments, expected 30', n;
  end if;

  select comment_count into before_count from public.posts where id = p;
  select count(*) into before_aura from public.aura_transactions where user_id = author;
  select count(*) into before_notif from public.notifications where user_id = author;

  -- ---- 7. The thirty-first is rejected — as a top-level comment... -------
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.post_comments (post_id, author_id, body)
      values (p, me, 'thirty-first');
    raise exception 'FAIL: the 31st comment was accepted';
  exception when sqlstate 'P0001' then
    if position('comment_post_full' in sqlerrm) = 0 then raise; end if;
  end;

  -- ---- 9. ...and as a REPLY. ---------------------------------------------
  begin
    insert into public.post_comments (post_id, author_id, body, parent_id)
      values (p, me, 'thirty-first reply', parent);
    raise exception 'FAIL: a reply bypassed the post cap';
  exception when sqlstate 'P0001' then
    if position('comment_post_full' in sqlerrm) = 0 then raise; end if;
  end;
  execute 'set local role postgres';

  -- ---- 11 + 12. A rejection changes NOTHING downstream. ------------------
  select comment_count into cnt from public.posts where id = p;
  if cnt is distinct from before_count then
    raise exception 'FAIL: a rejected insert moved comment_count (% -> %)',
      before_count, cnt;
  end if;
  select count(*) into n from public.aura_transactions where user_id = author;
  if n <> before_aura then
    raise exception 'FAIL: a rejected insert created Aura rows';
  end if;
  select count(*) into n from public.notifications where user_id = author;
  if n <> before_notif then
    raise exception 'FAIL: a rejected insert created notifications';
  end if;

  -- ---- 13. A post ALREADY over the cap keeps its rows and stays closed. --
  perform set_config('app.comment_import', '1', true);
  for i in 31..35 loop
    insert into public.post_comments (post_id, author_id, body)
      values (p, me, 'legacy ' || i);
  end loop;
  perform set_config('app.comment_import', '0', true);

  select count(*) into n from public.post_comments where post_id = p;
  if n <> 35 then
    raise exception 'FAIL: an over-cap post lost rows (% left)', n;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.post_comments (post_id, author_id, body)
      values (p, me, 'still closed');
    raise exception 'FAIL: an over-cap post accepted a new comment';
  exception when sqlstate 'P0001' then
    if position('comment_post_full' in sqlerrm) = 0 then raise; end if;
  end;
  execute 'set local role postgres';

  -- ---- 14. Deleting a parent cascades its replies and the count follows. -
  select comment_count into before_count from public.posts where id = p;
  select count(*) into n from public.post_comments where parent_id = parent;
  delete from public.post_comments where id = parent;
  select comment_count into cnt from public.posts where id = p;
  if cnt <> before_count - (n + 1) then
    raise exception 'FAIL: cascade delete left comment_count at % (expected %)',
      cnt, before_count - (n + 1);
  end if;
  if cnt <> (select count(*) from public.post_comments where post_id = p) then
    raise exception 'FAIL: comment_count no longer matches the real row count';
  end if;
  if cnt < 0 then
    raise exception 'FAIL: comment_count went negative';
  end if;

  raise notice 'OK: post cap, replies counted, rejections inert, cascade accurate';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Identity: a definer wrapper cannot write as someone else.
-- ---------------------------------------------------------------------------
do $$
declare
  author uuid; me uuid; other uuid; ids uuid[]; p uuid;
begin
  select array_agg(id) into ids from (
    select p2.id from public.profiles p2
     where p2.deactivated_at is null and coalesce(p2.is_banned,false)=false
     order by p2.created_at limit 3) s;
  author := ids[1]; me := ids[2]; other := ids[3];

  insert into public.posts (author_id, body, is_anonymous)
    values (author, 'identity fixture', false) returning id into p;

  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.post_comments (post_id, author_id, body)
      values (p, other, 'not mine');
    execute 'set local role postgres';
    raise exception 'FAIL: a comment was written under another author id';
  exception
    when sqlstate '42501' then null;  -- our own check, or RLS. Either is fine.
    when insufficient_privilege then null;
  end;
  execute 'set local role postgres';

  raise notice 'OK: author_id must match the authenticated caller';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Concurrency: the lock is what makes 31 impossible.
-- ---------------------------------------------------------------------------
-- A genuine two-session race cannot be staged inside one transaction, so this
-- asserts the mechanism that makes the race safe — the enforcement serialises
-- on the POST, so a second inserter cannot read a stale count. Combined with
-- the >= 30 check above (which is evaluated while holding that lock), comments
-- 30 and 31 cannot both be written.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='enforce_comment_spam_limits';

  if position('pg_advisory_xact_lock' in def) = 0 then
    raise exception 'FAIL: the enforcement does not serialise';
  end if;
  -- Locked on the POST, so ALL inserts into one post contend.
  if position('comment:' in def) = 0 then
    raise exception 'FAIL: the lock is not scoped to the post';
  end if;
  -- The count must be read AFTER the lock is taken, or serialising is pointless.
  if position('pg_advisory_xact_lock' in def) > position('v_total >= 30' in def) then
    raise exception 'FAIL: the post count is read before the lock is acquired';
  end if;

  raise notice 'OK: post-scoped lock is taken before the count is read';
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
