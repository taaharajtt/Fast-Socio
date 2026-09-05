-- =============================================================================
-- 0182 — "Hide my matches", authorised second-degree lists, and a real unmatch.
--
-- Three related things, in one migration because they share a boundary:
--
--   1. profiles.show_matches — the owner's say over whether their CURRENT
--      matches may open their matches list. Defaults TRUE so nothing changes
--      for an existing account the moment this ships.
--
--   2. get_matches_of(p_user) gains the privacy and hygiene checks it was
--      missing. It already enforced the one-hop rule (the caller must be
--      matched with p_user); it now also requires an authenticated caller,
--      p_user.show_matches, a live and unbanned p_user, and no block in either
--      direction. It still fails CLOSED-AND-QUIET — an unauthorised or hidden
--      request returns the empty set, indistinguishable from "they have no
--      matches", so nothing leaks either way (same reasoning as 0144).
--
--   3. unmatch_user(p_other) — one atomic, authenticated, self-scoped
--      operation that actually ends a match instead of the client deleting a
--      row it should never have been able to delete (it cannot: `matches` has
--      no client DELETE policy at all, so this RPC is the ONLY door).
--
-- ---------------------------------------------------------------------------
-- CHAT HISTORY: THE DECISION, AND WHY.
--
-- Unmatching must make chat impossible. It must NOT destroy history: DM report
-- evidence (0161) points at `messages` rows, and a spite-unmatch that erased
-- the thread would erase the proof of whatever provoked it. Deleting the
-- conversation would also cascade `messages`, taking that evidence with it.
--
-- So the conversation is CLOSED, not deleted: `conversations.closed_at` marks
-- the pair's direct channel as dead. The gate is enforced in three places that
-- do not depend on each other —
--
--   * the messages INSERT policy (RLS): no new message may enter a closed
--     conversation, whoever asks and by whatever route (PostgREST, an RPC
--     running as invoker, a stale client);
--   * get_or_create_conversation: will not hand back a closed conversation;
--   * the application: the thread renders read-only and the inbox drops it.
--
-- The first of those is the authorisation. The other two are ergonomics.
--
-- ALTERNATE AUTHORISATION PATHS. A pair's direct chat could previously be kept
-- alive by an accepted message request, an accepted matching request, an
-- accepted smart-match application or an accepted help offer — any one of which
-- would have survived the unmatch and left "they cannot chat afterwards"
-- false. Two things close that:
--
--   * unmatch_user resolves the pair's OWN message requests (pending and
--     accepted alike become 'declined'), so nothing already in flight can be
--     turned back into chat permission; and
--   * closed_at outranks eligibility everywhere. A connection that already
--     existed when the pair unmatched can never reopen the channel.
--
-- REOPENING is deliberately possible, and deliberately narrow: only a consent
-- event that happened AFTER the close counts. A fresh mutual match reopens the
-- channel (handle_swipe_match), and so does any eligibility record created
-- after closed_at (get_or_create_conversation / accept_message_request /
-- open_help_conversation). An OLD record never does. That keeps a re-matched
-- pair's history where they left it without letting a pre-unmatch row act as a
-- back door.
--
-- DISCOVER. Unmatching deletes BOTH swipe rows for the pair. That is what makes
-- the two of them eligible for each other's deck again (0177 excludes anyone
-- you have liked and anyone you have matched), and it is also what stops the
-- match reforming the instant one of them swipes: with both likes gone there is
-- no stale reciprocal like for handle_swipe_match to find. Blocks are NOT
-- touched — a blocked pair stays out of Discover, as it must.
--
-- AURA is NOT reversed. `aura_transactions` is an append-only ledger and the
-- +10 for matching records something that genuinely happened; clawing it back
-- would rewrite history and hand anyone a way to drain another account's Aura
-- by matching and unmatching. The existing product rule (a Discover pass does
-- not refund either) is preserved.
--
-- MATCH NOTIFICATIONS for the pair are removed, because their subject is gone
-- and they would otherwise sit in the panel pointing at nothing (0137 already
-- filters them out of visible_notifications; this deletes them so the unread
-- counter drops too). Reports, moderation records and the audit log are
-- untouched.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

