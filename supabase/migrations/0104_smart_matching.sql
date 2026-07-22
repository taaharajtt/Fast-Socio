-- =============================================================================
-- FAST SOCIO — Smart Matching (purpose-based Discover modes)
--
-- Enhances Discover WITHOUT replacing the founder's date/social swipe flow.
-- The existing swipes / matches / message_requests / get_discover_candidates
-- machinery is untouched — this migration adds a PARALLEL, opt-in layer:
--
--   • matching_intents  — one per (user, mode). "I'm looking for a study buddy /
--     project partner / FYP teammate / …". Modes are CHECK-constrained text (no
--     new enum to version, mirroring the Help/Society precedent).
--   • matching_requests — a directed "let's connect for <mode>" ask with a
--     pending/accepted/declined/cancelled lifecycle.
--
-- SECURITY MODEL (this app has had RLS incidents — see 0078/0084-0088; posture
-- here is strict):
--   • matching_intents: a user may read/write ONLY their own rows (self policies,
--     trivial `user_id = auth.uid()` checks). Cross-user reads NEVER go through a
--     broad SELECT grant — the only path to other people's intents is the
--     SECURITY DEFINER get_matching_candidates() RPC, which bakes in the full
--     eligibility gate (blocks, mutes, discoverable, verified-only visibility).
--   • matching_requests: SELECT only for the two parties; ALL writes go through
--     SECURITY DEFINER RPCs that enforce block checks, self-only sending, spam
--     limits, and who-may-change-status. RLS stays deny-by-default for writes.
--   • Chat still opens only on a real connection: get_or_create_conversation
--     gains ONE additive eligibility branch for an ACCEPTED matching_request,
--     mirroring the existing accepted-message_request branch. Nothing existing
--     is loosened; the block check is preserved.
--   • Commute privacy is enforced at the DISPLAY layer (src/lib/matching) — the
--     intent stores a coarse area label only; exact location is never a column.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 0. Enum + preference-column extensions (safe: enum values are only used in
--    function bodies / at runtime; ADD COLUMN ... default backfills existing
--    notification_preferences rows so create_notification(...,'matching') never
--    hits a missing column).
-- ---------------------------------------------------------------------------
alter type public.report_target_type add value if not exists 'matching_request';

alter table public.notification_preferences
  add column if not exists matching boolean not null default true;

-- ---------------------------------------------------------------------------
-- 1. matching_intents — a user's "looking for…" per mode.
-- ---------------------------------------------------------------------------
create table if not exists public.matching_intents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  mode         text not null check (mode in (
                 'date','study','project','fyp','hackathon',
                 'event_buddy','mentor','sports','commute')),
  title        text check (title is null or char_length(title) <= 120),
  description  text check (description is null or char_length(description) <= 1000),
  tags         text[] not null default '{}',
  courses      text[] not null default '{}',
  skills       text[] not null default '{}',
  availability jsonb  not null default '{}'::jsonb,
  preferences  jsonb  not null default '{}'::jsonb,
  is_active    boolean not null default true,
  visibility   text not null default 'verified'
                 check (visibility in ('verified','all')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, mode),
  -- Cheap array-size guards so a client can't stuff unbounded arrays.
  check (array_length(tags, 1)    is null or array_length(tags, 1)    <= 20),
  check (array_length(courses, 1) is null or array_length(courses, 1) <= 20),
  check (array_length(skills, 1)  is null or array_length(skills, 1)  <= 20)
);

create index if not exists matching_intents_user_idx
  on public.matching_intents (user_id);
create index if not exists matching_intents_mode_active_idx
  on public.matching_intents (mode, is_active);
create index if not exists matching_intents_created_idx
  on public.matching_intents (created_at desc);

create trigger matching_intents_set_updated_at
  before update on public.matching_intents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. matching_requests — a directed connection ask for a given mode.
