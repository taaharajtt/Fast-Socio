-- =============================================================================
-- FAST SOCIO — Constrain the admin database browser's mutation surface
--
-- PROBLEM
-- Migration 0038 gave the /admin/database browser three generic mutation RPCs:
-- admin_update_row, admin_insert_row and admin_delete_row. Their dynamic SQL is
-- injection-safe (identifiers via %I, literals via %L) and every call is
-- audited, so the weakness is not injection — it is REACH. They are SECURITY
-- DEFINER, so they run as the table owner and therefore:
--
--   * bypass RLS entirely, and
--   * bypass column-level GRANTs (so the profiles allowlist from 0084 does not
--     apply), and
--   * bypass protect_profile_columns(), because that trigger only fires its
--     guard when `current_user = 'authenticated'` (0080) and here current_user
--     is the definer.
--
-- Net effect: a super_admin editing a row in the generic table browser can set
-- profiles.admin_role, is_banned, verified, aura_score, xp — the exact columns
-- the 2026-07-15 takeover abused and that migrations 0080/0084 were written to
-- lock down — and can also edit or delete rows in the audit trail that is
-- supposed to record what they did. Every one of those columns already has a
-- dedicated, purpose-built, audited action (setUserRole, setVerified,
-- admin_set_ban, admin_adjust_aura, set_shadow_ban, issue_strike). The generic
-- browser is a redundant second path to them with weaker semantics.
--
-- WHY NOT JUST ADD A DENYLIST TO admin_update_row
-- Because the dedicated actions call it too. src/app/admin/users/actions.ts
-- routes setUserRole (profiles.admin_role) and setVerified (profiles.verified)
-- through admin_update_row precisely because it is the audited writer, and
-- src/app/admin/{communities,events,matching}/actions.ts call admin_delete_row
-- for their own tables. Denylisting inside those functions would break all of
-- those working, intentional, audited features.
--
-- FIX
-- Add three *browser-only* wrappers that apply a policy and then delegate to the
-- existing functions, and point only src/app/admin/database/actions.ts at them.
-- The dedicated admin actions keep calling the unrestricted functions directly,
-- so their behaviour is unchanged. The result is the property we actually want:
--
--     the database browser is a browser, not a SQL console.
--
-- The policy is hardcoded in the guard function ON PURPOSE. Storing it in a
-- table would be self-defeating: the browser could then edit the table that
-- says what the browser may edit. Changing the policy requires a migration and
-- a code review, which is the point.
--
-- This migration adds functions only. It does not alter, drop or weaken
-- anything that exists, so it is safe to re-run and safe to roll back by
-- reverting the application code to call the unwrapped RPCs.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Policy: tables the browser may never insert into, update or delete from.
-- -----------------------------------------------------------------------------
-- These are the evidence and session tables. The common thread is that writing
-- them from a general-purpose row editor either destroys the record of an
-- action or silently changes a security decision:
--
--   moderation_audit_log  the admin audit trail. log_admin_action() writes it;
--                         nothing should edit it after the fact. An audit trail
--                         a privileged user can rewrite is not an audit trail.
--   security_events       same argument, for the security-event stream.
--   rate_limit_events     the limiter's state. Deleting rows here resets any
--                         limit for anyone, invisibly.
--   user_sessions         session records; editing them is a session-fixation
--                         primitive, not an administrative task.
--   profile_private       the private-PII sidecar. No admin workflow edits it.
--   push_subscriptions    user-owned device endpoints. Writing them means
--                         sending push to a device on someone else's behalf.
--
create or replace function public._admin_browser_denied_tables()
returns text[] language sql immutable as $$
  select array[
    'moderation_audit_log',
    'security_events',
    'rate_limit_events',
    'user_sessions',
    'profile_private',
    'push_subscriptions'
  ]::text[]
$$;

-- -----------------------------------------------------------------------------
-- Policy: profiles columns the browser may never write.
-- -----------------------------------------------------------------------------
-- Every column here is privileged state with its own audited writer. Listing
-- them is not a denylist in the fragile sense that 0084's comment warns about,
-- because it is not the only guard — it is the browser-specific layer on top of
-- the column GRANT allowlist (0084) and the protect trigger (0080), both of
-- which still cover the ordinary authenticated path.
create or replace function public._admin_browser_denied_profile_columns()
returns text[] language sql immutable as $$
  select array[
    'id',                        -- repointing a profile at another auth user
    'admin_role',                -- -> setUserRole (admin_update_row, audited)
    'is_admin',                  -- derived from admin_role by trigger
    'is_banned',                 -- -> admin_set_ban (requires a reason)
    'verified',                  -- -> setVerified
    'shadow_banned',             -- -> set_shadow_ban
    'suspended_until',           -- -> issue_strike / decide_appeal
    'posting_restricted_until',  -- -> issue_strike / decide_appeal
    'aura_score',                -- -> admin_adjust_aura (requires a reason)
    'xp',
    'level'
  ]::text[]