-- Positive naming on purpose ("show_matches", not "hide_matches"): every other
-- privacy column in this table reads show_*/allow_* and the settings toggle is
-- rendered directly from the column, so a negated one would invert on screen.
alter table public.profiles
  add column if not exists show_matches boolean not null default true;

comment on column public.profiles.show_matches is
  'When true (default), the owner''s CURRENT matches may open their matches list. When false nobody but the owner may. Non-matches never may, either way. See migration 0182.';

alter table public.conversations
  add column if not exists closed_at timestamptz,
  add column if not exists closed_reason text;

comment on column public.conversations.closed_at is
  'Set when the pair''s direct channel was ended (unmatch). History is retained and readable; no new message may be inserted while this is non-null. See migration 0182.';

-- ---------------------------------------------------------------------------
-- 2. get_matches_of — privacy + hygiene on the second-degree list
-- ---------------------------------------------------------------------------
-- Still no match_percentage in the result: the score between two OTHER people
-- is not the viewer's to see. Still an empty set rather than an exception on a
-- refusal, for the reason 0144 documents.
create or replace function public.get_matches_of(p_user uuid)
returns table(
  id uuid, full_name text, username text, avatar_url text, gender text,
  department text, verified boolean, matched_at timestamptz
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, p.username, p.avatar_url, p.gender,
         p.department, coalesce(p.verified, false), m.created_at
    from public.matches m
    join public.profiles p
      on p.id = case when m.user_low = p_user then m.user_high else m.user_low end
   where (select auth.uid()) is not null
     and p_user is not null
     and (p_user in (m.user_low, m.user_high))
     -- the viewer never appears in their own second-degree list
     and p.id <> (select auth.uid())
     and p.deactivated_at is null
     and not p.is_banned
     -- THE ONE HOP: the caller must themselves be matched with p_user
     and exists (
       select 1 from public.matches g
        where g.user_low  = least((select auth.uid()), p_user)
          and g.user_high = greatest((select auth.uid()), p_user)
     )
     -- THE OWNER'S SAY (0182). Absent/null is treated as visible so the column
     -- default and any pre-migration row behave identically.
     and exists (
       select 1 from public.profiles o
        where o.id = p_user
          and coalesce(o.show_matches, true)
          and o.deactivated_at is null
          and not o.is_banned
     )
     -- A block in either direction ends the relationship for viewing purposes
     -- too, even though the match row may still exist.
     and not public.is_blocked((select auth.uid()), p_user)
     -- ...and people the viewer has blocked (or who blocked them) are not
     -- listed inside someone else's list either.
     and not public.is_blocked((select auth.uid()), p.id)
   order by m.created_at desc;
$function$;

comment on function public.get_matches_of(uuid) is
  'Second-degree matches list: the matches of someone the CALLER is matched with, and only when that person''s show_matches is true. Empty set on refusal. No match percentages. See migrations 0144 and 0182.';

revoke all on function public.get_matches_of(uuid) from public, anon;
grant execute on function public.get_matches_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The closed-conversation gate
-- ---------------------------------------------------------------------------
-- RLS is the authorisation. Re-declared in full (carrying 0032's initplan-safe
-- `(select auth.uid())` form and 0006's block clause) with one clause added.
alter policy "participants send messages" on public.messages
  with check (
    (sender_id = (select auth.uid()))
    and (exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_low = (select auth.uid()) or c.user_high = (select auth.uid()))
    ))
    -- 0182: a closed (unmatched) conversation takes no new messages, from
    -- either party, by any route.
    and (not exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.closed_at is not null
    ))
    and (not exists (
      select 1
      from public.conversations c
      join public.blocked_users b
        on ((b.blocker_id = (select auth.uid())
              and b.blocked_id = case when c.user_low = (select auth.uid()) then c.user_high else c.user_low end)
         or (b.blocked_id = (select auth.uid())
              and b.blocker_id = case when c.user_low = (select auth.uid()) then c.user_high else c.user_low end))
      where c.id = messages.conversation_id
    ))
  );

