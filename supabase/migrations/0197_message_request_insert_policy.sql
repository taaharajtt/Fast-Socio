-- =============================================================================
-- 0197 — close the direct-INSERT path around "Disable message requests".
--
-- WHAT 0196 MISSED, found by reading the deployed policies rather than the app.
--
-- 0196 put the new check in `send_message_request`, on the stated grounds that
-- the RPC is "the only way a row reaches message_requests". That is true of the
-- APPLICATION — every call site goes through the RPC, and none of them inserts
-- directly — but it is NOT true of the DATABASE. `message_requests` carries a
-- client INSERT policy from mig 0004:
--
--   users send their own requests
--     with check (sender_id = auth.uid() and not is_blocked(sender_id, recipient_id))
--
-- so any authenticated student can POST a row straight to PostgREST and skip
-- the function entirely. That bypasses the new setting — and, for that matter,
-- the 1..250 length bound and the banned/deactivated check that have lived in
-- the RPC since 0178.
--
-- The brief is explicit that a direct Supabase or RPC call must not get past
-- the setting, so the rule has to hold at the TABLE, not only in the function.
--
-- ---------------------------------------------------------------------------
-- WHY THE POLICY IS EXTENDED RATHER THAN DROPPED
--
-- Dropping the client INSERT policy would make the definer RPC the only door,
-- which is the cleaner architecture — and a much larger blast radius than this
-- change is entitled to. Anything that inserts as `authenticated` and is not in
-- `src/` (a seed, an admin tool, a future feature) would start failing with a
-- policy violation that names nothing useful. So the policy keeps doing its
-- job and gains one conjunct.
--
-- WHY A DEFINER HELPER AND NOT A SUBQUERY. A subquery inside a policy runs as
-- the CALLER with RLS applied, so `(select disable_message_requests from
-- profiles where id = recipient_id)` returns NULL for any recipient whose
-- profile row the sender cannot read — and `not null` is null, which fails the
-- check for the wrong reason and would block legitimate requests. A SECURITY
-- DEFINER function reads the flag regardless of the caller's row visibility and
-- returns only a boolean, exactly as `is_blocked` already does in this same
-- policy.
--
-- The RPC keeps its own two checks. This is a second, independent door rather
-- than a replacement: SECURITY DEFINER runs as the owner and so does not go
-- through RLS, meaning the policy guards the direct path and the function
-- guards its own.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The predicate, as a function the policy can call.
-- ---------------------------------------------------------------------------
-- Returns TRUE when this person still takes first contact. Named positively so
-- the policy reads as a permission rather than a double negative.
--
-- It answers TRUE for an id that does not exist. That is deliberate and costs
-- nothing: a non-existent recipient fails the table's foreign key anyway, and
-- returning FALSE would make this function a way to probe which ids exist.
create or replace function public.accepts_message_requests(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce(
    (select p.disable_message_requests from public.profiles p where p.id = p_user),
    false
  );
$$;

comment on function public.accepts_message_requests(uuid) is
  'Does this user still accept NEW message requests? Definer because it is called from the message_requests INSERT policy, where a plain subquery would run under the caller''s RLS and return NULL for an unreadable profile. Returns only a boolean. See migrations 0196 and 0197.';

revoke all on function public.accepts_message_requests(uuid) from public, anon;
grant execute on function public.accepts_message_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The policy, with the setting added to what it already enforced.
-- ---------------------------------------------------------------------------
-- Carried forward verbatim from the deployed definition (read with pg_policies,
-- not copied from 0004 — the file that defines a policy is not reliably the one
-- running) with one conjunct added.
drop policy if exists "users send their own requests" on public.message_requests;

create policy "users send their own requests"
  on public.message_requests for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and not public.is_blocked(sender_id, recipient_id)
    -- ADDED (0197): the recipient's own setting, enforced at the table so a
    -- direct PostgREST insert cannot step around send_message_request().
    and public.accepts_message_requests(recipient_id)
  );

-- =============================================================================
-- VERIFY
--   -- the policy carries all three conjuncts:
--   select with_check from pg_policies
--    where tablename = 'message_requests' and cmd = 'INSERT';
--
--   -- and the helper agrees with the column:
--   select public.accepts_message_requests(id) = not disable_message_requests
--     from public.profiles limit 50;          -- every row must be true
--
--   supabase/tests/disable_message_requests.sql section 3 exercises the direct
--   INSERT path specifically.
--
-- ROLLBACK
--   drop policy "users send their own requests" on public.message_requests;
--   create policy "users send their own requests"
--     on public.message_requests for insert to authenticated
--     with check (sender_id = (select auth.uid())
--                 and not public.is_blocked(sender_id, recipient_id));
--   drop function if exists public.accepts_message_requests(uuid);
-- =============================================================================
