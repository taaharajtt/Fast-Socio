-- =============================================================================
-- 0187 — Aura integrity, part 2: every reward path onto a checked source.
--
-- Part 1 (0186) built the register. This moves all nine live award paths onto
-- it, closes each specific exploit, and puts the anti-abuse limits that only
-- existed in server actions into the transaction that creates the source — so
-- a modified client calling PostgREST directly meets the same rules.
--
-- REWARD TABLE (source key -> uniqueness -> reversal -> XP -> achievements)
--
--   post_created      post:{post_id}                       one active per post
--                     reversed by: delete, or moderation rejection
--   comment_received  comment:{post_id}:{commenter_id}     one per pair
--                     reversed by: last comment of the pair deleted, OR the
--                     parent post being deleted
--   match             match:{lo}:{hi}:{user_id}            one per user per pair
--                     reversed by: unmatch_user()
--   event_attend      event-checkin:{event_id}:{user_id}   one per attendee
--                     reversed by: nothing (verified attendance is permanent)
--   help_thanked      help:{request_id}                    one per REQUEST
--                     reversed by: reselection, reopening, deletion
--   profile_completed profile-completed:{user_id}          one per user
--                     reversed by: nothing (a genuine one-time milestone)
--   achievement       achievement:{user_id}:{code}         one per badge
--                     reversed by: losing a reversible metric
--   admin_adjust      admin:{tx_id}   (positive only)      never auto-reversed
--   post_liked /      NO WRITER. Dead reasons, kept in the enum for history and
--   community_join /  explicitly documented as inactive at the end of this file
--   daily_login       rather than left as dormant insecure paths.
--
-- Every one of them contributes XP through its grant, and every one of them can
-- trigger achievements — which is exactly why the achievement rewards became
-- reversible too, or a create/delete loop would launder badges.
-- =============================================================================

set check_function_bodies = off;

-- ===========================================================================
-- 1. POSTS — award once, reverse on delete, respect moderation.
-- ===========================================================================
-- 0008 paid +2 on insert with no reversal anywhere. The fix is three-part: the
-- award is keyed on the post, deletion reverses it, and a post that is HELD for
-- community review is not paid until it is actually approved (and is reversed
-- if it is rejected after having been approved).
create or replace function public.award_post_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Anonymous posts still earn nothing: a ledger row is a correlation handle,
  -- and this is the one place the author must stay unlinkable.
  if new.is_anonymous then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.moderation_status = 'approved' then
      perform public.aura_award(new.author_id, 2, 'post_created', 'post',
                                'post:' || new.id::text, '{}'::jsonb);
    end if;
    return null;
  end if;

  -- UPDATE OF moderation_status: pay on the transition into approved, take it
  -- back on the transition out of it.
  if new.moderation_status = 'approved' and old.moderation_status <> 'approved' then
    perform public.aura_award(new.author_id, 2, 'post_created', 'post',
                              'post:' || new.id::text, '{}'::jsonb);
  elsif new.moderation_status <> 'approved' and old.moderation_status = 'approved' then
    perform public.aura_reverse('post:' || new.id::text,
                                jsonb_build_object('cause', 'moderation'));
  end if;
  return null;
end;
$$;

drop trigger if exists posts_award_aura on public.posts;
create trigger posts_award_aura
  after insert or update of moderation_status on public.posts
  for each row execute function public.award_post_aura();

-- Deleting a post reverses BOTH its own reward and every still-active comment
-- reward it generated.
--
-- WHY THIS IS A *BEFORE* DELETE TRIGGER. The comment rewards are keyed on
-- (post, commenter), and to know which commenters to debit we must read
-- `post_comments` — which `on delete cascade` empties. Running before the
-- delete means the sources are still there to be read. 0181 had this backwards:
-- its reconcile ran on the comment cascade, saw the post was already gone, and
-- deliberately did nothing, so the author kept Aura for comments that no longer
-- existed. That was the remaining hole, and this closes it.
--
-- Every reversal goes through aura_reverse, which is a no-op on an already
-- reversed source — so the comment-delete path firing afterwards on the same
-- pair cannot debit twice.
create or replace function public.reverse_post_aura_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform public.aura_reverse('post:' || old.id::text,
                              jsonb_build_object('cause', 'post_deleted'));

  for r in
    select distinct c.author_id
      from public.post_comments c
     where c.post_id = old.id
  loop
    perform public.aura_reverse(
      'comment:' || old.id::text || ':' || r.author_id::text,
      jsonb_build_object('cause', 'post_deleted')
    );
  end loop;

  return old;
