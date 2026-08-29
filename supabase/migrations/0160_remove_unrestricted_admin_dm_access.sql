-- =============================================================================
-- FAST SOCIO — Remove unrestricted admin access to one-to-one DMs (Phase 2)
--
-- WHAT THIS IS NOT
-- This migration does NOT make direct messages end-to-end encrypted. Bodies
-- stay in public.messages as plaintext. Anyone holding database credentials —
-- the Supabase project owner, the service-role key, a DBA, a backup, a replica
-- — can still read every DM. What changes here is that the APPLICATION no
-- longer offers a way to do it. That removes casual, in-product, one-click
-- access by any moderator, which is worth doing on its own; it is not a
-- cryptographic guarantee and must not be described as one.
--
-- WHAT IT REMOVES
-- Migration 0040 gave moderators four unrestricted routes into private DMs:
--
--   1. admin_dm_conversations()  — a directory of every conversation in the
--      product, searchable by participant name.
--   2. admin_dm_messages()       — the COMPLETE transcript of any conversation
--      by id. It logged a `dm.view` audit row, so it was audited; it was never
--      restricted. An audited open door is still an open door.
--   3. admin_content_feed('message') — the widest of the four and the least
--      obvious: a global, paginated, full-text-searchable feed of every DM body
--      in the product. `p_search` ran `messages.body ilike '%…%'` with no
--      conversation scoping whatsoever.
--   4. admin_delete_content('message') / admin_set_content_hidden('message') —
--      hide or hard-delete an arbitrary DM with no report behind it. Worse,
--      the delete branch snapshotted the entire row, body included, into
--      moderation_audit_log.before_data, minting a second plaintext copy of a
--      private message inside the audit trail.
--
-- All four are removed. Moderators keep aggregate counts (the /admin/users
-- footprint tile) and the report-scoped evidence workflow added in 0161. They
-- no longer have any route to a message body that a participant did not
-- deliberately disclose.
--
-- The `message` branch of admin_content_feed is replaced with an explicit
-- raise, not a silent empty result, so a caller that still asks for it fails
-- loudly instead of appearing to work.
--
-- ALSO: the database browser could always READ what it could not write.
-- Migration 0149 constrained the /admin/database browser's mutations and
-- deliberately left reads alone. That leaves admin_table_rows('messages') as a
-- perfectly good DM browser for a super_admin — the exact capability the rest
-- of this migration removes. A read guard and an admin_browser_table_rows
-- wrapper close it, following 0149's pattern: policy in a wrapper, delegate
-- unchanged, point only the browser page at the wrapper.
--
-- ROLLBACK
-- Additive except for the four drops. To restore the previous behaviour,
-- re-run migration 0040 (it is written as CREATE OR REPLACE and will restore
-- admin_content_feed / admin_set_content_hidden / admin_delete_content with
-- their message branches, and recreate both admin_dm_* functions), then revert
-- the application code to call admin_table_rows directly. Nothing here drops a
-- table, a column, or a row: no message, conversation or audit record is
-- touched. Re-running this migration is safe.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the two dedicated DM-browsing RPCs, and revoke first.
-- -----------------------------------------------------------------------------
-- The revoke is redundant before a drop, but it is written explicitly so that
-- the intent survives in the migration history and so this file still does the
-- right thing if a future environment has one of them recreated out of band.
revoke execute on function public.admin_dm_conversations(text, int, int)
  from public, anon, authenticated;
revoke execute on function public.admin_dm_messages(uuid)
  from public, anon, authenticated;

drop function if exists public.admin_dm_conversations(text, int, int);
drop function if exists public.admin_dm_messages(uuid);