-- ---------------------------------------------------------------------------
create table if not exists public.matching_requests (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references auth.users (id) on delete cascade,
  recipient_id  uuid not null references auth.users (id) on delete cascade,
  mode          text not null check (mode in (
                  'date','study','project','fyp','hackathon',
                  'event_buddy','mentor','sports','commute')),
  intent_id     uuid references public.matching_intents (id) on delete set null,
  message       text check (message is null or char_length(message) <= 500),
  status        text not null default 'pending'
                  check (status in ('pending','accepted','declined','cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (requester_id, recipient_id, mode),
  check (requester_id <> recipient_id)
);

create index if not exists matching_requests_requester_idx
  on public.matching_requests (requester_id);
create index if not exists matching_requests_recipient_idx
  on public.matching_requests (recipient_id, status);
create index if not exists matching_requests_mode_status_idx
  on public.matching_requests (mode, status);
create index if not exists matching_requests_created_idx
  on public.matching_requests (created_at desc);

-- ===========================================================================
-- 3. Row Level Security
-- ===========================================================================
alter table public.matching_intents  enable row level security;
alter table public.matching_requests enable row level security;

-- intents: self-service. A user reads/writes only their OWN intents. Other
-- people's intents are reachable solely through get_matching_candidates().
revoke all on public.matching_intents from anon, authenticated;
grant select, insert, update, delete on public.matching_intents to authenticated;

create policy "read own intents"
  on public.matching_intents for select to authenticated
  using (user_id = (select auth.uid()));

create policy "insert own intents"
  on public.matching_intents for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "update own intents"
  on public.matching_intents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "delete own intents"
  on public.matching_intents for delete to authenticated
  using (user_id = (select auth.uid()));

-- requests: the two parties may READ their own rows. No client writes — every
-- mutation is a SECURITY DEFINER RPC (block/spam/authority enforced there).
revoke all on public.matching_requests from anon, authenticated;
grant select on public.matching_requests to authenticated;

create policy "read own requests"
  on public.matching_requests for select to authenticated
  using (requester_id = (select auth.uid())
      or recipient_id = (select auth.uid()));

-- ===========================================================================
-- 4. get_matching_candidates — eligible people with an active intent in `mode`.
--
-- Returns raw profile + intent fields plus two cross-table signals
-- (mutual_communities, shared_events). The transparent, mode-aware SCORE and
-- the privacy-safe "why this match" chips are computed in TS
-- (src/lib/matching/score.ts) against the VIEWER's own intent — this RPC only
-- decides WHO is eligible to be seen, never leaks anything a client shouldn't.
-- ===========================================================================
create or replace function public.get_matching_candidates(
  p_mode  text,
  p_limit integer default 30
)
returns table (
  id                 uuid,
  full_name          text,
  avatar_url         text,
  department         text,
  semester           smallint,
  graduation_year    smallint,
  verified           boolean,
  aura_score         integer,
  gender             text,
  interests          text[],
  intent_id          uuid,
  title              text,
  description        text,
  tags               text[],
  courses            text[],
  skills             text[],
  availability       jsonb,
  preferences        jsonb,
  mutual_communities integer,
  shared_events      integer,
  request_state      text
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select
      p.id as uid,
      coalesce(p.verified, false) as my_verified,
      array(select community_id from public.community_members where user_id = p.id) as my_comms,
      array(
        select ea.event_id from public.event_attendees ea
        join public.events e on e.id = ea.event_id
        where ea.user_id = p.id and e.starts_at >= now()
      ) as my_events
    from public.profiles p
    where p.id = auth.uid()
  )
  select
    p.id,
    p.full_name,
    p.avatar_url,
    case when coalesce(p.show_department, true) then p.department else null end as department,
    case when coalesce(p.show_semester, true)
         then public.current_semester(p.username) else null end as semester,
    p.graduation_year,
    coalesce(p.verified, false) as verified,
    case when coalesce(p.show_aura, true) then p.aura_score else 0 end as aura_score,
    p.gender,
    coalesce(p.interests, '{}') as interests,
    i.id as intent_id,
    i.title,
    i.description,
    i.tags,
    i.courses,
    i.skills,
    i.availability,
    i.preferences,
    (select count(*)::int from public.community_members cm
       where cm.user_id = p.id and cm.community_id = any (me.my_comms)) as mutual_communities,
    (select count(*)::int from public.event_attendees ea2
       where ea2.user_id = p.id and ea2.event_id = any (me.my_events)) as shared_events,
    (
      select r.status from public.matching_requests r
      where r.mode = p_mode
        and ((r.requester_id = me.uid and r.recipient_id = p.id)
          or (r.requester_id = p.id and r.recipient_id = me.uid))
      order by r.created_at desc
      limit 1
    ) as request_state
  from public.profiles p
  join me on true
  join public.matching_intents i
    on i.user_id = p.id and i.mode = p_mode and i.is_active = true
  where p.id <> me.uid
    and p.onboarding_completed = true
    and p.is_banned = false
    and p.discoverable = true
    and p.deactivated_at is null
    and p.shadow_banned = false
    and (p.suspended_until is null or p.suspended_until < now())
    -- verified-only intents are shown only to verified viewers.
    and (i.visibility = 'all' or me.my_verified)
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = me.uid and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = me.uid)
    )
    and not exists (
      select 1 from public.muted_users mu
      where mu.muter_id = me.uid and mu.muted_id = p.id
    )
    -- Hide people you already have a LIVE (pending/accepted) request with for
    -- this mode; declined/cancelled pairs may resurface so you can retry.
    and not exists (
      select 1 from public.matching_requests r2
      where r2.mode = p_mode
        and r2.status in ('pending','accepted')
        and ((r2.requester_id = me.uid and r2.recipient_id = p.id)
          or (r2.requester_id = p.id and r2.recipient_id = me.uid))
    )
  order by mutual_communities desc, shared_events desc, aura_score desc, i.updated_at desc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.get_matching_candidates(text, integer) from public, anon;
