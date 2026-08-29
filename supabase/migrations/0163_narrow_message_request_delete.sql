-- =============================================================================
-- FAST SOCIO — Close the message_requests privacy gap (Phase 2 follow-up)
--
-- WHAT WAS STILL OPEN
-- message_requests.message is the opening line of a DM: private user text,
-- 1-500 chars, written by one student to another before a conversation exists.
-- Migration 0162 put message_requests on the READ protected list but carved it
-- OUT of the write floor, because /admin/matching deletes these rows as a
-- working, audited feature and blocking that would have broken it.
--
-- That carve-out left two exposures:
--
--   1. admin_delete_row('message_requests', 'id', <uuid>) captures to_jsonb(t)
--      of the row into moderation_audit_log.before_data before deleting it. So
--      every deletion minted a permanent plaintext copy of a private opening
--      message inside the audit trail — the same anti-pattern migration 0160
--      removed from admin_delete_content('message').
--
--   2. admin_update_row('message_requests', ...) RETURNS the row it writes, so
--      a no-op update was a read of that message text. The carve-out let it
--      through.
--
-- THE FIX
-- Stop carving anything out. message_requests joins the other DM tables under
-- the full floor: no generic read, insert, update or delete. The legitimate
-- feature is then re-provided by a narrow, purpose-built function that does one
-- thing, deletes one row, and audits SAFE METADATA ONLY.
--
-- admin_delete_message_request(p_id) records the request id, sender, recipient,
-- status and timestamps. It never selects, returns, or logs `message`. That is
-- the whole point: the audit trail should record THAT a request was removed and
-- BY WHOM, not reproduce what the student wrote.
--
-- WHY super_admin, NOT is_admin
-- /admin/matching is already a super_admin-only page (requireSuperAdmin), and
-- deleting a message request is a destructive action on user data with no
-- report behind it. Matching the existing gate rather than widening it.
--
-- HISTORIC DATA
-- This stops NEW plaintext from reaching the audit log. It does not touch rows
-- already written by the old path. Purging those is a retention decision that
-- needs an explicit owner sign-off; the query to find them and the options are
-- documented in docs/DM-SELECTIVE-REPORTING-DESIGN.md. Nothing is deleted here.
--
-- APPLY ORDER: after 0162. Additive: adds one function, replaces one guard.
--
-- ROLLBACK
--   drop function if exists public.admin_delete_message_request(uuid);
-- and restore 0162's _dm_write_floor body (the version with the
-- `if p_table = 'message_requests' then return; end if;` carve-out), then point
-- src/app/admin/matching/actions.ts back at admin_delete_row. Doing so
-- reintroduces both exposures above.
-- =============================================================================

set check_function_bodies = off;


-- -----------------------------------------------------------------------------
-- 1. Remove the carve-out: message_requests is fully protected now.
-- -----------------------------------------------------------------------------
-- Identical to 0162 minus the early return. Every table in
-- _dm_protected_tables() is now off-limits to all three generic row RPCs, for
-- every operation, regardless of caller — the browser wrappers, the dedicated
-- admin actions, or a direct PostgREST call.
create or replace function public._dm_write_floor(p_table text, p_op text)
returns void language plpgsql stable as $$
begin
  if p_table = any (public._dm_protected_tables()) then
    raise exception
      'the generic row RPCs cannot % %: private message content and report evidence are not editable through a row editor',
      p_op, p_table
      using hint = 'Use the purpose-built action: admin_delete_message_request() for a request, or the report-scoped action at /admin/dm-reports for a DM. Report evidence is immutable by design.';
  end if;
end $$;

revoke execute on function public._dm_write_floor(text, text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. The narrow replacement.
-- -----------------------------------------------------------------------------
-- Deletes exactly one message request and writes an audit row containing only
-- routing metadata. `message` is never read into a variable, never returned and
-- never logged — there is no code path in this function that touches it.
create or replace function public.admin_delete_message_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sender    uuid;
  v_recipient uuid;
  v_status    text;
  v_created   timestamptz;
begin
  perform public._admin_guard_super();

  -- Column list is explicit and deliberate. `select to_jsonb(t)` or `select *`
  -- here would pull the message body into memory and, one careless edit later,
  -- into the audit metadata. Naming the five safe columns makes that mistake
  -- require a visible change to this line.
  select mr.sender_id, mr.recipient_id, mr.status::text, mr.created_at
    into v_sender, v_recipient, v_status, v_created
    from public.message_requests mr
   where mr.id = p_id;

  if v_sender is null then
    raise exception 'message request not found';
  end if;

  delete from public.message_requests where id = p_id;

  -- before_data / after_data are deliberately null. log_admin_action() would
  -- happily store a row snapshot in before_data; that is exactly what this
  -- function exists to avoid.
  perform public.log_admin_action(
    'matching.delete_request',
    null,
    p_id,
    null,
    null,
    jsonb_build_object(
      'request_id',   p_id,
      'sender_id',    v_sender,
      'recipient_id', v_recipient,
      'status',       v_status,
      'created_at',   v_created,
      'deleted_at',   now()
    ));
end $$;

revoke execute on function public.admin_delete_message_request(uuid) from public, anon;
grant execute on function public.admin_delete_message_request(uuid) to authenticated;

comment on function public.admin_delete_message_request(uuid) is
  'Narrow super_admin delete for one message request. Audits routing metadata only - never the message body. Replaces admin_delete_row(message_requests). See migration 0163.';
