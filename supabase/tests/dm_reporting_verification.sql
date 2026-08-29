-- =============================================================================
-- FAST SOCIO — DM privacy hardening verification (migrations 0160-0164)
--
-- SAFETY
-- Sections 1-6 and 8 are READ ONLY: catalog SELECTs that create nothing and
-- lock nothing. They are safe to run against production and that is where
-- their answer is real.
--
-- Section 7 is a BEHAVIOURAL test that inserts two throwaway profiles, a
-- conversation and some messages, exercises submit_dm_report against them, and
-- rolls everything back. It is wrapped in an explicit transaction with a
-- ROLLBACK at the end, so it leaves nothing behind — but it does write inside
-- the transaction, so run it on dev/staging first and only run it against
-- production deliberately.
--
-- Section 9 is behavioural but writes nothing: every call in it is expected to
-- raise before touching data.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> paste one section -> Run.
--   A section whose "result" column reads PASS everywhere is a pass; for the
--   do-blocks, read the NOTICE output.
--
-- SECTION MAP
--   1-6  DM report RPCs, RLS shape, evidence immutability      (read only)
--   7    submit_dm_report behaviour                            (writes, rolls back)
--   8    generic row RPC lockdown - the reviewed P0            (read only)
--   9    the generic guards actually refuse                    (writes nothing)
--   10   message_requests + audit-log containment              (read only)
--   11   message_requests sealed against generic RPCs          (writes nothing)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The dropped RPCs are actually gone.  Expected: 2 rows, both PASS.
-- -----------------------------------------------------------------------------
select
  '1. dropped RPC' as check,
  f.name,
  case when not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname = f.name
  ) then 'PASS' else 'FAIL — function still exists' end as result
from (values ('admin_dm_conversations'), ('admin_dm_messages')) as f(name);


-- -----------------------------------------------------------------------------
-- 2. No role holds EXECUTE on anything named admin_dm_*.  Expected: zero rows.
-- -----------------------------------------------------------------------------
-- Catches a function recreated out of band with its default PUBLIC grant.
-- NOTE ON PUBLIC: aclexplode() represents PUBLIC as grantee OID 0, which is not
-- a row in pg_roles. An INNER JOIN to pg_roles therefore DROPS the PUBLIC grant
-- silently and reports a false PASS. This mattered in practice: on the dev
-- project admin_table_rows held EXECUTE for PUBLIC as well as anon and
-- authenticated, and the original inner-join version of this query could not
-- see it. LEFT JOIN, and map OID 0 explicitly.
select
  '2. stray admin_dm_* grant' as check,
  p.proname,
  case when a.grantee = 0 then 'PUBLIC'
       else coalesce(r.rolname, 'oid:' || a.grantee) end as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
left join pg_roles r on r.oid = a.grantee
where p.proname like 'admin\_dm\_%'
  and p.proname not like 'admin\_dm\_report\_%'
  and a.privilege_type = 'EXECUTE'
  and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));


-- -----------------------------------------------------------------------------
-- 3. The surviving content RPCs refuse one-to-one messages.  Expected: 3 PASS.
-- -----------------------------------------------------------------------------
-- Reads the installed function bodies, so it reflects the live database rather
-- than what the repo says should be there.
select
  '3. message branch removed' as check,
  p.proname,
  case
    when p.prosrc like '%not browsable%'
      or p.prosrc like '%cannot be moderated outside a report%'
      or p.prosrc like '%cannot be deleted from the content browser%'
    then 'PASS'
    else 'FAIL — no refusal found in body'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname in ('admin_content_feed', 'admin_set_content_hidden', 'admin_delete_content');