-- -----------------------------------------------------------------------------
-- 2. admin_content_feed: remove the 'message' branch.
-- -----------------------------------------------------------------------------
-- Identical to 0040 except that `p_type = 'message'` now raises. Post, comment
-- and community branches are unchanged — community/event/society chat is a
-- group surface, explicitly out of scope for this work, and keeps its feed.
create or replace function public.admin_content_feed(
  p_type text, p_search text default null, p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_q text := '%' || coalesce(p_search, '') || '%';
  v_rows jsonb; v_total bigint;
begin
  perform public._admin_guard();

  if p_type = 'message' then
    raise exception 'one-to-one DM content is not browsable'
      using hint = 'Private messages are disclosed only through a participant report. See /admin/dm-reports.';
  end if;

  if p_type = 'post' then
    select count(*) into v_total from posts p where (p_search is null or p.body ilike v_q);
    select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_rows from (
      select p.created_at as ts, jsonb_build_object(
        'id', p.id, 'author_id', p.author_id,
        'author', case when p.is_anonymous then 'Anonymous' else coalesce(pr.full_name, '—') end,
        'body', p.body, 'created_at', p.created_at, 'hidden', p.hidden,
        'context', coalesce(c.name, 'Feed'),
        'extra', jsonb_build_object('likes', p.like_count, 'comments', p.comment_count, 'moderation', p.moderation_status)
      ) x
      from posts p
      left join profiles pr on pr.id = p.author_id
      left join communities c on c.id = p.community_id
      where (p_search is null or p.body ilike v_q)
      order by p.created_at desc limit v_lim offset v_off
    ) q;

  elsif p_type = 'comment' then
    select count(*) into v_total from post_comments pc where (p_search is null or pc.body ilike v_q);
    select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_rows from (
      select pc.created_at as ts, jsonb_build_object(
        'id', pc.id, 'author_id', pc.author_id, 'author', coalesce(pr.full_name, '—'),
        'body', pc.body, 'created_at', pc.created_at, 'hidden', pc.hidden,
        'context', 'post ' || left(pc.post_id::text, 8), 'extra', '{}'::jsonb
      ) x
      from post_comments pc
      left join profiles pr on pr.id = pc.author_id
      where (p_search is null or pc.body ilike v_q)
      order by pc.created_at desc limit v_lim offset v_off
    ) q;

  elsif p_type = 'community' then
    select count(*) into v_total from community_chat_messages cm where (p_search is null or cm.body ilike v_q);
    select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_rows from (
      select cm.created_at as ts, jsonb_build_object(
        'id', cm.id, 'author_id', cm.sender_id, 'author', coalesce(pr.full_name, '—'),
        'body', cm.body, 'created_at', cm.created_at, 'hidden', false,
        'context', coalesce(c.name, '—'), 'extra', '{}'::jsonb
      ) x
      from community_chat_messages cm
      left join profiles pr on pr.id = cm.sender_id
      left join communities c on c.id = cm.community_id
      where (p_search is null or cm.body ilike v_q)
      order by cm.created_at desc limit v_lim offset v_off
    ) q;
  else
    raise exception 'unknown content type: %', p_type;
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_lim, 'offset', v_off);
end $$;