-- ---------------------------------------------------------------------------
-- 4. get_or_create_conversation — carries every eligibility branch from 0106,
--    plus the closed gate and the narrow reopen rule.
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_conversation(other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conv_id uuid;
  v_closed timestamptz;
  eligible boolean;
  blocked boolean;
begin
  if me is null or other_id is null or me = other_id then
    raise exception 'invalid participants';
  end if;

  lo := least(me, other_id);
  hi := greatest(me, other_id);

  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = me)
  ) into blocked;
  if blocked then
    raise exception 'blocked';
  end if;

  -- Lock the row if it exists, so a concurrent unmatch cannot close the
  -- conversation between the check below and the caller acting on the id.
  select c.id, c.closed_at into conv_id, v_closed
    from public.conversations c
   where c.user_low = lo and c.user_high = hi
   for update;

  -- ELIGIBILITY. When the channel was closed by an unmatch, only a connection
  -- formed AFTER that close counts — an older accepted request is exactly the
  -- back door the close exists to shut.
  select
    exists (
      select 1 from public.matches m
      where m.user_low = lo and m.user_high = hi
        and (v_closed is null or m.created_at > v_closed)
    )
    or exists (
      select 1 from public.message_requests r
      where r.status = 'accepted'
        and ((r.sender_id = me and r.recipient_id = other_id)
          or (r.sender_id = other_id and r.recipient_id = me))
        and (v_closed is null or r.created_at > v_closed)
    )
    or exists (
      select 1 from public.matching_requests mr
      where mr.status = 'accepted'
        and ((mr.requester_id = me and mr.recipient_id = other_id)
          or (mr.requester_id = other_id and mr.recipient_id = me))
        and (v_closed is null or coalesce(mr.responded_at, mr.created_at) > v_closed)
    )
    or exists (
      select 1 from public.smart_match_applications a
      join public.smart_match_posts p on p.id = a.post_id
      where a.status = 'accepted'
        and ((p.author_id = me and a.applicant_id = other_id)
          or (p.author_id = other_id and a.applicant_id = me))
        and (v_closed is null or coalesce(a.responded_at, a.created_at) > v_closed)
    )
    or exists (
      select 1 from public.help_responses resp
      join public.help_requests req on req.id = resp.request_id
      where resp.status = 'accepted'
        and ((req.author_id = me and resp.author_id = other_id)
          or (req.author_id = other_id and resp.author_id = me))
        and (v_closed is null or coalesce(resp.accepted_at, resp.updated_at, resp.created_at) > v_closed)
    )
  into eligible;
  if not eligible then
    raise exception 'not connected';
  end if;

  if conv_id is null then
    insert into public.conversations (user_low, user_high)
      values (lo, hi)
    on conflict (user_low, user_high) do nothing;

    select c.id into conv_id from public.conversations c
     where c.user_low = lo and c.user_high = hi;
  elsif v_closed is not null then
    -- Reopen: a NEW connection was formed after the close (checked above).
    update public.conversations
       set closed_at = null, closed_reason = null
     where id = conv_id;
  end if;

  return conv_id;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. accept_message_request — unchanged except that it may reopen a closed