-- -----------------------------------------------------------------------------
-- 4. RLS shape on the new tables.  Expected: 2 rows, both PASS.
-- -----------------------------------------------------------------------------
-- dm_report_cases: RLS on, exactly one policy, reporter-scoped, no is_admin.
-- dm_report_messages: RLS on, ZERO policies (deny-all; RPC-only access).
select
  '4. rls shape' as check,
  c.relname,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies pol
    where pol.schemaname = 'public' and pol.tablename = c.relname) as policies,
  case
    when not c.relrowsecurity then 'FAIL — RLS disabled'
    when c.relname = 'dm_report_messages'
      and (select count(*) from pg_policies pol
            where pol.schemaname='public' and pol.tablename=c.relname) = 0 then 'PASS'
    when c.relname = 'dm_report_cases'
      and (select count(*) from pg_policies pol
            where pol.schemaname='public' and pol.tablename=c.relname) = 1
      and not exists (
        select 1 from pg_policies pol
        where pol.schemaname='public' and pol.tablename=c.relname
          and coalesce(pol.qual, '') like '%is_admin%') then 'PASS'
    else 'FAIL — unexpected policy set'
  end as result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relname in ('dm_report_cases', 'dm_report_messages');


-- -----------------------------------------------------------------------------
-- 5. Evidence is not directly readable or writable.  Expected: zero rows.
-- -----------------------------------------------------------------------------
-- Any SELECT/INSERT/UPDATE/DELETE grant to anon or authenticated on
-- dm_report_messages defeats the sealed-table design.
select
  '5. evidence table grant' as check,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'dm_report_messages'
  and grantee in ('anon', 'authenticated');


-- -----------------------------------------------------------------------------
-- 6. The immutability trigger exists and covers update AND delete.
--    Expected: 1 row, PASS.
-- -----------------------------------------------------------------------------
select
  '6. evidence immutability' as check,
  t.tgname,
  case
    when (t.tgtype & 16) > 0 and (t.tgtype & 8) > 0 and (t.tgtype & 2) > 0
      then 'PASS'   -- BEFORE (2) + DELETE (8) + UPDATE (16)
    else 'FAIL — trigger does not cover before update and delete'
  end as result
from pg_trigger t
where t.tgrelid = 'public.dm_report_messages'::regclass
  and not t.tgisinternal;


-- =============================================================================
-- 7. BEHAVIOURAL TEST — writes inside a transaction, then rolls back.
--
-- Run this whole block as one statement. It ends in ROLLBACK, so nothing here
-- survives. Read the NOTICE output: every line should say PASS.
-- =============================================================================
begin;

do $$
declare
  u_a       uuid := gen_random_uuid();
  u_b       uuid := gen_random_uuid();
  u_c       uuid := gen_random_uuid();
  conv_ab   uuid;
  conv_ac   uuid;
  m1 uuid; m2 uuid; m3 uuid; m_other uuid;
  ids       uuid[];
  v_case    uuid;
  v_ok      boolean;
  v_sender  uuid;
  v_body    text;
  v_ts      timestamptz;
  i         int;
