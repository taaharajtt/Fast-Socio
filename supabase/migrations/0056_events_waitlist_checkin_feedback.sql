-- =============================================================================
-- FAST SOCIO — Refactor Phase 6: Events waitlist, QR check-in, discussion,
-- reminders & post-event feedback. Purely additive: the existing RSVP flow,
-- +15 attend Aura, count sync, and admin moderation are all left intact.
--
--   * Capacity + waitlist: register_for_event() atomically seats or waitlists;
--     a trigger auto-promotes the earliest waitlisted user when a seat frees.
--   * QR check-in: each registration carries an unguessable check_in_code; the
--     organizer validates it via check_in_attendee() which awards a bonus.
--   * Discussion: an attendee-only event_messages thread (realtime).
--   * Reminders: a cron sweep inserts T-24h / T-1h reminder rows; a trigger
--     turns each into a notification (honours the 'events' preference).
--   * Feedback: 1–5 rating + comment from attendees of ended events; an
--     organizer-rating helper aggregates it for the host's profile.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Capacity + check-in columns (backfilled for existing rows via defaults).
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists capacity integer check (capacity is null or capacity > 0);

alter table public.event_attendees
  add column if not exists check_in_code uuid not null default gen_random_uuid(),
  add column if not exists checked_in_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Waitlist.
-- ---------------------------------------------------------------------------
create table public.event_waitlist (
  event_id    uuid not null references public.events (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_waitlist_event_idx on public.event_waitlist (event_id, created_at);

alter table public.event_waitlist enable row level security;

-- A user sees their own waitlist rows; the host (and admins) see the full queue.
create policy "waitlist visible to self and host"
  on public.event_waitlist for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.host_id = (select auth.uid())
    )
    or public.is_admin((select auth.uid()))
  );

-- Users may leave the waitlist themselves; joining happens only via
-- register_for_event() (no insert policy).
create policy "users leave waitlist"
  on public.event_waitlist for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. register_for_event — atomic seat-or-waitlist. Returns one of:
--    going | waitlisted | already_going | already_waitlisted | closed | ended
-- ---------------------------------------------------------------------------
create or replace function public.register_for_event(p_event uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.event_status;
  v_starts timestamptz;
  v_ends   timestamptz;
  v_cap    integer;
  v_count  integer;
begin
  select status, starts_at, ends_at, capacity
    into v_status, v_starts, v_ends, v_cap
    from public.events where id = p_event
    for update;                              -- serialize capacity checks

  if not found or v_status <> 'approved' then
    return 'closed';
  end if;
  if coalesce(v_ends, v_starts) < now() then
    return 'ended';
  end if;
  if exists (select 1 from public.event_attendees
             where event_id = p_event and user_id = v_uid) then
    return 'already_going';
  end if;
  if exists (select 1 from public.event_waitlist
             where event_id = p_event and user_id = v_uid) then
    return 'already_waitlisted';
  end if;

  select count(*) into v_count from public.event_attendees where event_id = p_event;

  if v_cap is not null and v_count >= v_cap then
    insert into public.event_waitlist (event_id, user_id) values (p_event, v_uid);
    return 'waitlisted';
  end if;

  insert into public.event_attendees (event_id, user_id) values (p_event, v_uid);
  return 'going';
end;
$$;

revoke all on function public.register_for_event(uuid) from public;
revoke execute on function public.register_for_event(uuid) from anon;
grant execute on function public.register_for_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Auto-promote the earliest waitlisted user when a seat frees.
-- ---------------------------------------------------------------------------
create or replace function public.promote_from_waitlist(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap    integer;
  v_status public.event_status;
  v_starts timestamptz;
  v_ends   timestamptz;
  v_count  integer;
  v_next   uuid;
begin
  select capacity, status, starts_at, ends_at
    into v_cap, v_status, v_starts, v_ends
    from public.events where id = p_event;

  if v_cap is null or v_status <> 'approved'
     or coalesce(v_ends, v_starts) < now() then
    return;                                  -- unlimited / closed / past
  end if;

  select count(*) into v_count from public.event_attendees where event_id = p_event;
  if v_count >= v_cap then
    return;                                  -- still full
  end if;

  select user_id into v_next
    from public.event_waitlist
    where event_id = p_event
    order by created_at asc
    limit 1;
  if v_next is null then
    return;                                  -- empty queue
  end if;

  delete from public.event_waitlist where event_id = p_event and user_id = v_next;
  -- Insert fires the existing attend-Aura + count-sync triggers.
  insert into public.event_attendees (event_id, user_id) values (p_event, v_next);

  perform public.create_notification(
    v_next, null, 'waitlist_promoted', 'events',
    jsonb_build_object('event_id', p_event)
  );
end;
$$;

create or replace function public.trg_promote_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.promote_from_waitlist(old.event_id);
  return null;
end;
$$;

create trigger event_attendees_promote
  after delete on public.event_attendees
  for each row execute function public.trg_promote_waitlist();

-- ---------------------------------------------------------------------------
-- 5. QR check-in. Organizer (or admin) validates a registration's code.
--    Returns status: checked_in | already | invalid | not_authorized
-- ---------------------------------------------------------------------------
create or replace function public.check_in_attendee(p_event uuid, p_code uuid)
returns table (status text, attendee_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_host    uuid;
  v_user    uuid;
  v_checked timestamptz;
begin
  select host_id into v_host from public.events where id = p_event;
  if v_host is null then
    return query select 'invalid'::text, null::text; return;
  end if;
  if v_host <> v_uid and not public.is_admin(v_uid) then
    return query select 'not_authorized'::text, null::text; return;
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

  -- Attendance bonus (XP follows automatically via the ledger, Phase 5).
  insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (v_user, 5, 'event_attend',
            jsonb_build_object('event_id', p_event, 'checkin', true));

  return query
    select 'checked_in'::text, (select full_name from public.profiles where id = v_user);
end;
$$;

revoke all on function public.check_in_attendee(uuid, uuid) from public;
revoke execute on function public.check_in_attendee(uuid, uuid) from anon;
grant execute on function public.check_in_attendee(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Event discussion (attendee-only thread).
-- ---------------------------------------------------------------------------
create table public.event_messages (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index event_messages_event_idx on public.event_messages (event_id, created_at);

alter table public.event_messages enable row level security;

-- Read: attendees, plus the host and admins (so organizers can moderate).
create policy "event discussion readable by attendees"
  on public.event_messages for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (e.host_id = (select auth.uid()) or public.is_admin((select auth.uid())))
    )
    or exists (
      select 1 from public.event_attendees a
      where a.event_id = event_messages.event_id and a.user_id = (select auth.uid())
    )
  );

-- Post: attendees of an approved event only.
create policy "attendees post to event discussion"
  on public.event_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.event_attendees a
      join public.events e on e.id = a.event_id
      where a.event_id = event_messages.event_id
        and a.user_id = (select auth.uid())
        and e.status = 'approved'
    )
  );

-- Realtime for live discussion (mirrors community_chat_messages).
alter publication supabase_realtime add table public.event_messages;

-- ---------------------------------------------------------------------------
-- 7. Reminders: cron sweep inserts rows, a trigger turns each into a
--    notification (respecting the 'events' preference via create_notification).
-- ---------------------------------------------------------------------------
create table public.event_reminders (
  event_id    uuid not null references public.events (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('24h', '1h')),
  created_at  timestamptz not null default now(),
  primary key (event_id, user_id, kind)
);

alter table public.event_reminders enable row level security;

create policy "reminders self-readable"
  on public.event_reminders for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.trg_event_reminder_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(
    new.user_id, null, 'event_reminder', 'events',
    jsonb_build_object('event_id', new.event_id, 'kind', new.kind)
  );
  return new;
end;
$$;

create trigger event_reminders_notify
  after insert on public.event_reminders
  for each row execute function public.trg_event_reminder_notify();

-- Insert reminder rows for approaching events the attendee hasn't been
-- reminded of yet. Idempotent via the primary key + not-exists guard.
create or replace function public.sweep_event_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_reminders (event_id, user_id, kind)
  select a.event_id, a.user_id, '24h'
  from public.event_attendees a
  join public.events e on e.id = a.event_id
  where e.status = 'approved'
    and e.starts_at between now() and now() + interval '24 hours'
    and not exists (
      select 1 from public.event_reminders r
      where r.event_id = a.event_id and r.user_id = a.user_id and r.kind = '24h'
    )
  on conflict do nothing;

  insert into public.event_reminders (event_id, user_id, kind)
  select a.event_id, a.user_id, '1h'
  from public.event_attendees a
  join public.events e on e.id = a.event_id
  where e.status = 'approved'
    and e.starts_at between now() and now() + interval '1 hour'
    and not exists (
      select 1 from public.event_reminders r
      where r.event_id = a.event_id and r.user_id = a.user_id and r.kind = '1h'
    )
  on conflict do nothing;
end;
$$;

select cron.schedule(
  'event-reminder-sweep',
  '*/15 * * * *',
  $$select public.sweep_event_reminders()$$
);

-- ---------------------------------------------------------------------------
-- 8. Post-event feedback + organizer rating.
-- ---------------------------------------------------------------------------
create table public.event_feedback (
  event_id    uuid not null references public.events (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (comment is null or char_length(comment) <= 500),
  created_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_feedback_event_idx on public.event_feedback (event_id);

alter table public.event_feedback enable row level security;

create policy "event feedback is public"
  on public.event_feedback for select to authenticated using (true);

-- Only attendees of an event that has already ended may leave feedback.
create policy "attendees leave feedback for ended events"
  on public.event_feedback for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.event_attendees a
      join public.events e on e.id = a.event_id
      where a.event_id = event_feedback.event_id
        and a.user_id = (select auth.uid())
        and coalesce(e.ends_at, e.starts_at) < now()
    )
  );

create policy "users edit their feedback"
  on public.event_feedback for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Aggregate an organizer's rating across all their events (for the profile).
create or replace function public.get_organizer_rating(p_host uuid)
returns table (avg_rating numeric, review_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select round(avg(f.rating), 1) as avg_rating, count(*) as review_count
  from public.event_feedback f
  join public.events e on e.id = f.event_id
  where e.host_id = p_host;
$$;

revoke all on function public.get_organizer_rating(uuid) from public;
grant execute on function public.get_organizer_rating(uuid) to authenticated;
grant execute on function public.sweep_event_reminders() to authenticated;