end;
$$;

drop trigger if exists posts_reverse_aura on public.posts;
create trigger posts_reverse_aura
  before delete on public.posts
  for each row execute function public.reverse_post_aura_on_delete();

-- ===========================================================================
-- 2. COMMENTS — 0181's rules, moved onto the shared register.
-- ===========================================================================
-- What 0181 got right is kept verbatim in substance: at most one reward per
-- (post, commenter), self-comments earn nothing, and only the LAST comment of a
-- pair reverses it. What changes is where the "already granted" fact lives.
--
-- `comment_aura_grants` cascaded away with its post, which is precisely why the
-- post-deletion hole could not be fixed inside it. `aura_grants` has no foreign
-- key to posts, so the record of what is owed survives the source's deletion
-- long enough to be reconciled — and the BEFORE DELETE trigger above uses it.
create or replace function public.award_comment_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.author_id then
    return null;   -- self-comments earn nothing
  end if;

  -- Idempotent on the pair key; the unique index settles concurrent first
  -- comments without an advisory lock.
  perform public.aura_award(
    v_author, 2, 'comment_received', 'comment',
    'comment:' || new.post_id::text || ':' || new.author_id::text,
    jsonb_build_object('post_id', new.post_id)
  );
  return null;
end;
$$;

-- The commenter id is NOT written into the ledger metadata any more. On an
-- anonymous post the author is masked everywhere else, and a metadata field
-- naming who commented on which post was a correlation handle in a table the
-- recipient can read. The source_key carries it in the private grant table
-- instead, where only the reconciler sees it.
create or replace function public.reconcile_comment_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The post is already gone: the BEFORE DELETE trigger on posts has reversed
  -- every pair for it. aura_reverse would be a no-op anyway; returning early
  -- saves the work on a large cascade.
  if not exists (select 1 from public.posts where id = old.post_id) then
    return null;
  end if;

  -- Only when this was the pair's LAST comment. The advisory lock serialises
  -- two concurrent deletes of the same pair's comments so they cannot both see
  -- "none left"; aura_reverse would still only pay out once, but this keeps the
  -- ledger free of a second no-op attempt.
  perform pg_advisory_xact_lock(
    hashtextextended(old.post_id::text || ':' || old.author_id::text, 0)
  );

  if exists (
    select 1 from public.post_comments
     where post_id = old.post_id and author_id = old.author_id
  ) then
    return null;
  end if;

  perform public.aura_reverse(
    'comment:' || old.post_id::text || ':' || old.author_id::text,
    jsonb_build_object('cause', 'comments_deleted')
  );
  return null;
end;
$$;

-- ===========================================================================
-- 3. MATCH / UNMATCH / REMATCH.
-- ===========================================================================
-- Carried forward from 0185 (which carried 0182) with ONE change: the +10 goes
-- through aura_award on a per-user, per-pair key. Everything else — mutual-like
-- integrity, canonical ordering, the conversation reopen, the anonymous
-- incoming-interest reconcile and its lock ordering — is unchanged.
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
  v_pair     text;
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

      if inserted then
        -- +10 each, keyed per user per canonical pair. A rematch after an
        -- unmatch awards again — but the previous grant was reversed, so a
        -- cycle nets to zero rather than paying every lap.
        v_pair := 'match:' || lo::text || ':' || hi::text;
        perform public.aura_award(new.swiper_id, 10, 'match', 'match',
                                  v_pair || ':' || new.swiper_id::text, '{}'::jsonb);
        perform public.aura_award(new.target_id, 10, 'match', 'match',
                                  v_pair || ':' || new.target_id::text, '{}'::jsonb);

        update public.conversations
           set closed_at = null, closed_reason = null
         where user_low = lo and user_high = hi and closed_at is not null;
      end if;
    end if;
  end if;

  if matched then
    perform public.reconcile_incoming_match_interest(
      least(new.target_id, new.swiper_id), false);
    perform public.reconcile_incoming_match_interest(
      greatest(new.target_id, new.swiper_id), false);
  else
    if new.direction = 'like' then
      if tg_op = 'INSERT' then
        v_new_like := true;
      elsif old.direction is distinct from 'like' then
        v_new_like := true;
      end if;
    end if;

    if v_new_like then
      insert into public.incoming_interest_wakes (recipient_id, liker_id, last_wake_at)
      values (new.target_id, new.swiper_id, now())
      on conflict (recipient_id, liker_id) do update
        set last_wake_at = now()
        where public.incoming_interest_wakes.last_wake_at < now() - interval '7 days'
      returning true into v_wake;
    end if;

    perform public.reconcile_incoming_match_interest(
      new.target_id, coalesce(v_wake, false)
    );
  end if;

  return new;