begin
  -- Fixtures. profiles.id references auth.users in this schema, so these rows
  -- are created with the FK deferred inside the transaction where possible;
  -- if your environment rejects that, run this section against a dev project
  -- with two real test accounts and substitute their ids above.
  set constraints all deferred;

  insert into public.profiles (id, full_name) values
    (u_a, 'ZZ Test A'), (u_b, 'ZZ Test B'), (u_c, 'ZZ Test C');

  insert into public.conversations (user_low, user_high)
    values (least(u_a, u_b), greatest(u_a, u_b)) returning id into conv_ab;
  insert into public.conversations (user_low, user_high)
    values (least(u_a, u_c), greatest(u_a, u_c)) returning id into conv_ac;

  insert into public.messages (conversation_id, sender_id, body)
    values (conv_ab, u_b, 'first abusive message') returning id into m1;
  insert into public.messages (conversation_id, sender_id, body)
    values (conv_ab, u_b, 'second abusive message') returning id into m2;
  insert into public.messages (conversation_id, sender_id, body)
    values (conv_ab, u_a, 'a reply') returning id into m3;
  insert into public.messages (conversation_id, sender_id, body)
    values (conv_ac, u_c, 'unrelated conversation') returning id into m_other;

  -- ---- 7a. zero messages is rejected -------------------------------------
  begin
    perform public.submit_dm_report(conv_ab, '{}'::uuid[], 'harassment',
      'this description is definitely long enough to pass');
    raise notice 'FAIL 7a — empty selection was accepted';
  exception when others then
    raise notice 'PASS 7a — empty selection rejected (%)', sqlerrm;
  end;

  -- ---- 7b. eleven messages is rejected ------------------------------------
  select array_agg(gen_random_uuid()) into ids from generate_series(1, 11);
  begin
    perform public.submit_dm_report(conv_ab, ids, 'harassment',
      'this description is definitely long enough to pass');
    raise notice 'FAIL 7b — 11 messages accepted';
  exception when others then
    raise notice 'PASS 7b — 11 messages rejected (%)', sqlerrm;
  end;

  -- ---- 7c. a message from another conversation is rejected ----------------
  begin
    perform public.submit_dm_report(conv_ab, array[m1, m_other], 'harassment',
      'this description is definitely long enough to pass');
    raise notice 'FAIL 7c — cross-conversation id accepted';
  exception when others then
    raise notice 'PASS 7c — cross-conversation id rejected (%)', sqlerrm;
  end;

  -- ---- 7d. a nonexistent message id is rejected ---------------------------
  begin
    perform public.submit_dm_report(conv_ab, array[m1, gen_random_uuid()],
      'harassment', 'this description is definitely long enough to pass');
    raise notice 'FAIL 7d — nonexistent id accepted';
  exception when others then
    raise notice 'PASS 7d — nonexistent id rejected (%)', sqlerrm;
  end;

  -- ---- 7e. a short description is rejected --------------------------------
  begin
    perform public.submit_dm_report(conv_ab, array[m1], 'harassment', 'too short');
    raise notice 'FAIL 7e — short description accepted';
  exception when others then
    raise notice 'PASS 7e — short description rejected (%)', sqlerrm;
  end;

  -- ---- 7f. an unknown category is rejected --------------------------------
  begin
    perform public.submit_dm_report(conv_ab, array[m1], 'not_a_category',
      'this description is definitely long enough to pass');
    raise notice 'FAIL 7f — unknown category accepted';
  exception when others then
    raise notice 'PASS 7f — unknown category rejected (%)', sqlerrm;
  end;

  -- NOTE ON AUTH
  -- submit_dm_report reads auth.uid(). In the SQL editor that is null, so the
  -- calls above fail at the "not signed in" guard and 7a-7f prove only that
  -- the function refuses. To exercise the participant, duplicate, dedupe and
  -- trusted-copy paths properly, run this block with a JWT claim set, e.g.
  --
  --   select set_config('request.jwt.claims',
  --     json_build_object('sub', '<user A uuid>')::text, true);
  --
  -- immediately before, using a REAL user A who participates in a REAL
  -- conversation. The assertions below then become meaningful.

  -- ---- 7g. duplicate ids collapse rather than inflating evidence_count ----
  -- (meaningful only with a JWT claim set, per the note above)
  begin
    v_case := public.submit_dm_report(conv_ab, array[m1, m1, m1, m2],
      'harassment', 'this description is definitely long enough to pass');
    select evidence_count into i from public.dm_report_cases where id = v_case;
    if i = 2 then
      raise notice 'PASS 7g — 4 ids with repeats stored as 2 evidence rows';
    else
      raise notice 'FAIL 7g — evidence_count is %, expected 2', i;
    end if;

    -- ---- 7h. sender/body/timestamp come from the messages table -----------
    select e.sender_id, e.body_snapshot, e.original_created_at
      into v_sender, v_body, v_ts
      from public.dm_report_messages e
     where e.report_id = v_case and e.source_message_id = m1;
    select (v_sender = u_b
            and v_body = 'first abusive message'
            and v_ts = (select created_at from public.messages where id = m1))
      into v_ok;
    raise notice '% 7h — evidence copied from the trusted message row',
      case when v_ok then 'PASS' else 'FAIL' end;

    -- ---- 7i. evidence cannot be updated ----------------------------------
    begin
      update public.dm_report_messages set body_snapshot = 'tampered'
        where report_id = v_case;
      raise notice 'FAIL 7i — evidence was updatable';
    exception when others then
      raise notice 'PASS 7i — evidence update refused (%)', sqlerrm;
    end;

    -- ---- 7j. evidence cannot be deleted while its case exists -------------
    begin
      delete from public.dm_report_messages where report_id = v_case;
      raise notice 'FAIL 7j — evidence was deletable';
    exception when others then
      raise notice 'PASS 7j — evidence delete refused (%)', sqlerrm;
    end;

    -- ---- 7k. a second open case on the same conversation is refused -------
    begin
      perform public.submit_dm_report(conv_ab, array[m2], 'spam_or_scam',
        'a different description that is also long enough');
      raise notice 'FAIL 7k — duplicate open case accepted';
    exception when others then
      raise notice 'PASS 7k — duplicate open case refused (%)', sqlerrm;
    end;

    -- ---- 7l. submission wrote an audit row --------------------------------
    select exists (
      select 1 from public.moderation_audit_log
      where target_id = v_case and action = 'dm_report.created'
    ) into v_ok;
    raise notice '% 7l — submission audited',
      case when v_ok then 'PASS' else 'FAIL' end;

  exception when others then
    raise notice 'SKIP 7g-7l — needs an authenticated participant (%)', sqlerrm;
  end;

  -- ---- 7m. a non-participant cannot report the conversation ---------------
  -- Set the JWT claim to user C (not in conv_ab) and repeat 7g; expect a
  -- 'not a participant in this conversation' error.
  raise notice 'MANUAL 7m — re-run with user C''s JWT; expect "not a participant"';
