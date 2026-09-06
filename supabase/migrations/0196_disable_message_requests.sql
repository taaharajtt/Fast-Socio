-- =============================================================================
-- 0196 — "Disable message requests": let a student close first contact.
--
-- WHAT THIS IS
-- A privacy toggle, OFF by default, that stops people the student has NOT
-- matched with from asking to chat. It governs exactly one thing: the creation
-- of a NEW `message_requests` row. Nothing else in the product changes.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH, because "no new requests" is a much
-- narrower statement than "no messages":
--
--   * an existing match           — `get_or_create_conversation` is untouched
--   * an existing DM              — `messages` INSERT policy is untouched
--   * community and event rooms   — different tables, different policies
--   * Discover team rooms         — a `communities` row; nothing to do with this
--   * admin / system messaging    — definer paths, not this RPC
--   * PENDING requests already sent — they stay visible and actionable on both
--     sides, and the idempotent branch below still returns them, because
--     answering a request someone already sent you is not a new request.
--
-- ---------------------------------------------------------------------------
-- WHERE IT IS ENFORCED
--
-- In `send_message_request`, which is the ONLY way a row reaches
-- `message_requests`: the table has no client INSERT policy, so a student
-- cannot write one directly, and this definer function is the whole surface.
-- Hiding the profile button is a courtesy; this is the rule.
--
-- The check is made TWICE, on purpose:
--
--   1. An explicit read, straight after the block check, so the common case
--      fails fast with a message the app can map to real copy.
--   2. A predicate ON THE INSERT ITSELF, so the decision and the write happen
--      in one statement against one snapshot. A read-then-write pair can be
--      overtaken between its two halves by a recipient toggling the setting;
--      the conditional insert cannot, because a concurrent commit is either
--      visible to the statement or it is not.
--
-- Neither check replaces the other: (1) gives a good error, (2) gives the
-- guarantee.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
-- `not null default false` does both jobs the brief asks for in one statement:
-- every existing row is backfilled to false as the column is added, and every
-- future row defaults to false. There is no separate backfill to get wrong and
-- no window in which the column is null.
--
-- WHY THE POLARITY IS INVERTED from its neighbours. Every other privacy flag on
-- this table is a positive permission that defaults TRUE (`discoverable`,
-- `searchable`, `show_online`, …). This one is named for what the toggle SAYS —
-- "Disable message requests" — so that the UI switch, the column and the RPC
-- all read the same way round. A `allow_message_requests boolean default true`
-- would match the neighbours but invert against the label, which is how a
-- setting ends up meaning the opposite of what it says after one refactor.
alter table public.profiles
  add column if not exists disable_message_requests boolean not null default false;

comment on column public.profiles.disable_message_requests is
  'When true, other students cannot create NEW message requests to this user (mig 0196). Does not affect existing matches, existing conversations, pending requests, or any group/room surface. Self-updatable under the existing "users can update their own profile" policy; enforced in send_message_request().';

-- No new RLS policy, and none is wanted. `profiles` already carries
--
--   using (id = auth.uid()) with check (id = auth.uid())
--
-- for UPDATE (mig 0001), so a student may set this on their own row and on no
-- one else's; and `protect_profile_columns()` (migs 0001/0080) pins only the
-- privileged columns, so an ordinary privacy flag needs no exemption. Adding a
-- policy here would only create a second rule to keep in step with the first.
--
-- READ access is likewise unchanged: RLS on this table is row-level, and any
-- viewer who can already read a profile row can read one more boolean on it.
-- The profile page selects this column and nothing else new.

