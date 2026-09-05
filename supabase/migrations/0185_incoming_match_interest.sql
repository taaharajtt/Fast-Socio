-- =============================================================================
-- 0185 — "Someone tried to match with you": anonymous, grouped incoming likes.
--
-- WHAT THIS IS
-- A right swipe that is not (yet) reciprocal produces NOTHING today: the liker
-- waits, and the person they liked has no idea anyone is there. The only signal
-- was 0068's silent ranking nudge. This adds one deliberately mysterious
-- notification —
--
--     1 pending    "Someone tried to match with you."
--     n pending    "{n} people tried to match with you."
--
-- — which links to /discover and, by construction, cannot say who.
--
-- ---------------------------------------------------------------------------
-- ANONYMITY IS STRUCTURAL, NOT EDITORIAL
--
-- The row itself carries no identity and there is nothing to redact downstream:
--
--     actor_id     NULL. Not "a null we render as Someone" — genuinely null, so
--                  the Activity list's existing actor-less path renders a
--                  neutral icon with no avatar and no name, PostgREST returns
--                  null, and the realtime payload has nothing to leak.
--     data         {"url": "/discover"} and nothing else. No liker id, no name,
--                  no username, no avatar, no department, no percentage, no
--                  per-liker timestamps.
--     group_key    keyed on the RECIPIENT only ('incoming_match_interest:<me>').
--                  Encoding a liker in it would put an identity in an indexed,
--                  client-readable column.
--     count        group_count, an integer. An aggregate is not an identity.
--     subject_*    none set — the payload names no subject, so 0132's linker
--                  writes nothing and the cascade has nothing to point at.
--
-- The client never computes the number, and no RPC answers "did X like me?":
-- the count is derived inside a definer function the client cannot execute, and
-- `swipes` RLS is untouched (a student still reads only their OWN swipes).
--
-- ---------------------------------------------------------------------------
-- WHAT THE NUMBER MEANS
--
-- Unique accounts that, RIGHT NOW, have a live one-sided like pointing at the
-- recipient and could still become a match. Uniqueness is free: `swipes` is
-- keyed (swiper_id, target_id), so one row per pair is the schema's job, not a
-- DISTINCT. Excluded, each for a reason:
--
--   passes                     not an attempt to match
--   self                       the table's own CHECK forbids it anyway
--   already matched            it is a match, and has its own named notification
--   recipient already swiped   they have decided; a like would have matched, a
--                              pass means they are done. Counting it would point
--                              at a deck entry that no longer exists.
--   blocked / muted pairs      may_notify's rules, applied per liker (this
--                              notification has no actor for may_notify to check)
--   banned / deactivated /     ineligible to appear in Discover at all, so the
--   suspended / shadow-banned  recipient could never act on them
--   not discoverable           they turned themselves off after liking; the
--                              recipient will never be shown them
--   ineligible recipient       banned or deactivated: nobody to notify
--
-- ---------------------------------------------------------------------------
-- WHY A DEDICATED UPSERT AND NOT create_notification()
--
-- 0057's grouping increments `group_count` only when the incoming actor DIFFERS
-- from the stored one. Every row here has actor_id NULL, so `null is distinct
-- from null` is false and the count would never move. Worse, an increment-based
-- count drifts the moment a like is withdrawn, a pair matches, or a block
-- lands. So the count is RECOMPUTED from `swipes` on every reconcile and
-- ASSIGNED, never incremented. `create_notification` is left completely alone —
-- no other notification's behaviour changes.
--
-- ---------------------------------------------------------------------------
-- TRIGGER ORDER (the part that is easy to get wrong)
--
-- The reconcile is called from INSIDE handle_swipe_match, after the match
-- insert, rather than from a second trigger on the same event. Two AFTER
-- triggers on `swipes` would fire in name order, and a one-sided count computed
-- before the match row existed would survive as a lie ("someone tried to match
-- with you" sitting next to "you matched with Alice"). One trigger, one
-- ordering, stated here.
--
-- Two SEPARATE triggers do exist, on different events, so their ordering can
-- never be ambiguous:
--     swipes      AFTER DELETE   — unmatch_user() clears both swipe rows
--     blocked_users AFTER INSERT — a block makes a pair ineligible
--
-- ---------------------------------------------------------------------------
-- EXISTING DATA: NOBODY IS WOKEN BY THIS DEPLOY
--
-- Nothing is backfilled and nothing iterates existing swipes, so applying this
-- migration sends zero notifications. A notification appears only when a NEW
-- qualifying like arrives afterwards. When one does, the count it shows is the
-- total of all currently pending eligible likes, including ones from before the
-- deploy — that is the honest reading of "how many people are presently trying
-- to match with you", which is what the copy claims.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The wake ledger — anti-spam, and invisible to everyone.
-- ---------------------------------------------------------------------------
-- `swipes` has a client DELETE policy (0047) and an UPDATE policy, so a liker
-- can toggle like -> pass -> like, or delete and re-insert, as fast as the rate
-- limiter allows. Without a memory of "this pair has already been announced",
-- each cycle would wake the recipient again — a targeted notification-spam
-- primitive aimed at one person.
--
-- One row per (recipient, liker) records when that pair last woke anything. A
-- pair may wake at most once per week, so toggling is silent while a genuine
-- like months later is not.
--
-- RLS is ON with NO POLICIES and no grants: `authenticated` and `anon` cannot
-- select, insert, update or delete a single row. It is written only by the
-- definer trigger below. This matters more than the table looks — it is a
-- verbatim record of who liked whom, so it is exactly the thing this feature
-- exists to keep private.
create table if not exists public.incoming_interest_wakes (
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  liker_id     uuid not null references public.profiles (id) on delete cascade,
  last_wake_at timestamptz not null default now(),
  primary key (recipient_id, liker_id)
);

alter table public.incoming_interest_wakes enable row level security;
revoke all on public.incoming_interest_wakes from anon, authenticated;

comment on table public.incoming_interest_wakes is
  'PRIVATE. One row per (recipient, liker) recording when that pair last woke an incoming-interest notification, so like/pass toggling cannot spam a target. RLS on with NO policies and no grants — never client-readable, because the rows name who liked whom. See migration 0185.';

-- ---------------------------------------------------------------------------
-- 2. reconcile_incoming_match_interest — the whole rule, in one place.
-- ---------------------------------------------------------------------------
-- CONCURRENCY. Two people liking the same recipient in the same instant would
-- otherwise both count "1" (neither transaction sees the other's uncommitted
-- swipe) and the second would overwrite the first with a stale number. The
-- advisory lock is taken on the RECIPIENT, so the second transaction waits,
-- then recomputes and sees both rows. It is a transaction-scoped lock, released
-- at commit, and it serialises only same-recipient reconciles.
--
-- IDEMPOTENT. Calling it twice with no intervening change assigns the same
-- number twice. `p_wake` is the only thing that can create a row; every other
-- call can update or delete one, but never conjures one.
--
-- NOT CALLABLE BY CLIENTS. It takes a recipient parameter, so exposing it would
-- answer "how many people like <anyone>" — and, differenced over time, worse.
-- EXECUTE is revoked from public, anon and authenticated; only the definer
-- triggers below call it.
create or replace function public.reconcile_incoming_match_interest(
  p_recipient uuid,
  p_wake      boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_pref  boolean;
begin
  if p_recipient is null then
    return;
  end if;

  -- Serialise per recipient; see the note above.
  perform pg_advisory_xact_lock(hashtextextended('incoming_match_interest:' || p_recipient::text, 0));

  -- The matching/Discover family already has a preference switch, and this is a
  -- matching notification, so it rides on `matches` rather than inventing a
  -- second toggle for the same family. Absent row = off, matching the rule
  -- create_notification() has always applied.
  select np.matches into v_pref
    from public.notification_preferences np
   where np.user_id = p_recipient;

  select count(*) into v_count
    from public.swipes s
    join public.profiles liker on liker.id = s.swiper_id
    join public.profiles me    on me.id    = p_recipient
   where s.target_id = p_recipient
     and s.direction = 'like'
     and s.swiper_id <> p_recipient
     -- The liker can still actually be reached in Discover.
     and liker.onboarding_completed = true
     and liker.is_banned = false
     and liker.shadow_banned = false
     and liker.deactivated_at is null
     and (liker.suspended_until is null or liker.suspended_until < now())
     and liker.discoverable = true
     -- There is somebody to notify.
     and me.is_banned = false
     and me.deactivated_at is null
     -- Already a match: that pair has its own, named notification.
     and not exists (
       select 1 from public.matches m
        where m.user_low  = least(p_recipient, s.swiper_id)
          and m.user_high = greatest(p_recipient, s.swiper_id)
     )
     -- The recipient has already decided about this person. A like would have
     -- created a match; a pass means they are finished with them.
     and not exists (
       select 1 from public.swipes r
        where r.swiper_id = p_recipient and r.target_id = s.swiper_id
     )
     -- may_notify()'s rules, applied per liker — this notification has no actor
     -- for may_notify() itself to check.
     and not public.is_blocked(p_recipient, s.swiper_id)
     and not exists (
       select 1 from public.muted_users mu
        where mu.muter_id = p_recipient and mu.muted_id = s.swiper_id
     );

  -- Nothing pending, or the recipient has the matching family switched off:
  -- resolve any live row. Turning the preference off clears what is on screen
  -- rather than freezing it.
  if v_count = 0 or v_pref is distinct from true then
    delete from public.notifications
     where user_id = p_recipient
       and type = 'incoming_match_interest'
       and read_at is null;
    return;
  end if;

  -- A live row exists: correct its number in place. No new row, no push (the
  -- dispatcher fires on INSERT only), so a count moving up or down is silent.
  update public.notifications
     set group_count = v_count
   where user_id = p_recipient
     and type = 'incoming_match_interest'
     and read_at is null;
  if found then
    return;
  end if;

  -- No live row. Only a genuinely new qualifying like may create one; anything
  -- else (a recount after a block, a delete, a match) leaves the recipient in
  -- peace. This is what stops a read notification from being resurrected by
  -- unrelated churn among likes that were already counted once.
  if not p_wake then
    return;
  end if;

  insert into public.notifications
    (user_id, actor_id, type, data, group_key, group_count)
  values
    (p_recipient,
     null,                                   -- ANONYMOUS. See the header.
     'incoming_match_interest',
     jsonb_build_object('url', '/discover'), -- the push destination; no identity
     'incoming_match_interest:' || p_recipient::text,
     v_count)
  on conflict (user_id, type, group_key) where read_at is null and group_key is not null
  do update set group_count = excluded.group_count;
end;
$$;

comment on function public.reconcile_incoming_match_interest(uuid, boolean) is
  'Recompute the recipient''s anonymous incoming-like aggregate and update/resolve their single unread notification. p_wake=true (a NEW qualifying like) is the only way a row is created. Never returns or stores liker identities. Definer, trigger-only. See migration 0185.';

revoke all on function public.reconcile_incoming_match_interest(uuid, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. handle_swipe_match — carried forward from 0182 verbatim, plus the
--    reconcile calls at the end.
-- ---------------------------------------------------------------------------
-- Everything 0182/0047/0004 established is untouched: a match still requires
-- two explicit likes, the pair is still canonical, Aura is still awarded once
-- and only for a brand-new match, and a re-match still reopens the pair's
-- closed conversation.
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
  inserted   boolean := false;
  matched    boolean := false;
  v_new_like boolean := false;
  v_wake     boolean := false;
begin
  if new.direction = 'like' then
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

      matched := true;

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
  end if;

  -- 0185 — the anonymous aggregate, computed AFTER any match above so a
  -- one-sided count can never outlive the match that resolved it.
  if matched then
    -- Both sides change: the pair stops counting for each of them, and the
    -- named "You matched with X" notification takes over. Never a wake — a
    -- match must not also announce itself anonymously.
    --
    -- CANONICAL ORDER, not (target, swiper). Each reconcile takes an advisory
    -- lock on its recipient, so two transactions reconciling the same pair in
    -- opposite orders would deadlock — and reciprocal likes are exactly the
    -- case where two transactions touch the same two users at once. Sorting the
    -- pair makes every caller take the two locks in the same order.
    perform public.reconcile_incoming_match_interest(
      least(new.target_id, new.swiper_id), false);
    perform public.reconcile_incoming_match_interest(
      greatest(new.target_id, new.swiper_id), false);
  else
    -- Is this a genuinely NEW like? OLD is unassigned for an INSERT, so the
    -- check is an if/elsif rather than one boolean expression — PostgreSQL does
    -- not promise to short-circuit `or`, and `old.direction` on an INSERT would
    -- raise "record old is not assigned yet".
    if new.direction = 'like' then
      if tg_op = 'INSERT' then
        v_new_like := true;
      elsif old.direction is distinct from 'like' then
        v_new_like := true;
      end if;
    end if;

    if v_new_like then
      -- A genuinely NEW like from this pair. The ledger decides whether it may
      -- wake anything: at most once a week per pair, so like/pass toggling
      -- recounts silently instead of buzzing the target repeatedly.
      insert into public.incoming_interest_wakes (recipient_id, liker_id, last_wake_at)
      values (new.target_id, new.swiper_id, now())
      on conflict (recipient_id, liker_id) do update
        set last_wake_at = now()
        where public.incoming_interest_wakes.last_wake_at < now() - interval '7 days'
      returning true into v_wake;
    end if;

    -- Covers a like (wake or not) and a like -> pass downgrade (recount, and
    -- the aggregate falls or resolves).
    perform public.reconcile_incoming_match_interest(
      new.target_id, coalesce(v_wake, false)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists swipes_match_check on public.swipes;
create trigger swipes_match_check
  after insert or update on public.swipes
  for each row execute function public.handle_swipe_match();

-- ---------------------------------------------------------------------------
-- 4. Withdrawal — a deleted swipe stops counting.
-- ---------------------------------------------------------------------------
-- unmatch_user() (0182) deletes BOTH swipe rows for a pair, and a student may
-- delete their own swipe directly. Neither may leave a stale number behind, and
-- neither may wake anything: `p_wake` is false, so an unmatch can never
-- resurrect the anonymous notification that the original likes once produced.
create or replace function public.swipe_deleted_reconcile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconcile_incoming_match_interest(old.target_id, false);
  return null;
end;
$$;

drop trigger if exists swipes_reconcile_on_delete on public.swipes;
create trigger swipes_reconcile_on_delete
  after delete on public.swipes
  for each row execute function public.swipe_deleted_reconcile();

revoke all on function public.swipe_deleted_reconcile() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Blocking — an ineligible pair stops counting, in both directions.
-- ---------------------------------------------------------------------------
-- Reconciling BOTH users is deliberate: a block changes eligibility whichever
-- way the like pointed. Neither side is told that a specific liker vanished —
-- the number simply changes, or the row resolves, exactly as it would if the
-- like had been withdrawn.
create or replace function public.block_reconcile_incoming_interest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Canonical order, for the same deadlock reason as handle_swipe_match.
  perform public.reconcile_incoming_match_interest(
    least(new.blocker_id, new.blocked_id), false);
  perform public.reconcile_incoming_match_interest(
    greatest(new.blocker_id, new.blocked_id), false);
  return null;
end;
$$;

drop trigger if exists blocked_users_reconcile_interest on public.blocked_users;
create trigger blocked_users_reconcile_interest
  after insert on public.blocked_users
  for each row execute function public.block_reconcile_incoming_interest();

revoke all on function public.block_reconcile_incoming_interest()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Push — same anonymity, same wording.
-- ---------------------------------------------------------------------------
-- dispatch_push_notification carried forward VERBATIM from 0168 with one title
-- and one body case added. It fires on INSERT only, so a count that changes
-- later updates the row silently and never re-pushes.
--
-- The payload cannot leak an identity even by accident: `actor_name` is read
-- from `new.actor_id`, which is null here, and neither of the new cases
-- references it. The URL is /discover, so the tray notification opens the deck
-- rather than anything about a person.
create or replace function public.dispatch_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fn_url text;
  secret text;
  actor_name text;
  v_title text;
  v_body text;
  qh_enabled boolean;
  qh_start smallint;
  qh_end smallint;
  cur_hour int;
  v_count int;
begin
  if not exists (
    select 1 from public.push_subscriptions where user_id = new.user_id
  ) then
    return null;
  end if;

  select quiet_hours_enabled, quiet_start, quiet_end
    into qh_enabled, qh_start, qh_end
    from public.notification_preferences where user_id = new.user_id;

  if qh_enabled then
    cur_hour := extract(hour from (now() at time zone 'Asia/Karachi'))::int;
    if (qh_start <= qh_end and cur_hour >= qh_start and cur_hour < qh_end)
       or (qh_start > qh_end and (cur_hour >= qh_start or cur_hour < qh_end)) then
      return null;
    end if;
  end if;

  select value into fn_url from private.app_config where key = 'send_push_url';
  select value into secret from private.app_config where key = 'push_dispatch_secret';
  if fn_url is null or secret is null then
    return null;
  end if;

  select full_name into actor_name from public.profiles where id = new.actor_id;
  actor_name := coalesce(actor_name, 'Someone');

  -- Guarded the same way the UI guards it: a missing or nonsensical count reads
  -- as the singular rather than "0 people" or "NaN people".
  v_count := greatest(coalesce(new.group_count, 1), 1);

  v_title := case new.type
    when 'match' then 'New match!'
    when 'incoming_match_interest' then 'Someone''s interested'
    when 'message_request' then 'Message request'
    when 'message' then actor_name
    when 'post_like' then 'New like'
    when 'comment' then 'New comment'
    when 'community_message' then coalesce(new.data->>'community_name', 'Community chat')
    when 'society_announcement' then coalesce(new.data->>'community_name', 'New broadcast')
    when 'event_message' then coalesce(new.data->>'event_title', 'Event chat')
    when 'community_approved' then 'Community approved'
    when 'event_approved' then 'Event approved'
    when 'level_up' then 'Level up!'
    when 'achievement' then 'Achievement unlocked'
    when 'waitlist_promoted' then 'You got a seat!'
    when 'event_reminder' then 'Event reminder'
    else 'FAST SOCIO'
  end;

  v_body := case new.type
    when 'match' then actor_name || ' matched with you'
    when 'incoming_match_interest' then
      case when v_count > 1
           then v_count || ' people tried to match with you'
           else 'Someone tried to match with you' end
    when 'message_request' then actor_name || ' wants to chat'
    when 'message' then 'sent you a message'
    when 'post_like' then actor_name || ' reacted to your post'
    when 'comment' then actor_name || ' commented on your post'
    when 'community_message' then actor_name || ' sent a message'
    when 'society_announcement' then actor_name || ' posted an announcement'
    when 'event_message' then actor_name || ' sent a message'
    when 'community_approved' then 'Your community is now live'
    when 'event_approved' then 'Your event is now live'
    when 'level_up' then 'You reached level ' || coalesce(new.data->>'level', '')
    when 'achievement' then coalesce(new.data->>'title', 'a new badge') || ' unlocked'
    when 'waitlist_promoted' then 'A seat opened up for your event'
    when 'event_reminder' then 'An event you''re attending is coming up'
    else 'You have a new notification'
  end;

  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', secret
    ),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'title', v_title,
      'body', v_body,
      'url', coalesce(new.data->>'url', '/activity')
    )
  );

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Index for the aggregate lookup.
-- ---------------------------------------------------------------------------
-- The reconcile's hot path is "my live row of this type", which the existing
-- partial unique index on (user_id, type, group_key) already serves. The count
-- itself reads swipes by target, which swipes_target_like_idx (0004) covers.
-- Nothing further is needed; this is recorded so the next reader does not add a
-- redundant index looking for one.

-- =============================================================================
-- VERIFY
--   -- nobody is woken by the deploy itself:
--   select count(*) from public.notifications where type = 'incoming_match_interest';
--   -- must be 0 immediately after applying.
--
--   supabase/tests/incoming_match_interest.sql exercises the whole lifecycle.
--
-- ROLLBACK
--   Re-run 0182's handle_swipe_match() and 0168's dispatch_push_notification(),
--   then:
--     drop trigger if exists blocked_users_reconcile_interest on public.blocked_users;
--     drop trigger if exists swipes_reconcile_on_delete on public.swipes;
--     drop function if exists public.block_reconcile_incoming_interest();
--     drop function if exists public.swipe_deleted_reconcile();
--     drop function if exists public.reconcile_incoming_match_interest(uuid, boolean);
--     delete from public.notifications where type = 'incoming_match_interest';
--     drop table if exists public.incoming_interest_wakes;
-- =============================================================================
