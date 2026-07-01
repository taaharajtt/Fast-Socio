-- =============================================================================
-- FAST SOCIO — Events (Phase 6)
-- Events are ADMIN-APPROVED (consistent with communities). A student submits an
-- event (pending); an admin approves/rejects via a logged SECURITY DEFINER
-- function. Attending awards +15 Aura (reversed if the RSVP is withdrawn). An
-- event may be standalone or attached to a community (owner/mod only).
-- =============================================================================

set check_function_bodies = off;

create type public.event_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references public.profiles (id) on delete cascade,
  community_id    uuid references public.communities (id) on delete set null,
  title           text not null check (char_length(title) between 2 and 120),
  description     text check (description is null or char_length(description) <= 1000),
  category        text not null default 'Social',
  location        text,
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  cover_url       text,
  status          public.event_status not null default 'pending',
  attendee_count  integer not null default 0,
  created_at      timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create index events_status_starts_idx on public.events (status, starts_at);
create index events_host_idx on public.events (host_id);
create index events_community_idx on public.events (community_id);

alter table public.events enable row level security;

create policy "approved events are visible"
  on public.events for select to authenticated
  using (status = 'approved' or host_id = auth.uid() or public.is_admin(auth.uid()));

-- Any student may submit a standalone event; community events require the host
-- to be an owner/moderator of that community. Always pending + self-hosted.
create policy "students submit pending events"
  on public.events for insert to authenticated
  with check (
    host_id = auth.uid()
    and status = 'pending'
    and (
      community_id is null
      or exists (
        select 1 from public.community_members m
        where m.community_id = events.community_id
          and m.user_id = auth.uid()
          and m.role in ('owner', 'moderator')
      )
    )
  );

create policy "hosts edit their events"
  on public.events for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());

create or replace function public.protect_event_status()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.event_moderation', true) = '1' then
    return new;
  end if;
  if auth.role() = 'authenticated' then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger events_protect_status
  before update on public.events
  for each row execute function public.protect_event_status();

-- ---------------------------------------------------------------------------
-- event_attendees (RSVP). Attending awards +15 Aura; withdrawing reverses it.
-- ---------------------------------------------------------------------------
create table public.event_attendees (
  event_id    uuid not null references public.events (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_attendees_user_idx on public.event_attendees (user_id);

alter table public.event_attendees enable row level security;

create policy "attendees are visible"
  on public.event_attendees for select to authenticated using (true);

create policy "students rsvp to approved events"
  on public.event_attendees for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.status = 'approved'
    )
  );

create policy "students withdraw their rsvp"
  on public.event_attendees for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.sync_attendee_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eid uuid := coalesce(new.event_id, old.event_id);
begin
  update public.events
     set attendee_count = (select count(*) from public.event_attendees where event_id = eid)
   where id = eid;
  return null;
end;
$$;

create trigger event_attendees_sync
  after insert or delete on public.event_attendees
  for each row execute function public.sync_attendee_count();

-- Aura: +15 on RSVP, -15 reversal on withdrawal (keeps the ledger consistent).
create or replace function public.event_attend_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.aura_transactions (user_id, delta, reason, metadata)
      values (new.user_id, 15, 'event_attend', jsonb_build_object('event_id', new.event_id));
  elsif tg_op = 'DELETE' then
    insert into public.aura_transactions (user_id, delta, reason, metadata)
      values (old.user_id, -15, 'event_attend',
              jsonb_build_object('event_id', old.event_id, 'reversal', true));
  end if;
  return null;
end;
$$;

create trigger event_attendees_aura
  after insert or delete on public.event_attendees
  for each row execute function public.event_attend_aura();

-- ---------------------------------------------------------------------------
-- Admin moderation: approve / reject with audit logging.
-- ---------------------------------------------------------------------------
create or replace function public.moderate_event(
  p_event_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  perform set_config('app.event_moderation', '1', true);
  update public.events
     set status = case when p_approve then 'approved'::public.event_status
                       else 'rejected'::public.event_status end
   where id = p_event_id;
  perform set_config('app.event_moderation', '0', true);

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id,
            case when p_approve then 'approve_event' else 'reject_event' end,
            'event', p_event_id, null);
end;
$$;

revoke all on function public.moderate_event(uuid, boolean) from public;
grant execute on function public.moderate_event(uuid, boolean) to authenticated;
