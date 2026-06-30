-- =============================================================================
-- FAST SOCIO — Discover, Likes, Matches, Message Requests (Phase 2)
-- swipes (like/pass) -> reciprocal like auto-creates a match. Message requests
-- are the gated first-contact channel. blocked_users is enforced in the
-- candidate query (SECURITY DEFINER function below). RLS on every table.
-- =============================================================================

set check_function_bodies = off;

create type public.swipe_direction as enum ('like', 'pass');
create type public.message_request_status as enum ('pending', 'accepted', 'declined');

-- ---------------------------------------------------------------------------
-- swipes: one row per (swiper, target). Immutable decisions.
-- ---------------------------------------------------------------------------
create table public.swipes (
  swiper_id   uuid not null references public.profiles (id) on delete cascade,
  target_id   uuid not null references public.profiles (id) on delete cascade,
  direction   public.swipe_direction not null,
  created_at  timestamptz not null default now(),
  primary key (swiper_id, target_id),
  check (swiper_id <> target_id)
);

create index swipes_target_like_idx
  on public.swipes (target_id) where direction = 'like';

alter table public.swipes enable row level security;

create policy "users read their own swipes"
  on public.swipes for select to authenticated
  using (swiper_id = auth.uid());

create policy "users record their own swipes"
  on public.swipes for insert to authenticated
  with check (swiper_id = auth.uid());

-- ---------------------------------------------------------------------------
-- matches: stored with user_low < user_high so each pair is unique.
-- ---------------------------------------------------------------------------
create table public.matches (
  id          uuid primary key default gen_random_uuid(),
  user_low    uuid not null references public.profiles (id) on delete cascade,
  user_high   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_low, user_high),
  check (user_low < user_high)
);

create index matches_user_low_idx on public.matches (user_low);
create index matches_user_high_idx on public.matches (user_high);

alter table public.matches enable row level security;

create policy "users read their own matches"
  on public.matches for select to authenticated
  using (user_low = auth.uid() or user_high = auth.uid());
-- No client writes: matches are created by the swipe trigger only.

-- ---------------------------------------------------------------------------
-- message_requests: first-contact channel, gated to one pending per pair.
-- ---------------------------------------------------------------------------
create table public.message_requests (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references public.profiles (id) on delete cascade,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  message       text not null check (char_length(message) between 1 and 500),
  status        public.message_request_status not null default 'pending',
  created_at    timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create unique index message_requests_pending_unique
  on public.message_requests (sender_id, recipient_id)
  where status = 'pending';
create index message_requests_recipient_idx
  on public.message_requests (recipient_id, status);

alter table public.message_requests enable row level security;

create policy "users see requests they sent or received"
  on public.message_requests for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

create policy "users send their own requests"
  on public.message_requests for insert to authenticated
  with check (sender_id = auth.uid());

create policy "recipients update request status"
  on public.message_requests for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reciprocal-like -> match trigger.
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
    insert into public.matches (user_low, user_high)
      values (lo, hi)
      on conflict (user_low, user_high) do nothing;

    -- Award Aura to both on a new match (single source of truth: aura_transactions).
    insert into public.aura_transactions (user_id, delta, reason)
      values (new.swiper_id, 10, 'match'), (new.target_id, 10, 'match');
  end if;

  return new;
end;
$$;

create trigger swipes_match_check
  after insert on public.swipes
  for each row execute function public.handle_swipe_match();

-- ---------------------------------------------------------------------------
-- Candidate query: profiles the caller hasn't swiped, isn't blocked by/blocking,
-- excluding self and non-onboarded users. Newest-first, paginated by limit.
-- ---------------------------------------------------------------------------
create or replace function public.get_discover_candidates(p_limit integer default 20)
returns setof public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select p.*
  from public.profiles p
  where p.id <> auth.uid()
    and p.onboarding_completed = true
    and p.is_banned = false
    and not exists (
      select 1 from public.swipes s
      where s.swiper_id = auth.uid() and s.target_id = p.id
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  order by p.created_at desc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.get_discover_candidates(integer) from public;
grant execute on function public.get_discover_candidates(integer) to authenticated;