end;
$$;

-- Reversing on the MATCH ROW's deletion rather than inside unmatch_user() means
-- every path that removes a match is covered — the RPC, an admin cleanup, a
-- profile cascade — and none of them can forget.
create or replace function public.reverse_match_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair text := 'match:' || old.user_low::text || ':' || old.user_high::text;
begin
  perform public.aura_reverse(v_pair || ':' || old.user_low::text,
                              jsonb_build_object('cause', 'unmatched'));
  perform public.aura_reverse(v_pair || ':' || old.user_high::text,
                              jsonb_build_object('cause', 'unmatched'));
  return old;
end;
$$;

drop trigger if exists matches_reverse_aura on public.matches;
create trigger matches_reverse_aura
  before delete on public.matches
  for each row execute function public.reverse_match_aura();

-- ===========================================================================
-- 4. EVENTS — pay for verified attendance, once, and only once.
-- ===========================================================================
-- THE PRODUCT DECISION, stated because the old code never did: attending one
-- event is worth 20 Aura. That is what 0010's RSVP +15 and 0056's check-in +5
-- summed to for someone who actually turned up, so the honest maximum is
-- preserved — it simply now requires turning up, and is paid once, at check-in.
--
--   RSVP                    0. It is a reversible intention, not attendance.
--   withdraw before check-in 0 out, 0 back. Nothing to reverse.
--   first valid check-in    +20, keyed (event, attendee).
--   repeat / concurrent     nothing. The unique index makes it impossible.
--   withdraw after check-in the reward STAYS. Attendance really happened, and
--                           the evidence below outlives the RSVP row.
--
-- The RSVP award trigger is DROPPED, not rewritten: an RSVP has no reward left
-- to compute.
drop trigger if exists event_attendees_aura on public.event_attendees;

-- Immutable attendance evidence. Deliberately WITHOUT a foreign key to
-- `events`: deleting an event must not erase the proof that someone attended
-- it, or the retained reward would become unbacked and the audit unable to tell
-- a real attendance from a laundered one. The event's title is snapshotted for
-- the same reason. Cascades only on the PERSON, because account deletion
-- removes them from the economy entirely.
create table if not exists public.event_checkins (
  event_id     uuid not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  event_title  text,
  primary key (event_id, user_id)
);

alter table public.event_checkins enable row level security;
revoke all on public.event_checkins from anon;
grant select on public.event_checkins to authenticated;

drop policy if exists "attendees read their own check-ins" on public.event_checkins;
create policy "attendees read their own check-ins"
  on public.event_checkins for select to authenticated
  using (user_id = (select auth.uid()));

comment on table public.event_checkins is
  'Immutable proof of verified event attendance. No FK to events on purpose: deleting an event must not destroy the evidence that justifies a retained attendance reward. See migration 0187.';