--    channel, and only for a request created after the close. Carried in full
--    from 0178 so the atomic accept + conversation semantics stay intact.
-- ---------------------------------------------------------------------------
create or replace function public.accept_message_request(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_sender uuid;
  v_status public.message_request_status;
  v_created timestamptz;
  lo       uuid;
  hi       uuid;
  v_conv   uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select r.sender_id, r.status, r.created_at
    into v_sender, v_status, v_created
    from public.message_requests r
   where r.id = p_id and r.recipient_id = uid
   for update;

  if v_sender is null then
    raise exception 'request not found' using errcode = '22023';
  end if;
  if v_status = 'declined' then
    raise exception 'that request was declined' using errcode = '22023';
  end if;
  if public.is_blocked(uid, v_sender) then
    raise exception 'that account is not available' using errcode = '22023';
  end if;

  if v_status <> 'accepted' then
    update public.message_requests set status = 'accepted' where id = p_id;
  end if;

  lo := least(uid, v_sender);
  hi := greatest(uid, v_sender);

  insert into public.conversations (user_low, user_high)
    values (lo, hi)
  on conflict (user_low, user_high) do nothing;

  -- 0182: accepting a request sent AFTER the pair unmatched is fresh consent
  -- from both sides, so it reopens the channel. An older request does not —
  -- it is the very back door the close exists to shut.
  update public.conversations
     set closed_at = null, closed_reason = null
   where user_low = lo and user_high = hi
     and closed_at is not null
     and v_created > closed_at;

  select c.id into v_conv
    from public.conversations c
   where c.user_low = lo and c.user_high = hi;

  return v_conv;
end;
$$;

revoke all on function public.accept_message_request(uuid) from public, anon;
grant execute on function public.accept_message_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. open_help_conversation — same treatment (0106 carried forward). An offer
--    approved after the close reopens the channel; an older one does not.
-- ---------------------------------------------------------------------------
create or replace function public.open_help_conversation(p_response_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  v_owner  uuid;
  v_helper uuid;
  v_status text;
  v_accepted timestamptz;
  v_closed timestamptz;
  other_id uuid;
  lo uuid;
  hi uuid;
  conv_id uuid;
  blocked boolean;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  select resp.author_id, resp.status,
         coalesce(resp.accepted_at, resp.updated_at, resp.created_at), req.author_id
    into v_helper, v_status, v_accepted, v_owner
    from public.help_responses resp
    join public.help_requests req on req.id = resp.request_id
   where resp.id = p_response_id;
  if v_owner is null then
    raise exception 'response not found';
  end if;
  if v_status <> 'accepted' then
    raise exception 'this offer has not been approved';
  end if;

  if me = v_owner then
    other_id := v_helper;
  elsif me = v_helper then
    other_id := v_owner;
  else
    raise exception 'not authorized';
  end if;

  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = me)
  ) into blocked;
  if blocked then
    raise exception 'blocked';
  end if;

  lo := least(me, other_id);
  hi := greatest(me, other_id);
  insert into public.conversations (user_low, user_high)
    values (lo, hi)
    on conflict (user_low, user_high) do nothing;

  update public.conversations
     set closed_at = null, closed_reason = null
   where user_low = lo and user_high = hi
     and closed_at is not null
     and v_accepted > closed_at;

  select c.id, c.closed_at into conv_id, v_closed
    from public.conversations c
   where c.user_low = lo and c.user_high = hi;
  if v_closed is not null then
    -- Still closed: the approval predates the unmatch, so it is not consent to
    -- reopen. Same message the other refusals use.
    raise exception 'not connected';
  end if;

  return conv_id;
end;
$$;

revoke all on function public.open_help_conversation(uuid) from public, anon;
grant execute on function public.open_help_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. handle_swipe_match — carried from 0047, plus: a NEW match reopens a
--    channel the pair had closed by unmatching, so a re-matched pair picks up
--    their history instead of finding a dead thread.
-- ---------------------------------------------------------------------------
create or replace function public.handle_swipe_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reciprocal boolean;
  lo uuid;
  hi uuid;
  inserted boolean := false;
begin
  if new.direction <> 'like' then
    return new;
  end if;

  select exists (
    select 1 from public.swipes s
    where s.swiper_id = new.target_id
      and s.target_id = new.swiper_id
      and s.direction = 'like'
  ) into reciprocal;

  if reciprocal then
    lo := least(new.swiper_id, new.target_id);
    hi := greatest(new.swiper_id, new.target_id);

    with ins as (
      insert into public.matches (user_low, user_high)
        values (lo, hi)
        on conflict (user_low, user_high) do nothing
      returning 1
    )
    select exists (select 1 from ins) into inserted;

    -- Award Aura ONLY for a brand-new match, never on a re-fire.
    if inserted then
      insert into public.aura_transactions (user_id, delta, reason)
        values (new.swiper_id, 10, 'match'), (new.target_id, 10, 'match');

      -- 0182: matching again is fresh mutual consent, so the channel reopens.
      update public.conversations
         set closed_at = null, closed_reason = null
       where user_low = lo and user_high = hi and closed_at is not null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists swipes_match_check on public.swipes;
create trigger swipes_match_check
  after insert or update on public.swipes
  for each row execute function public.handle_swipe_match();