$$;

-- -----------------------------------------------------------------------------
-- The guard itself.
-- -----------------------------------------------------------------------------
-- p_op is 'insert' | 'update' | 'delete'. p_row is the payload for insert and
-- update (null for delete) and is inspected for denied column keys.
--
-- Raises on denial. Errors are deliberately specific: the caller is a
-- super_admin looking at an admin console, so telling them exactly which column
-- is refused and where to do it instead is useful, not a disclosure risk.
create or replace function public._admin_browser_guard(
  p_table text,
  p_op text,
  p_row jsonb default null
) returns void language plpgsql stable as $$
declare
  v_col text;
begin
  if p_table = any (public._admin_browser_denied_tables()) then
    raise exception
      'the database browser cannot % rows in %: this table is append-only evidence or session state',
      p_op, p_table
      using hint = 'Use the dedicated admin action, or the Supabase dashboard SQL editor if this is a genuine one-off.';
  end if;

  if p_table = 'profiles' then
    -- A profiles row exists because handle_new_user() created it from an
    -- auth.users insert. One created here would have no matching auth user.
    if p_op = 'insert' then
      raise exception 'the database browser cannot insert profiles rows'
        using hint = 'Profiles are created by the handle_new_user() trigger when an auth user signs up.';
    end if;

    -- Deleting a profile cascades across the entire social graph (posts,
    -- messages, matches, aura) with only one audit row to show for it.
    if p_op = 'delete' then
      raise exception 'the database browser cannot delete profiles rows'
        using hint = 'Use the ban action, or the account-deletion flow, so the removal is recorded and reversible.';
    end if;

    if p_row is not null then
      foreach v_col in array public._admin_browser_denied_profile_columns() loop
        if p_row ? v_col then
          raise exception 'the database browser cannot write profiles.%', v_col
            using hint = 'This column has a dedicated audited admin action; use that instead.';
        end if;
      end loop;
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- The browser-facing wrappers. Guard, then delegate unchanged.
-- -----------------------------------------------------------------------------
-- The super_admin check, the table-exists check, the dynamic SQL and the audit
-- write all still happen exactly once, inside the delegate. These wrappers add
-- policy and nothing else.

create or replace function public.admin_browser_update_row(
  p_table text, p_pk_col text, p_pk_val text, p_row jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_guard_super();
  perform public._admin_browser_guard(p_table, 'update', p_row);
  return public.admin_update_row(p_table, p_pk_col, p_pk_val, p_row);
end $$;

create or replace function public.admin_browser_insert_row(p_table text, p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_guard_super();
  perform public._admin_browser_guard(p_table, 'insert', p_row);
  return public.admin_insert_row(p_table, p_row);
end $$;

create or replace function public.admin_browser_delete_row(
  p_table text, p_pk_col text, p_pk_val text
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_guard_super();
  perform public._admin_browser_guard(p_table, 'delete', null);
  perform public.admin_delete_row(p_table, p_pk_col, p_pk_val);
end $$;

-- The guard helpers are internal. They are not SECURITY DEFINER and leak
-- nothing, but there is no reason for a client to call them.
revoke execute on function public._admin_browser_guard(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._admin_browser_denied_tables() from public, anon, authenticated;
revoke execute on function public._admin_browser_denied_profile_columns() from public, anon, authenticated;

-- Postgres grants EXECUTE to PUBLIC by default, and Supabase's default
-- privileges additionally grant it to anon. Every admin_* RPC from 0038
-- inherited that and is anon-executable today, relying on _admin_guard_super()
-- to raise for a caller with no auth.uid(). That is sound but it is one guard
-- deep, so these new functions do not repeat it: an anonymous caller has no
-- business reaching an admin mutation entry point at all.
revoke execute on function public.admin_browser_update_row(text, text, text, jsonb) from public, anon;
revoke execute on function public.admin_browser_insert_row(text, jsonb) from public, anon;
revoke execute on function public.admin_browser_delete_row(text, text, text) from public, anon;

grant execute on function public.admin_browser_update_row(text, text, text, jsonb) to authenticated;
grant execute on function public.admin_browser_insert_row(text, jsonb) to authenticated;
grant execute on function public.admin_browser_delete_row(text, text, text) to authenticated;

comment on function public.admin_browser_update_row(text, text, text, jsonb) is
  'Policy-constrained wrapper over admin_update_row for the /admin/database browser. See migration 0149.';
comment on function public.admin_browser_insert_row(text, jsonb) is
  'Policy-constrained wrapper over admin_insert_row for the /admin/database browser. See migration 0149.';
comment on function public.admin_browser_delete_row(text, text, text) is
  'Policy-constrained wrapper over admin_delete_row for the /admin/database browser. See migration 0149.';
