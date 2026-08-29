-- =============================================================================
-- FAST SOCIO — Contain historic DM plaintext inside the audit log
--
-- WHY
-- Migrations 0160/0163 stopped NEW private message content from reaching
-- moderation_audit_log.before_data. They did nothing about what is already
-- there, and the old paths ran for months:
--
--   * admin_delete_content('message')   snapshotted the whole message row
--   * admin_delete_row('messages', ...) same, via the database browser
--   * admin_delete_row('message_requests', ...) same, for opening messages
--
-- Measured on the dev project (2026-08-29): 464 audit rows, 12 with non-null
-- before_data, of which exactly ONE is action = 'content.delete:message' — one
-- retained plaintext DM body. Production will differ and must be measured
-- separately with the query in section 4.
--
-- NOTHING IS DELETED HERE. Destroying audit rows is a retention decision with a
-- named owner, not something a migration should do quietly. This migration
-- CONTAINS the exposure — it closes every route by which an admin can read
-- those columns — and section 4 documents the remediation options for the data
-- itself.
--
-- WHAT WAS ACTUALLY OPEN (measured, not assumed)
--   1. `authenticated` and `anon` held SELECT, INSERT, UPDATE and DELETE on
--      moderation_audit_log. Only the absence of RLS policies stopped writes.
--      Migration 0149's own reasoning applies: "an audit trail a privileged
--      user can rewrite is not an audit trail." Relying on RLS alone for that
--      is exactly the pattern this project keeps getting bitten by.
--   2. The RLS SELECT policy is `using (is_admin(auth.uid()))` at ROW level, so
--      any admin could read before_data / after_data over PostgREST — including
--      that retained DM body. /admin/audit never renders those columns, so the
--      exposure was invisible from the UI.
--   3. admin_browser_table_rows() would happily page through the table. It is
--      SECURITY DEFINER, so it bypasses the column grants added below; it needs
--      its own denial.
--
-- WHY A COLUMN ALLOWLIST IS SAFE HERE
-- Migration 0082 tried a column-level SELECT restriction on `profiles` and 0083
-- had to revert it, because Postgres requires table-level SELECT for
-- INSERT ... ON CONFLICT DO UPDATE and the onboarding upsert broke. That hazard
-- does not exist here: `authenticated` never writes this table at all — every
-- writer is a SECURITY DEFINER function running as the owner, which is
-- unaffected by these grants. The two readers
-- (/admin/audit, /admin/broadcast) select explicit column lists that are
-- subsets of the allowlist below.
--
-- APPLY ORDER: after 0163.
--
-- ROLLBACK
--   grant select on public.moderation_audit_log to authenticated, anon;
-- and restore 0163's _admin_browser_read_denied_tables body. Nothing else to
-- undo; no data is modified.
-- =============================================================================

set check_function_bodies = off;


-- -----------------------------------------------------------------------------
-- 1. Take away write access that should never have existed.
-- -----------------------------------------------------------------------------
-- log_admin_action() and every other writer is SECURITY DEFINER and runs as the
-- table owner, so this removes nothing any legitimate caller uses. It removes
-- the ability of a client holding an anon or user JWT to attempt a write at
-- all, instead of depending on "there is no policy for that" to stop them.
revoke insert, update, delete on public.moderation_audit_log from authenticated, anon;


-- -----------------------------------------------------------------------------
-- 2. Column allowlist for SELECT: everything except the row snapshots.
-- -----------------------------------------------------------------------------
-- before_data / after_data are the columns that can contain a copy of a deleted
-- row — a DM body, a message request's opening line, a profile. after_data is
-- included in the restriction because admin_update_row writes it and the same
-- argument applies.
--
-- `ip` is also withheld. It is not DM content, but it is the acting admin's
-- source address, nothing reads it, and there is no reason for it to travel to
-- a browser. (Note: `ip` exists in the live database but not in the repo's
-- migration for this table — schema drift, added out of band. Named explicitly
-- here so this migration is correct against the database as it actually is.)
revoke select on public.moderation_audit_log from authenticated, anon;

grant select (
  id,
  actor_id,
  action,
  target_type,
  target_id,
  reason,
  metadata,
  created_at
) on public.moderation_audit_log to authenticated;

-- anon gets nothing: the RLS policy already requires is_admin(), and an
-- unauthenticated caller has no business reading the moderation trail.


-- -----------------------------------------------------------------------------
-- 3. Deny the database browser, which bypasses the grants above.
-- -----------------------------------------------------------------------------
-- admin_browser_table_rows -> admin_table_rows is SECURITY DEFINER, so it reads
-- as the owner and column grants do not constrain it. It returns whole rows, so
-- there is no partial protection available: the table has to be off-limits to
-- the generic browser. /admin/audit remains the surface for reading the trail,
-- and it renders only the allowlisted columns.
create or replace function public._admin_browser_read_denied_tables()
returns text[] language sql immutable as $$
  select public._dm_protected_tables() || array['moderation_audit_log']::text[]
$$;

create or replace function public._admin_browser_read_guard(p_table text)
returns void language plpgsql stable as $$
begin
  if p_table = any (public._admin_browser_read_denied_tables()) then
    raise exception
      'the database browser cannot read %: this table holds private message content, moderation evidence, or retained row snapshots',
      p_table
      using hint = 'DM content is disclosed only through a participant report at /admin/dm-reports. The moderation trail is at /admin/audit.';
  end if;
end $$;

revoke execute on function public._admin_browser_read_denied_tables() from public, anon, authenticated;
revoke execute on function public._admin_browser_read_guard(text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. THE RETENTION DECISION — required, not made here.
-- -----------------------------------------------------------------------------
-- After sections 1-3 the retained plaintext is unreachable through the
-- application and through PostgREST. It is still on disk, still in backups, and
-- still readable by anyone with database credentials. Deciding what happens to
-- it is an owner decision. Measure first:
--
--   select id, action, actor_id, target_id, created_at
--     from public.moderation_audit_log
--    where before_data is not null
--      and (action like 'content.delete:message'
--        or action in ('db.delete:messages', 'db.delete:message_requests'))
--    order by created_at;
--
-- Three options, in increasing order of destructiveness:
--
--   A. LEAVE AS IS. Sections 1-3 make it unreadable in-product. Defensible if
--      the retention policy already covers moderation records. Requires no
--      further action, and the exposure persists in backups indefinitely.
--
--   B. REDACT THE SNAPSHOT, KEEP THE RECORD. Preferred. Preserves the fact of
--      the action, its actor and its timestamp; removes only the copied body:
--
--        update public.moderation_audit_log
--           set before_data = jsonb_build_object(
--                 '_redacted', true,
--                 '_redacted_at', now(),
--                 'id', before_data->'id',
--                 'conversation_id', before_data->'conversation_id',
--                 'sender_id', before_data->'sender_id',
--                 'created_at', before_data->'created_at')
--         where before_data is not null
--           and action like 'content.delete:message';
--
--      NOTE this is an UPDATE against the audit table and will be refused
--      through every application path by design. Run it in the Supabase SQL
--      editor as the owner, once, with the row count reviewed first.
--
--   C. DELETE THE ROWS. Not recommended: it destroys the record that a
--      moderator deleted a user's message, which is the accountability the log
--      exists to provide.
--
-- RECOMMENDATION: option B, after confirming the production count. Backups
-- containing the pre-redaction value age out on the provider's schedule; if the
-- retention policy requires more than that, it is a separate piece of work.
-- =============================================================================