-- ---------------------------------------------------------------------------
-- 2. Enforcement, in the one function that can create a request.
-- ---------------------------------------------------------------------------
-- Carried forward from 0178 with the two checks added; every other rule —
-- authentication, self-send, the 1..250 bound, banned/deactivated accounts,
-- bidirectional blocks, idempotence and the conflict race — is unchanged and
-- still applies in the same order.
create or replace function public.send_message_request(
  p_recipient uuid,
  p_message   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  v_text     text;
  v_id       uuid;
  v_status   public.message_request_status;
  v_disabled boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_recipient is null or p_recipient = uid then
    raise exception 'you cannot send a request to yourself' using errcode = '22023';
  end if;

  v_text := btrim(coalesce(p_message, ''));
  if char_length(v_text) < 1 or char_length(v_text) > 250 then
    raise exception 'message must be 1-250 characters' using errcode = '22023';
  end if;

  -- Availability and the new setting come from the SAME read: one lookup, and
  -- no window in which the account is checked against one row version and the
  -- setting against another.
  select p.disable_message_requests
    into v_disabled
    from public.profiles p
   where p.id = p_recipient
     and p.is_banned = false
     and p.deactivated_at is null;

  if not found then
    raise exception 'that account is not available' using errcode = '22023';
  end if;

  -- Block is bidirectional and silent: the same message either way, so neither
  -- side can probe the other's block list by comparing error text.
  if public.is_blocked(uid, p_recipient) then
    raise exception 'that account is not available' using errcode = '22023';
  end if;

  -- IDEMPOTENCE, not an error. A double tap, a retried transition, or a second
  -- tab must all end with exactly one pending request and a success the UI can
  -- render as "request sent".
  --
  -- THIS RUNS BEFORE THE NEW CHECK, deliberately. A request that already exists
  -- is not a new one, so a recipient who disables the setting afterwards does
  -- not retroactively break the sender's view of a request they already sent —
  -- which is what the brief means by pending requests staying actionable.
  select r.id, r.status into v_id, v_status
    from public.message_requests r
   where r.sender_id = uid
     and r.recipient_id = p_recipient
     and r.status in ('pending', 'accepted')
   order by r.created_at desc
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- CHECK 1 of 2 — fast, and the one that produces a message worth showing.
  -- A distinct sentence, not the shared "not available": this is not a block or
  -- a ban and the sender is not being told anything about the recipient that
  -- the recipient has not chosen to make visible by hiding the button.
  if v_disabled then
    raise exception 'that person is not accepting message requests'
      using errcode = '22023';
  end if;

  -- CHECK 2 of 2 — the guarantee. The predicate is part of the INSERT, so the
  -- setting is read and the row is written in one statement against one
  -- snapshot. Between check 1 and here the recipient may have toggled the
  -- setting on; that commit is either visible to this statement (no row is
  -- inserted) or it is not (the request predates it). There is no interleaving
  -- in which a disabled recipient receives a new request.
  insert into public.message_requests (sender_id, recipient_id, message)
  select uid, p_recipient, v_text
   where exists (
     select 1 from public.profiles p
      where p.id = p_recipient
        and p.disable_message_requests = false
   )
  on conflict (sender_id, recipient_id) where status = 'pending'
  do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost the race with a concurrent identical send; return the winner's row.
    select r.id into v_id
      from public.message_requests r
     where r.sender_id = uid and r.recipient_id = p_recipient and r.status = 'pending';
  end if;

  if v_id is null then
    -- Nothing inserted and nothing to point at: the recipient turned the
    -- setting on between check 1 and the insert. Same error as check 1, so the
    -- race is indistinguishable from the ordinary case to the caller.
    raise exception 'that person is not accepting message requests'
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

comment on function public.send_message_request(uuid, text) is
  'Create (or idempotently return) a first-contact message request. Rejects when the recipient has disable_message_requests set — checked explicitly for the error message and again as a predicate on the INSERT so a concurrent toggle cannot be raced (mig 0196). All of 0178''s rules — auth, self-send, 1..250, banned/deactivated, blocks, idempotence — are unchanged.';

revoke all on function public.send_message_request(uuid, text) from public, anon;
grant execute on function public.send_message_request(uuid, text) to authenticated;

-- =============================================================================
-- VERIFY
--   -- every existing profile was backfilled, and the default is off:
--   select count(*) filter (where disable_message_requests is null) as nulls,
--          count(*) filter (where disable_message_requests) as opted_out,
--          count(*) as total
--     from public.profiles;                       -- nulls must be 0
--
--   select column_default, is_nullable
--     from information_schema.columns
--    where table_name = 'profiles'
--      and column_name = 'disable_message_requests';   -- false, NO
--
--   supabase/tests/disable_message_requests.sql exercises the whole rule.
--
-- ROLLBACK
--   Re-run 0178's send_message_request(), then
--   `alter table public.profiles drop column disable_message_requests;`
--   Dropping the column without restoring the function first leaves the
--   function referencing a column that no longer exists.
-- =============================================================================