-- check_in_attendee, carried forward from 0101 with the award replaced.
-- Authorization is unchanged (host / organizer / admin, enforced by the caller
-- chain that 0101 established) and so are all four result codes.
create or replace function public.check_in_attendee(p_event uuid, p_code uuid)
returns table(result text, attendee_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid;
  v_checked timestamptz;
  v_title   text;
begin
  if not (public.is_event_organizer(p_event, auth.uid())
          or public.is_admin(auth.uid())) then
    return query select 'unauthorized'::text, null::text; return;
  end if;

  select user_id, checked_in_at into v_user, v_checked
    from public.event_attendees
   where event_id = p_event and check_in_code = p_code;
  if not found then
    return query select 'invalid'::text, null::text; return;
  end if;

  if v_checked is not null then
    return query
      select 'already'::text, (select full_name from public.profiles where id = v_user);
    return;
  end if;

  update public.event_attendees
     set checked_in_at = now()
   where event_id = p_event and check_in_code = p_code;

  select title into v_title from public.events where id = p_event;

  -- Evidence first, then the reward. Both are idempotent, so a retried scan or
  -- two organizers scanning the same badge at once produce one of each.
  insert into public.event_checkins (event_id, user_id, event_title)
  values (p_event, v_user, v_title)
  on conflict (event_id, user_id) do nothing;

  perform public.aura_award(
    v_user, 20, 'event_attend', 'event_checkin',
    'event-checkin:' || p_event::text || ':' || v_user::text,
    jsonb_build_object('event_id', p_event)
  );

  return query
    select 'checked_in'::text, (select full_name from public.profiles where id = v_user);
end;
$$;

revoke all on function public.check_in_attendee(uuid, uuid) from public, anon;
grant execute on function public.check_in_attendee(uuid, uuid) to authenticated;

-- ===========================================================================
-- 5. HELP — one reward per REQUEST, transferable between helpers.
-- ===========================================================================
-- 0110 keyed the +15 on the RESPONSE id, so a request with five responses could
-- be "resolved" five times for +75. The key is now the REQUEST, so the request
-- contributes 15 in total no matter how the owner reselects; switching helper
-- reverses the previous one and awards the new one in the same transaction.
-- Carried forward from 0110 otherwise: the same authorization (owner or Help
-- moderator) and the same notification.
create or replace function public.select_help_response(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_request uuid;
  v_helper  uuid;
  v_author  uuid;
begin
  select r.request_id, r.author_id, q.author_id
    into v_request, v_helper, v_author
    from public.help_responses r
    join public.help_requests q on q.id = r.request_id
   where r.id = p_response_id;

  if v_request is null then
    raise exception 'response not found';
  end if;
  if v_author <> uid and not public.is_help_moderator(uid) then
    raise exception 'not authorized';
  end if;

  -- Serialise reselection on the request, so two owners' devices cannot
  -- interleave a reverse and an award into a double payment.
  perform pg_advisory_xact_lock(hashtextextended('help:' || v_request::text, 0));

  update public.help_responses set is_selected = false where request_id = v_request;
  update public.help_responses set is_selected = true  where id = p_response_id;
  update public.help_requests
     set selected_response_id = p_response_id,
         status = 'resolved',
         resolved_at = coalesce(resolved_at, now())
   where id = v_request;

  -- The author cannot pay themselves, whichever role selected the response.
  if v_helper = v_author then
    perform public.aura_reverse('help:' || v_request::text,
                                jsonb_build_object('cause', 'self_selected'));
    return;
  end if;

  -- Transfer: reversing first frees the request's single active source, so the
  -- award below is the only active reward for it. Re-selecting the SAME helper
  -- reverses and re-awards the same person for the same amount — net zero, and
  -- still exactly one active grant.
  perform public.aura_reverse('help:' || v_request::text,
                              jsonb_build_object('cause', 'reselected'));
  perform public.aura_award(
    v_helper, 15, 'help_thanked', 'help',
    'help:' || v_request::text,
    jsonb_build_object('request_id', v_request)
  );

  perform public.create_notification(
    v_helper, v_author, 'help_thanked', 'help',
    jsonb_build_object('request_id', v_request, 'response_id', p_response_id));
end;
$$;

revoke all on function public.select_help_response(uuid) from public, anon;
grant execute on function public.select_help_response(uuid) to authenticated;

-- Reopening withdraws the reward: the request is no longer resolved, so nothing
-- justifies an active help reward for it. Carried forward from 0109.
create or replace function public.reopen_help_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_author uuid;
begin
  select author_id into v_author from public.help_requests where id = p_id;
  if v_author is null then
    raise exception 'request not found';
  end if;
  if v_author <> uid and not public.is_help_moderator(uid) then
    raise exception 'not authorized';
  end if;

  update public.help_responses set is_selected = false where request_id = p_id;
  update public.help_requests
     set status = 'open', resolved_at = null, selected_response_id = null
   where id = p_id;

  perform public.aura_reverse('help:' || p_id::text,
                              jsonb_build_object('cause', 'reopened'));
end;
$$;

revoke all on function public.reopen_help_request(uuid) from public, anon;
grant execute on function public.reopen_help_request(uuid) to authenticated;

-- Deleting the request, or the selected response, leaves nothing to justify the
-- reward.
create or replace function public.reverse_help_aura_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'help_requests' then
    perform public.aura_reverse('help:' || old.id::text,
                                jsonb_build_object('cause', 'request_deleted'));
  else
    if old.is_selected then
      perform public.aura_reverse('help:' || old.request_id::text,
                                  jsonb_build_object('cause', 'response_deleted'));
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists help_requests_reverse_aura on public.help_requests;
create trigger help_requests_reverse_aura
  before delete on public.help_requests
  for each row execute function public.reverse_help_aura_on_delete();

drop trigger if exists help_responses_reverse_aura on public.help_responses;
create trigger help_responses_reverse_aura
  before delete on public.help_responses
  for each row execute function public.reverse_help_aura_on_delete();

-- ===========================================================================
-- 6. PROFILE COMPLETION — the race, closed by the index.
-- ===========================================================================
-- 0051 read `select exists(... reason = 'profile_completed')` and then
-- inserted. Two concurrent saves both read false and both paid. The unique
-- index on the source key now decides, and the completeness threshold and the
-- server-derived identity are unchanged. Deliberately never reversed: falling
-- below 90% later does not undo having completed the profile.
create or replace function public.award_completion_bonus()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pct integer;
begin
  if v_uid is null then
    return 0;
  end if;

  v_pct := public.compute_profile_completeness(v_uid);
  update public.profiles set completeness = v_pct where id = v_uid;

  if v_pct >= 90 then
    perform public.aura_award(
      v_uid, 25, 'profile_completed', 'profile',
      'profile-completed:' || v_uid::text,
      jsonb_build_object('completeness', v_pct)
    );
  end if;

  return v_pct;
end;
$$;

revoke all on function public.award_completion_bonus() from public, anon;
grant execute on function public.award_completion_bonus() to authenticated;

-- ===========================================================================
-- 7. ACHIEVEMENTS — reversible metrics lose the badge AND the reward.
-- ===========================================================================
-- THE RULE, chosen and applied consistently: an achievement measuring CURRENT
-- STATE is revoked, with its Aura reversed, when the state no longer supports
-- it. An achievement recording something that genuinely HAPPENED is permanent.
--
--   reversible   matches (social_butterfly), communities (the_joiner),
--                interactions (ice_breaker), aura_current (aura_follows_you)
--   permanent    posts (rookie — you did publish one), streak,
--                events_hosted_big, manual (the_socio, admin-granted)
--
-- Without this, every reversible metric was a laundering route: reach the
-- threshold, bank the badge Aura, delete the qualifying rows, keep the reward.
-- With it, re-earning restores exactly the original amount and a cycle nets to
-- zero — aura_award is keyed on (user, code), so the second earn cannot pay
-- twice while the first is still active.
create or replace function public.achievement_metric_reversible(p_metric text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_metric in ('matches', 'communities', 'interactions', 'aura_current');
$$;

-- The revoke path itself (reconcile_achievements) is defined in 0188, alongside
-- the metric functions it needs and the recursion guard both entry points
-- share. Splitting it that way keeps ONE guarded definition rather than two
-- that could disagree about when it is safe to re-enter.

-- ===========================================================================
-- 8. DATABASE-SIDE ANTI-SPAM — the limits stop being advisory.
-- ===========================================================================
-- The app enforced ~30 posts/hour and ~60 comments/hour in server actions. A
-- modified client that talks to PostgREST directly never runs those. These
-- BEFORE INSERT triggers put the same ceilings inside the transaction that
-- creates the Aura source, so both paths meet them.
--
-- The keys are derived from auth.uid() inside check_rate_limit_burst (0159),
-- which also takes an advisory lock — so they are neither forgeable by a client
-- parameter nor racy under a burst.
--
-- Ceilings are deliberately ABOVE the app's, not equal to them: the app keeps
-- giving the friendly "slow down" message at its own threshold, and this is the
-- backstop that a bypassing client hits instead. There is no per-post global
-- cap — one attacker must not be able to lock a thread for everyone else — and
-- the one-reward-per-commenter rule is unaffected, so a user may keep talking
-- after their reward is spent.
create or replace function public.enforce_post_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  if auth.uid() is null or auth.uid() <> new.author_id then
    return new;   -- definer/trigger-authored rows (imports, admin) are not rate limited
  end if;
  select allowed into v_allowed
    from public.check_rate_limit_burst('db_post_create', 40, interval '1 hour');
  if not coalesce(v_allowed, true) then
    raise exception 'post rate limit exceeded' using errcode = '53400';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit
  before insert on public.posts
  for each row execute function public.enforce_post_rate_limit();

create or replace function public.enforce_comment_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  if auth.uid() is null or auth.uid() <> new.author_id then
    return new;
  end if;
  select allowed into v_allowed
    from public.check_rate_limit_burst('db_comment_create', 80, interval '1 hour');
  if not coalesce(v_allowed, true) then
    raise exception 'comment rate limit exceeded' using errcode = '53400';
  end if;
  return new;
end;
$$;

drop trigger if exists post_comments_rate_limit on public.post_comments;
create trigger post_comments_rate_limit
  before insert on public.post_comments
  for each row execute function public.enforce_comment_rate_limit();

revoke all on function public.enforce_post_rate_limit() from public, anon, authenticated;
revoke all on function public.enforce_comment_rate_limit() from public, anon, authenticated;

-- ===========================================================================
-- 9. ADMIN — legitimate, bounded, and never disguised as an automated reward.
-- ===========================================================================
-- Unchanged in authority (admins only, reason required) with two additions: a
-- bound on the delta, and a grant for the positive case so an admin award earns
-- XP like any other. A NEGATIVE adjustment writes no grant, so a moderation
-- deduction removes Aura without erasing legitimately earned XP.
create or replace function public.admin_adjust_aura(
  p_user_id uuid,
  p_delta   integer,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  v_tx     uuid;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;
  if p_delta = 0 then
    raise exception 'delta must be non-zero';
  end if;
  if abs(p_delta) > 10000 then
    raise exception 'delta out of range (max 10000)' using errcode = '22003';
  end if;

  insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (p_user_id, p_delta, 'admin_adjust',
            jsonb_build_object('reason', trim(p_reason), 'admin', admin_id))
  returning id into v_tx;

  if p_delta > 0 then
    insert into public.aura_grants
      (user_id, reason, source_type, source_key, amount, metadata, grant_tx_id)
    values (p_user_id, 'admin_adjust', 'admin', 'admin:' || v_tx::text,
            p_delta, jsonb_build_object('admin', admin_id), v_tx)
    on conflict (source_key) where reversed_at is null do nothing;
  end if;

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    values (admin_id, 'aura_adjust', 'profile', p_user_id, trim(p_reason),
            jsonb_build_object('delta', p_delta));
end;
$$;

revoke all on function public.admin_adjust_aura(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_aura(uuid, integer, text) to authenticated;

-- Generic admin database-browser RPCs must not be able to reach the economy.
-- 0149 established the guardrail list; these are the tables that now join it.
-- (The browser's allow-list is a data-driven check inside admin_run_sql; these
-- revokes are the belt to that braces.)
revoke all on public.aura_grants from anon, authenticated;

-- The ledger is READ-ONLY to clients, at the privilege level and not merely by
-- the absence of a policy. Supabase grants tables to `authenticated` by
-- default, so until now the only thing standing between a modified client and
-- an INSERT was the fact that nobody had written an INSERT policy — one added
-- carelessly later would have opened the economy. SELECT stays (a student reads
-- their own ledger through the existing policy); every write is revoked.
-- Definer functions write as the owner and are unaffected.
revoke insert, update, delete on public.aura_transactions from authenticated;
revoke all on public.aura_transactions from anon;
revoke insert, update, delete on public.event_checkins from anon, authenticated;

-- ===========================================================================
-- 10. DEAD REWARD PATHS — marked inactive rather than left lying around.
-- ===========================================================================
-- `post_liked`, `community_join` and `daily_login` are values in the
-- `aura_reason` enum from 0001 that NO function has ever written. They are kept
-- in the enum (removing an enum value would rewrite history) and recorded here
-- as inactive, so the next reader does not mistake an unused reason for a path
-- that needs securing — or, worse, wire one up without a source key.
comment on type public.aura_reason is
  'Aura ledger reasons. ACTIVE: post_created, comment_received, match, event_attend (check-in only), help_thanked, profile_completed, achievement, admin_adjust. INACTIVE (no writer, do not add one without a source key + reversal): post_liked, community_join, daily_login. See migration 0187.';

-- =============================================================================
-- ROLLBACK
--   Re-run, in order: 0008's award_post_aura, 0181's award/reconcile comment
--   functions, 0185's handle_swipe_match, 0101's check_in_attendee, 0110's
--   select_help_response, 0109's reopen_help_request, 0051's
--   award_completion_bonus, 0011's admin_adjust_aura. Then drop the triggers
--   this migration added (posts_reverse_aura, matches_reverse_aura,
--   help_*_reverse_aura, posts_rate_limit, post_comments_rate_limit) and
--   re-create event_attendees_aura from 0010.
--   Grants already written stay valid; nothing here deletes ledger history.
-- =============================================================================