grant execute on function public.get_matching_candidates(text, integer) to authenticated;

-- ===========================================================================
-- 5. Write RPCs (SECURITY DEFINER; each does its own authorization)
-- ===========================================================================

-- send_matching_request → requester = caller only. Enforces block checks,
-- recipient eligibility, and anti-spam: one live request per (pair, mode). A
-- previously declined/cancelled request may be re-sent (flips back to pending);
-- a pending/accepted one cannot be spammed.
create or replace function public.send_matching_request(
  p_recipient uuid,
  p_mode      text,
  p_intent_id uuid,
  p_message   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  new_id uuid;
  r_ok   boolean;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if p_recipient is null or p_recipient = uid then
    raise exception 'invalid recipient';
  end if;
  if p_mode not in ('date','study','project','fyp','hackathon',
                    'event_buddy','mentor','sports','commute') then
    raise exception 'invalid mode';
  end if;

  -- Recipient must be a real, discoverable, un-banned account.
  select (pr.onboarding_completed and not pr.is_banned and pr.discoverable
          and pr.deactivated_at is null)
    into r_ok
    from public.profiles pr where pr.id = p_recipient;
  if not coalesce(r_ok, false) then
    raise exception 'recipient not available';
  end if;

  -- No requests across a block, in either direction.
  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = uid and b.blocked_id = p_recipient)
       or (b.blocker_id = p_recipient and b.blocked_id = uid)
  ) then
    raise exception 'blocked';
  end if;

  -- An intent_id, if supplied, must be the caller's own intent for this mode.
  if p_intent_id is not null and not exists (
    select 1 from public.matching_intents i
    where i.id = p_intent_id and i.user_id = uid and i.mode = p_mode
  ) then
    raise exception 'invalid intent';
  end if;

  insert into public.matching_requests
    (requester_id, recipient_id, mode, intent_id, message, status)
  values
    (uid, p_recipient, p_mode, p_intent_id,
     nullif(trim(coalesce(p_message, '')), ''), 'pending')
  on conflict (requester_id, recipient_id, mode) do update
     set status = 'pending',
         message = excluded.message,
         intent_id = excluded.intent_id,
         created_at = now(),
         responded_at = null
     where public.matching_requests.status in ('declined','cancelled')
  returning id into new_id;

  -- Conflict row was still pending/accepted → the ON CONFLICT predicate skipped
  -- the update and nothing came back. Treat as a spam no-op, not a new send.
  if new_id is null then
    raise exception 'a request already exists';
  end if;

  perform public.create_notification(
    p_recipient, uid, 'matching_request', 'matching',
    jsonb_build_object('mode', p_mode, 'request_id', new_id));

  return new_id;
