-- =============================================================================
-- FAST SOCIO — Event co-organizers + host delete (events feature pack)
--
-- Adds three capabilities on top of the single-host events model (0010/0056):
--   1. A visible, searchable attendee list is a pure read of event_attendees +
--      profiles (already SELECT-open), so it needs NO schema — the UI does it.
--   2. delete_event(): the host (or an admin) can permanently delete an event.
--      Cascades remove attendees/waitlist/messages/feedback/organizers; the
--      existing attend-aura reversal + count-sync triggers fire per row (a
--      cancelled event should not keep granting attendance Aura).
--   3. event_organizers: a host may appoint co-organizers who can run the event
--      (door check-in, discussion) and appear as organizers — without being able
--      to delete it or appoint others (those stay host/admin only).
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- event_organizers — co-organizers of an event (the host is the implicit
-- primary organizer and is NOT stored here).
-- ---------------------------------------------------------------------------
create table if not exists public.event_organizers (
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists event_organizers_user_idx
  on public.event_organizers (user_id);

alter table public.event_organizers enable row level security;

-- Co-organizers are public (like attendees) so the event page can list them to
-- everyone. All writes go through the host/admin RPCs below — no client policy.
create policy "event organizers are visible"
  on public.event_organizers for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- is_event_organizer(event, user) — true for the host OR a co-organizer.
-- SECURITY DEFINER so RLS policies can call it without needing table grants.
-- ---------------------------------------------------------------------------
create or replace function public.is_event_organizer(p_event uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.events e
                 where e.id = p_event and e.host_id = p_user)
      or exists (select 1 from public.event_organizers o
                 where o.event_id = p_event and o.user_id = p_user);
$$;

revoke all on function public.is_event_organizer(uuid, uuid) from public;
revoke execute on function public.is_event_organizer(uuid, uuid) from anon;
grant execute on function public.is_event_organizer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_event() — host or admin only. Audited; the cascade does the rest.
-- ---------------------------------------------------------------------------
create or replace function public.delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  v_host uuid;
begin
  select host_id into v_host from public.events where id = p_event_id;
  if v_host is null then
    raise exception 'event not found';
  end if;
  -- Deleting is the owner's call: co-organizers help run it, they don't delete.
  if v_host <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (uid, 'delete_event', 'event', p_event_id, null);

  delete from public.events where id = p_event_id;
end;
$$;

revoke all on function public.delete_event(uuid) from public;
revoke execute on function public.delete_event(uuid) from anon;
grant execute on function public.delete_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- add_event_organizer / remove_event_organizer — host or admin only.
-- ---------------------------------------------------------------------------
create or replace function public.add_event_organizer(p_event uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  v_host uuid;
begin
  select host_id into v_host from public.events where id = p_event;
  if v_host is null then
    raise exception 'event not found';
  end if;
  if v_host <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  if p_user = v_host then
    raise exception 'the host is already the organizer';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user and onboarding_completed and not is_banned
  ) then
    raise exception 'that student was not found';
  end if;

  insert into public.event_organizers (event_id, user_id, added_by)
    values (p_event, p_user, uid)
    on conflict (event_id, user_id) do nothing;
end;
$$;

revoke all on function public.add_event_organizer(uuid, uuid) from public;
revoke execute on function public.add_event_organizer(uuid, uuid) from anon;
grant execute on function public.add_event_organizer(uuid, uuid) to authenticated;

create or replace function public.remove_event_organizer(p_event uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  v_host uuid;
begin
  select host_id into v_host from public.events where id = p_event;
  if v_host is null then
    raise exception 'event not found';
  end if;
  if v_host <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;

  delete from public.event_organizers where event_id = p_event and user_id = p_user;
end;
$$;

revoke all on function public.remove_event_organizer(uuid, uuid) from public;
revoke execute on function public.remove_event_organizer(uuid, uuid) from anon;
grant execute on function public.remove_event_organizer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Extend organizer powers: co-organizers can run door check-in and take part
-- in the discussion, same as the host. (delete + appoint stay host/admin.)
-- ---------------------------------------------------------------------------

-- check-in: host was the only non-admin allowed; now any organizer.
create or replace function public.check_in_attendee(p_event uuid, p_code uuid)
returns table (status text, attendee_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_user    uuid;
  v_checked timestamptz;
begin
  if not exists (select 1 from public.events where id = p_event) then
    return query select 'invalid'::text, null::text; return;
  end if;
  if not public.is_event_organizer(p_event, v_uid) and not public.is_admin(v_uid) then
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

  insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (v_user, 5, 'event_attend',
            jsonb_build_object('event_id', p_event, 'checkin', true));

  return query
    select 'checked_in'::text, (select full_name from public.profiles where id = v_user);
end;
$$;

-- discussion read: attendees + host/admin, now + co-organizers.
alter policy "event discussion readable by attendees" on public.event_messages
  using (
    public.is_event_organizer(event_id, (select auth.uid()))
    or public.is_admin((select auth.uid()))
    or exists (
      select 1 from public.event_attendees a
      where a.event_id = event_messages.event_id and a.user_id = (select auth.uid())
    )
  );

-- discussion post: attendees of an approved event, now + co-organizers.
alter policy "attendees post to event discussion" on public.event_messages
  with check (
    sender_id = (select auth.uid())
    and exists (select 1 from public.events e where e.id = event_id and e.status = 'approved')
    and (
      public.is_event_organizer(event_id, (select auth.uid()))
      or exists (
        select 1 from public.event_attendees a
        where a.event_id = event_messages.event_id and a.user_id = (select auth.uid())
      )
    )
  );

-- waitlist queue: self + host, now + co-organizers + admin (for check-in view).
alter policy "waitlist visible to self and host" on public.event_waitlist
  using (
    user_id = (select auth.uid())
    or public.is_event_organizer(event_id, (select auth.uid()))
    or public.is_admin((select auth.uid()))
  );