-- ---------------------------------------------------------------------------
-- 8. unmatch_user — the whole operation, once, as one transaction.
-- ---------------------------------------------------------------------------
-- Identity comes from auth.uid() and NOWHERE else: the only parameter is the
-- other person, so there is no shape of call that unmatches two third parties.
-- Idempotent (returns false if there was no match) and concurrency-safe (the
-- match row is locked first, so two devices tapping Unmatch produce one
-- unmatch and one no-op rather than two half-runs).
create or replace function public.unmatch_user(p_other uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  lo uuid;
  hi uuid;
  v_match uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_other is null or p_other = uid then
    raise exception 'invalid target' using errcode = '22023';
  end if;

  lo := least(uid, p_other);
  hi := greatest(uid, p_other);

  select m.id into v_match
    from public.matches m
   where m.user_low = lo and m.user_high = hi
   for update;

  if v_match is null then
    -- Not matched (or already unmatched by the other side). Nothing to do, and
    -- deliberately not an error: the UI's job is to end up in the same state.
    return false;
  end if;

  delete from public.matches where id = v_match;

  -- Discover: dropping BOTH likes is what re-opens the deck for the pair and,
  -- at the same time, what stops a stale reciprocal like re-forming the match
  -- the moment either of them swipes again. Passes are dropped with them so the
  -- pair starts from a clean slate rather than in the recycle tier.
  delete from public.swipes
   where (swiper_id = uid and target_id = p_other)
      or (swiper_id = p_other and target_id = uid);

  -- Direct chat: closed, not deleted. See the header for the reasoning.
  update public.conversations
     set closed_at = now(), closed_reason = 'unmatched'
   where user_low = lo and user_high = hi
     and closed_at is null;

  -- No message request may act as a second key to the same door.
  update public.message_requests
     set status = 'declined'
   where status in ('pending', 'accepted')
     and ((sender_id = uid and recipient_id = p_other)
       or (sender_id = p_other and recipient_id = uid));

  -- The match notifications' subject no longer exists. 0137 already hides them
  -- from the panel; removing them also clears the unread count they inflate.
  -- Reports, moderation records and the audit log are untouched.
  -- Matched on the actor AND on the payload's user_id, because notify_match()
  -- writes both and a grouped row can have had its actor rewritten (0178).
  delete from public.notifications n
   where n.type = 'match'
     and ((n.user_id = uid
           and (n.actor_id = p_other or n.data->>'user_id' = p_other::text))
       or (n.user_id = p_other
           and (n.actor_id = uid or n.data->>'user_id' = uid::text)));

  return true;
end;
$$;

comment on function public.unmatch_user(uuid) is
  'Ends the caller''s match with p_other atomically: removes the match, clears both swipes (Discover reopens, no instant re-match), closes the direct conversation (history retained, no new messages), resolves the pair''s message requests, and removes their match notifications. Aura is NOT reversed. See migration 0182.';

revoke all on function public.unmatch_user(uuid) from public, anon;
grant execute on function public.unmatch_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Badges / unread counts must not keep nagging about a dead thread.
-- ---------------------------------------------------------------------------
create or replace function public.chat_badge_count()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select c.id from public.conversations c
     where c.user_low  = (select auth.uid()) and c.closed_at is null
    union all
    select c.id from public.conversations c
     where c.user_high = (select auth.uid()) and c.closed_at is null
  ),
  counted as (
    select
      (
        select count(distinct m.conversation_id)
          from mine
          join public.messages m on m.conversation_id = mine.id
         where m.sender_id <> (select auth.uid())
           and m.read_at is null
      ) as conversations,
      (
        select count(*)
          from public.message_requests r
         where r.recipient_id = (select auth.uid())
           and r.status = 'pending'
      ) as requests
  )
  select jsonb_build_object(
    'conversations', conversations,
    'unread', conversations,
    'requests', requests
  )
  from counted;
$$;

comment on function public.chat_badge_count() is
  'Unread CONVERSATIONS + pending message requests for auth.uid(), as {"conversations":n,"unread":n,"requests":n}. Closed (unmatched) conversations are excluded. See migrations 0169 and 0182.';

revoke all on function public.chat_badge_count() from public, anon;
grant execute on function public.chat_badge_count() to authenticated;

create or replace function public.conversation_unread_counts()
returns table (conv_id uuid, unread_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select m.conversation_id, count(*)::int
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.sender_id <> (select auth.uid())
    and m.read_at is null
    and m.hidden = false
    and c.closed_at is null
  group by m.conversation_id;
$$;

revoke all on function public.conversation_unread_counts() from public, anon;
grant execute on function public.conversation_unread_counts() to authenticated;