end $$;

rollback;

-- =============================================================================
-- 8. GENERIC ROW RPC LOCKDOWN (migration 0162).  READ ONLY.
--
-- Sections 1-6 verified the DM-specific RPCs. This section verifies the generic
-- /admin/database ones, which were the P0 found in review: 0160 guarded the
-- wrapper and left public.admin_table_rows() granted to `authenticated`, so the
-- unrestricted DM browser was still reachable by skipping the wrapper.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 8a. admin_table_rows is NOT executable by anon/authenticated/public.
--     Expected: 1 row, PASS.
-- -----------------------------------------------------------------------------
-- Same PUBLIC-is-OID-0 fix as section 2. The inner-join version of this query
-- returned PASS on a database where PUBLIC still held EXECUTE.
select
  '8a. raw reader revoked' as check,
  coalesce(string_agg(
    case when a.grantee = 0 then 'PUBLIC'
         else coalesce(r.rolname, 'oid:' || a.grantee) end, ', '), '(none)') as still_granted,
  case when count(*) = 0 then 'PASS'
       else 'FAIL - admin_table_rows is still directly executable' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
left join pg_roles r on r.oid = a.grantee
where p.proname = 'admin_table_rows'
  and a.privilege_type = 'EXECUTE'
  and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'));


-- -----------------------------------------------------------------------------
-- 8b. The wrapper CAN still reach it: same owner, so SECURITY DEFINER applies.
--     Expected: 1 row, PASS.
-- -----------------------------------------------------------------------------
-- A SECURITY DEFINER function executes as its owner, and an owner keeps EXECUTE
-- on its own functions regardless of what is revoked from PUBLIC. This check
-- fails only if the two functions somehow ended up with different owners.
select
  '8b. wrapper can still delegate' as check,
  w.owner as wrapper_owner,
  d.owner as delegate_owner,
  case
    when not w.is_definer then 'FAIL - wrapper is not SECURITY DEFINER'
    when w.owner <> d.owner then 'FAIL - owners differ; wrapper cannot call delegate'
    else 'PASS'
  end as result