end;
$$;

-- respond_matching_request → recipient only; pending → accepted / declined.
create or replace function public.respond_matching_request(
  p_id     uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  v_requester uuid;
  v_recipient uuid;
  v_status   text;
  v_mode     text;
begin
  select requester_id, recipient_id, status, mode
    into v_requester, v_recipient, v_status, v_mode
    from public.matching_requests where id = p_id;
  if v_requester is null then
    raise exception 'request not found';
  end if;
  if v_recipient <> uid then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'request is not pending';
  end if;

  update public.matching_requests
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_id;

  if p_accept then
    perform public.create_notification(
      v_requester, uid, 'matching_accepted', 'matching',
      jsonb_build_object('mode', v_mode, 'request_id', p_id));
  end if;
end;
$$;

-- cancel_matching_request → requester only; pending → cancelled.
create or replace function public.cancel_matching_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid         uuid := auth.uid();
  v_requester uuid;
  v_status    text;
begin
  select requester_id, status into v_requester, v_status
    from public.matching_requests where id = p_id;
  if v_requester is null then
    raise exception 'request not found';
  end if;
  if v_requester <> uid then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'only pending requests can be cancelled';
  end if;

  update public.matching_requests
     set status = 'cancelled', responded_at = now()
   where id = p_id;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'send_matching_request(uuid,text,uuid,text)',
    'respond_matching_request(uuid,boolean)',
    'cancel_matching_request(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

-- ===========================================================================
-- 6. Chat eligibility: allow an ACCEPTED matching_request to open a 1:1 chat.
--    Additive only — the block check and the two existing eligibility branches
--    (match / accepted message_request) are preserved verbatim.
-- ===========================================================================
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
  eligible boolean;
  blocked boolean;
begin
  if me is null or other_id is null or me = other_id then
    raise exception 'invalid participants';
  end if;

  lo := least(me, other_id);
  hi := greatest(me, other_id);

  -- Must not be blocked in either direction.
  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = me)
  ) into blocked;
  if blocked then
    raise exception 'blocked';
  end if;

  -- Must have a match, an accepted message request, OR an accepted matching
  -- (purpose-based) request between the two.
  select
    exists (select 1 from public.matches m where m.user_low = lo and m.user_high = hi)
    or exists (
      select 1 from public.message_requests r
      where r.status = 'accepted'
        and ((r.sender_id = me and r.recipient_id = other_id)
          or (r.sender_id = other_id and r.recipient_id = me))
    )
    or exists (
      select 1 from public.matching_requests mr
      where mr.status = 'accepted'
        and ((mr.requester_id = me and mr.recipient_id = other_id)
          or (mr.requester_id = other_id and mr.recipient_id = me))
    )
  into eligible;
  if not eligible then
    raise exception 'not connected';
  end if;

  insert into public.conversations (user_low, user_high)
    values (lo, hi)
    on conflict (user_low, user_high) do nothing;

  select id into conv_id from public.conversations
   where user_low = lo and user_high = hi;

  return conv_id;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;