-- -----------------------------------------------------------------------------
-- 3. admin_set_content_hidden / admin_delete_content: remove the 'message' branch.
-- -----------------------------------------------------------------------------
-- Acting on a DM now requires a report behind it. Two paths remain, both
-- report-scoped and both audited:
--   * moderate_report(), unchanged, which hides the reported target when a
--     report is actioned. It inlines its own `update messages set hidden`, so
--     it does not depend on the branch removed here.
--   * admin_dm_report_hide_message() from migration 0161, which refuses to act
--     on a message that is not evidence in the report being worked.
create or replace function public.admin_set_content_hidden(p_type text, p_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_guard();
  if p_type = 'post' then update posts set hidden = p_hidden where id = p_id;
  elsif p_type = 'comment' then update post_comments set hidden = p_hidden where id = p_id;
  elsif p_type = 'message' then
    raise exception 'a one-to-one DM cannot be moderated outside a report'
      using hint = 'Use the report-scoped action on the case at /admin/dm-reports.';
  else raise exception 'cannot hide content type: %', p_type;
  end if;
  perform public.log_admin_action(
    (case when p_hidden then 'content.hide:' else 'content.unhide:' end) || p_type,
    null, p_id, null, null, jsonb_build_object('type', p_type));
end $$;

create or replace function public.admin_delete_content(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform public._admin_guard();
  if p_type = 'post' then
    select to_jsonb(t) into v_before from posts t where id = p_id;
    delete from posts where id = p_id;
  elsif p_type = 'comment' then
    select to_jsonb(t) into v_before from post_comments t where id = p_id;
    delete from post_comments where id = p_id;
  elsif p_type = 'message' then
    -- Deliberately no branch. Besides being an unrestricted delete, the
    -- before-snapshot below would write the message body into the audit log.
    raise exception 'a one-to-one DM cannot be deleted from the content browser'
      using hint = 'Use the report-scoped action on the case at /admin/dm-reports.';
  elsif p_type = 'community' then
    select to_jsonb(t) into v_before from community_chat_messages t where id = p_id;
    delete from community_chat_messages where id = p_id;
  else raise exception 'unknown content type: %', p_type;
  end if;
  perform public.log_admin_action('content.delete:' || p_type, null, p_id, v_before, null,
    jsonb_build_object('type', p_type));
end $$;


-- -----------------------------------------------------------------------------
-- 4. Close the database browser's READ path to DM content and report evidence.
-- -----------------------------------------------------------------------------
-- 0149 guarded insert/update/delete and left select alone, so
-- admin_table_rows('messages') remained a fully functional DM browser with
-- ilike search across every text column — including body. These tables carry
-- private message content or moderation evidence and have purpose-built,
-- audited surfaces; the generic row browser is a second path around both.
--
-- As in 0149 the policy is hardcoded on purpose: a table listing which tables
-- the browser may not read would itself be readable and editable by the
-- browser.
create or replace function public._admin_browser_read_denied_tables()
returns text[] language sql immutable as $$
  select array[
    'messages',            -- one-to-one DM bodies and attachment paths
    'conversations',       -- the DM participant graph
    'message_reactions',   -- per-message, reveals which DMs exist and to whom
    'dm_report_cases',     -- report metadata; read via the audited RPC
    'dm_report_messages'   -- disclosed evidence; read via the audited RPC
  ]::text[]
$$;

create or replace function public._admin_browser_read_guard(p_table text)
returns void language plpgsql stable as $$
begin
  if p_table = any (public._admin_browser_read_denied_tables()) then
    raise exception
      'the database browser cannot read %: this table holds private message content or moderation evidence',
      p_table
      using hint = 'DM content is disclosed only through a participant report at /admin/dm-reports.';
  end if;
end $$;

create or replace function public.admin_browser_table_rows(
  p_table text,
  p_limit int default 50,
  p_offset int default 0,
  p_search text default null,
  p_order_by text default null,
  p_order_dir text default 'asc'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._admin_guard_super();
  perform public._admin_browser_read_guard(p_table);
  return public.admin_table_rows(p_table, p_limit, p_offset, p_search, p_order_by, p_order_dir);
end $$;

-- Same treatment as 0149's wrappers: internal helpers stay unreachable, and the
-- wrapper itself is not exposed to anon.
revoke execute on function public._admin_browser_read_denied_tables() from public, anon, authenticated;
revoke execute on function public._admin_browser_read_guard(text) from public, anon, authenticated;
revoke execute on function public.admin_browser_table_rows(text, int, int, text, text, text)
  from public, anon;
grant execute on function public.admin_browser_table_rows(text, int, int, text, text, text)
  to authenticated;

comment on function public.admin_browser_table_rows(text, int, int, text, text, text) is
  'Read guard over admin_table_rows for the /admin/database browser: refuses DM content and report evidence. See migration 0160.';