from
  (select pg_get_userbyid(p.proowner) as owner, p.prosecdef as is_definer
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_browser_table_rows') w,
  (select pg_get_userbyid(p.proowner) as owner
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_table_rows') d;


-- -----------------------------------------------------------------------------
-- 8c. The mutators carry the write floor.  Expected: 3 rows, all PASS.
-- -----------------------------------------------------------------------------
-- admin_update_row RETURNS the updated row, so a no-op write against `messages`
-- was a read path. admin_delete_row snapshots the row into the audit log. Both
-- must call _dm_write_floor before doing either.
select
  '8c. write floor installed' as check,
  p.proname,
  case when p.prosrc like '%_dm_write_floor%' then 'PASS'
       else 'FAIL - no floor; generic row RPC can still touch DM tables' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname in ('admin_update_row', 'admin_insert_row', 'admin_delete_row');


-- -----------------------------------------------------------------------------
-- 8d. The protected set contains every table it must.  Expected: 6 PASS rows.
-- -----------------------------------------------------------------------------
select
  '8d. protected set' as check,
  t.name,
  case when t.name = any (public._dm_protected_tables()) then 'PASS'
       else 'FAIL - not protected' end as result
from (values
  ('messages'), ('conversations'), ('message_reactions'),
  ('message_requests'), ('dm_report_cases'), ('dm_report_messages')
) as t(name);


-- =============================================================================
-- 9. BEHAVIOURAL - the guards actually refuse.
--
-- Writes nothing: every call below is expected to RAISE before touching data,
-- and the one that is not (9f) targets an id that does not exist.
--
-- Run as a super_admin by setting the JWT claim first:
--
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<super admin uuid>')::text, true);
--
-- Read the NOTICE output - every line should say PASS.
-- =============================================================================
do $$
declare
  t        text;
  v_rows   jsonb;
  v_count  int;
begin
  -- ---- 9a. every protected table is refused by the read wrapper -----------
  foreach t in array public._dm_protected_tables() loop
    begin
      perform public.admin_browser_table_rows(t, 1, 0, null, null, 'asc');
      raise notice 'FAIL 9a/% - browser returned rows for a protected table', t;
    exception when others then
      raise notice 'PASS 9a/% - refused (%)', t, sqlerrm;
    end;
  end loop;

  -- ---- 9b. an allowed table still works ----------------------------------
  begin
    v_rows := public.admin_browser_table_rows('profiles', 1, 0, null, null, 'asc');
    v_count := coalesce(jsonb_array_length(v_rows->'rows'), 0);
    if v_rows ? 'total' then
      raise notice 'PASS 9b - allowed table still readable through the wrapper (% row(s))', v_count;
    else
      raise notice 'FAIL 9b - wrapper returned an unexpected shape: %', v_rows;
    end if;
  exception when others then
    raise notice 'FAIL 9b - wrapper refused an allowed table (%)', sqlerrm;
  end;

  -- ---- 9c. the no-op-update read path is closed --------------------------
  -- The one that mattered most: admin_update_row RETURNS the row it wrote.
  begin
    perform public.admin_update_row('messages', 'id',
      '00000000-0000-0000-0000-000000000000', '{"hidden": false}'::jsonb);
    raise notice 'FAIL 9c - admin_update_row still reaches messages';
  exception when others then
    raise notice 'PASS 9c - admin_update_row refused messages (%)', sqlerrm;
  end;

  -- ---- 9d. the delete/audit-snapshot path is closed ----------------------
  begin
    perform public.admin_delete_row('messages', 'id',
      '00000000-0000-0000-0000-000000000000');
    raise notice 'FAIL 9d - admin_delete_row still reaches messages';
  exception when others then
    raise notice 'PASS 9d - admin_delete_row refused messages (%)', sqlerrm;
  end;

  -- ---- 9e. evidence tables are refused by the mutators too ---------------
  begin
    perform public.admin_delete_row('dm_report_messages', 'id',
      '00000000-0000-0000-0000-000000000000');
    raise notice 'FAIL 9e - admin_delete_row still reaches report evidence';
  exception when others then
    raise notice 'PASS 9e - admin_delete_row refused dm_report_messages (%)', sqlerrm;
  end;

  -- ---- 9f. message_requests stays writable for /admin/matching -----------
  -- A deliberate carve-out: the matching admin deletes these as a working
  -- feature. The id below does not exist, so a PASS here means "got past the
  -- floor and found nothing to delete", not "deleted something".
  begin
    perform public.admin_delete_row('message_requests', 'id',
      '00000000-0000-0000-0000-000000000000');
    raise notice 'PASS 9f - message_requests still writable (matching admin unbroken)';
  exception when others then
    if sqlerrm like '%not editable through a row editor%' then
      raise notice 'FAIL 9f - the floor broke /admin/matching (%)', sqlerrm;
    else
      raise notice 'PASS 9f - past the floor; failed later as expected (%)', sqlerrm;
    end if;
  end;
end $$;


-- -----------------------------------------------------------------------------
-- 9g. MANUAL - the bypass itself, from a real client.
-- -----------------------------------------------------------------------------
-- Sections 8-9 run as the database owner, who is ALLOWED to call
-- admin_table_rows - so they verify the ACL and the guards, not the revoke as a
-- signed-in user experiences it. To prove that, call it over PostgREST with a
-- real super_admin JWT:
--
--   curl -s "$SUPABASE_URL/rest/v1/rpc/admin_table_rows" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_ADMIN_JWT" \
--     -H 'Content-Type: application/json' \
--     -d '{"p_table":"messages","p_limit":1,"p_offset":0}'
--
-- Expect HTTP 404 "Could not find the function" (PostgREST hides functions the
-- caller cannot execute) or a 42501 permission denied - NOT a row payload.
-- Repeat for p_table 'conversations' and 'dm_report_messages'.
--
-- Then repeat against admin_browser_table_rows and expect the guard's explicit
-- "cannot read" refusal, and against p_table 'profiles' to confirm the browser
-- still works for allowed tables.


-- =============================================================================
-- 10. message_requests + audit-log containment (migrations 0163 + 0164).
--     READ ONLY.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 10a. The write floor no longer carves out message_requests.
--      Expected: 1 row, PASS.
-- -----------------------------------------------------------------------------
select
  '10a. no message_requests carve-out' as check,
  case when p.prosrc like '%p_table = ''message_requests''%'
       then 'FAIL - the carve-out is still in _dm_write_floor'
       else 'PASS' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname = '_dm_write_floor';


-- -----------------------------------------------------------------------------
-- 10b. The narrow delete RPC exists, is SECURITY DEFINER, and is super_admin
--      gated.  Expected: 1 row, PASS.
-- -----------------------------------------------------------------------------
select
  '10b. narrow request delete' as check,
  case
    when p.oid is null then 'FAIL - admin_delete_message_request missing'
    when not p.prosecdef then 'FAIL - not SECURITY DEFINER'
    when p.prosrc not like '%_admin_guard_super%' then 'FAIL - not super_admin gated'
    else 'PASS'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname = 'admin_delete_message_request';


-- -----------------------------------------------------------------------------
-- 10c. The narrow delete RPC never touches the message body.
--      Expected: 1 row, PASS.
-- -----------------------------------------------------------------------------
-- The body column is `message`. The function must not select it, must not build
-- a whole-row snapshot, and must pass null for before_data/after_data.
--
-- COMMENTS ARE STRIPPED FIRST. The function body documents *why* it avoids
-- to_jsonb and `select *`, so matching raw prosrc flags the function's own
-- explanation and reports a false FAIL. (It did exactly that on the first dev
-- run — the deployed function was correct; this query was not.) Only executable
-- lines are searched.
with src as (
  select p.proname,
         (select string_agg(line, chr(10))
            from unnest(string_to_array(p.prosrc, chr(10))) as line
           where btrim(line) not like '--%') as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.proname = 'admin_delete_message_request'
)
select
  '10c. no body in delete RPC' as check,
  case
    when body is null                    then 'FAIL - function not found'
    when body ~* '\mmr\.message\M'       then 'FAIL - selects the message body'
    when body ~* 'to_jsonb'              then 'FAIL - builds a row snapshot'
    when body ~* 'select\s+\*'           then 'FAIL - selects all columns'
    when body !~* 'jsonb_build_object'   then 'FAIL - no explicit metadata object'
    else 'PASS'
  end as result
from src;


-- -----------------------------------------------------------------------------
-- 10d. moderation_audit_log: no write grants, and no SELECT on the snapshot
--      columns.  Expected: zero rows.
-- -----------------------------------------------------------------------------
-- Any row here is a live exposure: either a client role can write the audit
-- trail, or it can read before_data / after_data / ip, which is where retained
-- DM plaintext lives.
select
  '10d. audit log grant' as check,
  g.grantee,
  g.privilege_type,
  coalesce(g.column_name, '(table-level)') as column_name
from (
  select grantee, privilege_type, null::text as column_name
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'moderation_audit_log'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  union all
  select grantee, privilege_type, column_name
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'moderation_audit_log'
     and grantee in ('anon', 'authenticated')
     and privilege_type = 'SELECT'
     and column_name in ('before_data', 'after_data', 'ip')
) g;


-- -----------------------------------------------------------------------------
-- 10e. The columns /admin/audit and /admin/broadcast actually read are still
--      granted.  Expected: 8 rows, all PASS.
-- -----------------------------------------------------------------------------
-- The mirror of 10d: proves the allowlist did not over-revoke and break the
-- audit UI. This is the check that would have caught the 0082/0083 mistake.
select
  '10e. audit log readable' as check,
  c.name,
  case when exists (
    select 1 from information_schema.column_privileges cp
    where cp.table_schema = 'public' and cp.table_name = 'moderation_audit_log'
      and cp.grantee = 'authenticated' and cp.privilege_type = 'SELECT'
      and cp.column_name = c.name
  ) then 'PASS' else 'FAIL - /admin/audit will break' end as result
from (values
  ('id'), ('actor_id'), ('action'), ('target_type'),
  ('target_id'), ('reason'), ('metadata'), ('created_at')
) as c(name);


-- -----------------------------------------------------------------------------
-- 10f. The database browser refuses the audit log too.  Expected: 1 row, PASS.
-- -----------------------------------------------------------------------------
-- admin_table_rows is SECURITY DEFINER, so it bypasses the column grants in
-- 10d entirely and would return whole rows including before_data.
select
  '10f. browser denies audit log' as check,
  case when 'moderation_audit_log' = any (public._admin_browser_read_denied_tables())
       then 'PASS' else 'FAIL - browser can still page through before_data' end as result;


-- -----------------------------------------------------------------------------
-- 10g. HISTORIC RESIDUE — measure before deciding. Not a pass/fail gate.
-- -----------------------------------------------------------------------------
-- Run this on EVERY environment. The dev project returned 1 row for
-- content.delete:message on 2026-08-29; production must be measured separately.
-- See section 4 of migration 0164 for the three remediation options. Do not
-- delete anything without an owner decision.
select
  '10g. retained snapshots' as check,
  action,
  count(*) as rows_with_before_data,
  min(created_at) as oldest,
  max(created_at) as newest
from public.moderation_audit_log
where before_data is not null
group by action
order by 3 desc;


-- =============================================================================
-- 11. BEHAVIOURAL - message_requests is sealed against the generic RPCs.
--     Writes nothing: every call is expected to raise. Run as super_admin.
-- =============================================================================
do $$
begin
  begin
    perform public.admin_update_row('message_requests', 'id',
      '00000000-0000-0000-0000-000000000000', '{"status": "pending"}'::jsonb);
    raise notice 'FAIL 11a - admin_update_row still reaches message_requests';
  exception when others then
    raise notice 'PASS 11a - admin_update_row refused (%)', sqlerrm;
  end;

  begin
    perform public.admin_delete_row('message_requests', 'id',
      '00000000-0000-0000-0000-000000000000');
    raise notice 'FAIL 11b - admin_delete_row still reaches message_requests';
  exception when others then
    raise notice 'PASS 11b - admin_delete_row refused (%)', sqlerrm;
  end;

  begin
    perform public.admin_insert_row('message_requests', '{}'::jsonb);
    raise notice 'FAIL 11c - admin_insert_row still reaches message_requests';
  exception when others then
    raise notice 'PASS 11c - admin_insert_row refused (%)', sqlerrm;
  end;

  begin
    perform public.admin_browser_table_rows('message_requests', 1, 0, null, null, 'asc');
    raise notice 'FAIL 11d - the browser can still read message_requests';
  exception when others then
    raise notice 'PASS 11d - browser read refused (%)', sqlerrm;
  end;

  -- The narrow replacement must still work. This id does not exist, so the
  -- expected outcome is the function's own 'message request not found' - which
  -- proves it got past the super_admin guard and ran its lookup.
  begin
    perform public.admin_delete_message_request('00000000-0000-0000-0000-000000000000');
    raise notice 'FAIL 11e - deleted a nonexistent request?';
  exception when others then
    if sqlerrm like '%not found%' then
      raise notice 'PASS 11e - narrow delete RPC reachable and working';
    else
      raise notice 'FAIL 11e - narrow delete RPC failed unexpectedly (%)', sqlerrm;
    end if;
  end;
end $$;
