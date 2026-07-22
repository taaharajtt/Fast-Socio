-- =============================================================================
-- FAST SOCIO — Campus Help Network (Phase 1)
--
-- A structured utility surface where students ask for help, respond, follow,
-- resolve, and thank helpers. Deliberately NOT a feed category: every request
-- carries status (open/resolved), urgency, category, and a gratitude loop that
-- awards Aura to the helper who is selected.
--
-- SECURITY MODEL (this app has had RLS incidents — see mig 0078/0084-0088, so
-- the posture here is strict and centralized):
--   • READS go through anonymity-masking VIEWS (help_request_feed /
--     help_response_feed). The base tables have NO client SELECT grant, so a
--     client can never read author_id of an anonymous request directly — the
--     view is the only read path and it nulls the author for non-owner/admin.
--   • WRITES to requests/responses go through SECURITY DEFINER RPCs that do
--     their own authorization (owner/admin/response-author checks), so there is
--     no broad client INSERT/UPDATE/DELETE surface to get wrong. RLS stays
--     enabled with a deny-by-default posture as defense in depth.
--   • FOLLOWERS are the one direct-write path (self rows only) via RLS, because
--     the check is trivial (user_id = auth.uid()).
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 0. Extend existing enums. These are only referenced inside function bodies
--    (not executed at migration time) and by the app at runtime, so adding the
--    values in this migration is safe even under a single-transaction runner.
-- ---------------------------------------------------------------------------
alter type public.report_target_type add value if not exists 'help_request';
alter type public.report_target_type add value if not exists 'help_response';
alter type public.aura_reason        add value if not exists 'help_thanked';

-- A per-user toggle for Help notifications. Default true; every user already
-- gets a notification_preferences row on signup (mig 0001/0094), and ADD COLUMN
-- ... default true backfills existing rows, so create_notification(..., 'help')
-- never hits a missing-column error.
alter table public.notification_preferences
  add column if not exists help boolean not null default true;

-- ---------------------------------------------------------------------------
-- 1. help_requests — one ask. Category/urgency/status are constrained text (no
--    new enums to version); labels live in TS (src/lib/help/constants.ts).
-- ---------------------------------------------------------------------------
create table if not exists public.help_requests (
  id                   uuid primary key default gen_random_uuid(),
  author_id            uuid not null references auth.users (id) on delete cascade,
  title                text not null,
  body                 text not null,
  category             text not null
    check (category in ('academic','notes','project_partner','ride',
                        'lost_found','society','campus_question')),
  urgency              text not null default 'normal'
    check (urgency in ('low','normal','urgent')),
  department           text,
  semester             smallint check (semester is null or semester between 1 and 12),
  course_code          text,
  is_anonymous         boolean not null default false,
  allow_dms            boolean not null default true,
  status               text not null default 'open'
    check (status in ('open','resolved')),
  selected_response_id uuid,        -- FK added after help_responses exists
  response_count       integer not null default 0,
  follower_count       integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  resolved_at          timestamptz
);

-- Feed/query indexes (spec §Security): every filterable dimension is indexed.
create index if not exists help_requests_status_created_idx
  on public.help_requests (status, created_at desc);
create index if not exists help_requests_category_idx   on public.help_requests (category);
create index if not exists help_requests_urgency_idx     on public.help_requests (urgency);
create index if not exists help_requests_department_idx  on public.help_requests (department);
create index if not exists help_requests_semester_idx    on public.help_requests (semester);
create index if not exists help_requests_course_idx      on public.help_requests (course_code);
create index if not exists help_requests_author_idx      on public.help_requests (author_id);
create index if not exists help_requests_created_idx      on public.help_requests (created_at desc);

create trigger help_requests_set_updated_at
  before update on public.help_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. help_responses — an offer ("I can help") or a written answer.
-- ---------------------------------------------------------------------------
create table if not exists public.help_responses (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.help_requests (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete cascade,
  body        text,
  kind        text not null default 'offer' check (kind in ('offer','answer')),
  is_selected boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists help_responses_request_idx
  on public.help_responses (request_id, created_at);
create index if not exists help_responses_author_idx
  on public.help_responses (author_id);

create trigger help_responses_set_updated_at
  before update on public.help_responses
  for each row execute function public.set_updated_at();

-- Now that help_responses exists, point selected_response_id at it. ON DELETE
-- SET NULL: deleting the chosen response just clears the selection.
alter table public.help_requests
  add constraint help_requests_selected_response_fkey
  foreign key (selected_response_id)
  references public.help_responses (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. help_request_followers — who wants updates on a request.
-- ---------------------------------------------------------------------------
create table if not exists public.help_request_followers (
  request_id uuid not null references public.help_requests (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create index if not exists help_request_followers_user_idx
  on public.help_request_followers (user_id);

-- ===========================================================================
-- 4. Row Level Security
-- ===========================================================================
alter table public.help_requests          enable row level security;
alter table public.help_responses         enable row level security;
alter table public.help_request_followers enable row level security;

-- help_requests / help_responses: NO client policies. All reads come through
-- the masking views below and all writes through SECURITY DEFINER RPCs. With
-- RLS enabled and no permissive policy, any stray direct client query is denied
-- by default — belt and braces on top of the revoked grants.
revoke all on public.help_requests  from anon, authenticated;
revoke all on public.help_responses from anon, authenticated;

-- Followers: the only direct client-write table. A student may see, add, and
-- remove ONLY their own follow rows. Counts come from the view/column, so no
-- one needs to read other people's follow rows.
revoke all on public.help_request_followers from anon, authenticated;
grant select, insert, delete on public.help_request_followers to authenticated;

create policy "read own follows"
  on public.help_request_followers for select to authenticated
  using (user_id = (select auth.uid()));

create policy "follow as self"
  on public.help_request_followers for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "unfollow as self"
  on public.help_request_followers for delete to authenticated
  using (user_id = (select auth.uid()));

-- ===========================================================================
-- 5. Anonymity-masking read views
--
-- Plain (non-security_invoker) views run with the owner's rights and bypass the
-- base tables' RLS — which is exactly what we want: authenticated has no direct
-- read on the base tables, and the ONLY read path is these views, which decide
-- per row whether the viewer may see the author. auth.uid() still resolves to
-- the caller inside the view, so masking + is_mine + is_following are correct.
-- Only ever-public profile fields (name, roll number, avatar) are exposed.
-- ===========================================================================
create or replace view public.help_request_feed
with (security_invoker = false) as
select
  r.id,
  r.title,
  r.body,
  r.category,
  r.urgency,
  r.department,
  r.semester,
  r.course_code,
  r.is_anonymous,
  r.allow_dms,
  r.status,
  r.selected_response_id,
  r.response_count,
  r.follower_count,
  r.created_at,
  r.updated_at,
  r.resolved_at,
  (r.author_id = (select auth.uid()))                                    as is_mine,
  exists (
    select 1 from public.help_request_followers f
    where f.request_id = r.id and f.user_id = (select auth.uid())
  )                                                                       as is_following,
  -- Author identity is revealed only to the owner or an admin when anonymous.
  case when r.is_anonymous
            and r.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else r.author_id end                                    as author_id,
  case when r.is_anonymous
            and r.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.full_name end                                    as author_name,
  case when r.is_anonymous
            and r.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.username end                                     as author_username,
  case when r.is_anonymous
            and r.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.avatar_url end                                   as author_avatar_url
from public.help_requests r
join public.profiles p on p.id = r.author_id;

-- Responses: helpers are public (offering help is a public act). The ONE case
-- that would deanonymize is the request author replying on their OWN anonymous
-- request — that response's author is masked the same way.
create or replace view public.help_response_feed
with (security_invoker = false) as
select
  resp.id,
  resp.request_id,
  resp.body,
  resp.kind,
  resp.is_selected,
  resp.created_at,
  (resp.author_id = (select auth.uid()))                                 as is_mine,
  case when req.is_anonymous and resp.author_id = req.author_id
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else resp.author_id end                                 as author_id,
  case when req.is_anonymous and resp.author_id = req.author_id
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then true else false end                                          as author_is_op_anon,
  case when req.is_anonymous and resp.author_id = req.author_id
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.full_name end                                    as author_name,
  case when req.is_anonymous and resp.author_id = req.author_id
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.username end                                     as author_username,
  case when req.is_anonymous and resp.author_id = req.author_id
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.avatar_url end                                   as author_avatar_url
from public.help_responses resp
join public.help_requests req on req.id = resp.request_id
join public.profiles p on p.id = resp.author_id;

revoke all on public.help_request_feed  from anon, authenticated;
revoke all on public.help_response_feed from anon, authenticated;
grant select on public.help_request_feed  to authenticated;
grant select on public.help_response_feed to authenticated;

-- ===========================================================================
-- 6. Counter-sync triggers (response_count / follower_count)
-- ===========================================================================
create or replace function public.help_sync_response_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.help_requests
       set response_count = response_count + 1
     where id = new.request_id;
  elsif tg_op = 'DELETE' then
    update public.help_requests
       set response_count = greatest(response_count - 1, 0)
     where id = old.request_id;
  end if;
  return null;
end;
$$;

create trigger help_responses_count
  after insert or delete on public.help_responses
  for each row execute function public.help_sync_response_count();

create or replace function public.help_sync_follower_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.help_requests
       set follower_count = follower_count + 1
     where id = new.request_id;
  elsif tg_op = 'DELETE' then
    update public.help_requests
       set follower_count = greatest(follower_count - 1, 0)
     where id = old.request_id;
  end if;
  return null;
end;
$$;

create trigger help_followers_count
  after insert or delete on public.help_request_followers
  for each row execute function public.help_sync_follower_count();

-- ===========================================================================
-- 7. Notification triggers
-- ===========================================================================

-- New response → notify the request author (skips self-responses via
-- create_notification's own guard).
create or replace function public.notify_help_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.help_requests where id = new.request_id;
  perform public.create_notification(
    v_author, new.author_id, 'help_response', 'help',
    jsonb_build_object('request_id', new.request_id, 'response_id', new.id));
  return null;
end;
$$;

create trigger help_responses_notify
  after insert on public.help_responses
  for each row execute function public.notify_help_response();

-- New follower → let the author know interest is building.
create or replace function public.notify_help_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.help_requests where id = new.request_id;
  perform public.create_notification(
    v_author, new.user_id, 'help_follow', 'help',
    jsonb_build_object('request_id', new.request_id));
  return null;
end;
$$;

create trigger help_followers_notify
  after insert on public.help_request_followers
  for each row execute function public.notify_help_follow();

-- Trigger functions are invoked by the trigger mechanism, never called directly
-- by a client, so drop the default PUBLIC execute grant (advisor hardening).
revoke all on function public.help_sync_response_count() from public, anon, authenticated;
revoke all on function public.help_sync_follower_count() from public, anon, authenticated;
revoke all on function public.notify_help_response()     from public, anon, authenticated;
revoke all on function public.notify_help_follow()       from public, anon, authenticated;

-- ===========================================================================
-- 8. Write RPCs (SECURITY DEFINER; each does its own authorization)
-- ===========================================================================

-- create_help_request → returns the new id. Validation is also enforced in the
-- server action, but the CHECK constraints here are the last line of defense.
create or replace function public.create_help_request(
  p_title       text,
  p_body        text,
  p_category    text,
  p_urgency     text,
  p_department  text,
  p_semester    smallint,
  p_course_code text,
  p_is_anonymous boolean,
  p_allow_dms   boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if length(coalesce(trim(p_title), '')) < 4 then
    raise exception 'title too short';
  end if;
  if length(coalesce(trim(p_body), '')) < 10 then
    raise exception 'body too short';
  end if;

  insert into public.help_requests (
    author_id, title, body, category, urgency, department, semester,
    course_code, is_anonymous, allow_dms
  ) values (
    uid, trim(p_title), trim(p_body), p_category,
    coalesce(p_urgency, 'normal'),
    nullif(trim(coalesce(p_department, '')), ''),
    p_semester,
    nullif(trim(coalesce(p_course_code, '')), ''),
    coalesce(p_is_anonymous, false),
    coalesce(p_allow_dms, true)
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- update_help_request → owner-only, open-only, whitelisted mutable fields.
create or replace function public.update_help_request(
  p_id          uuid,
  p_title       text,
  p_body        text,
  p_category    text,
  p_urgency     text,
  p_department  text,
  p_semester    smallint,
  p_course_code text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_author uuid;
  v_status text;
begin
  select author_id, status into v_author, v_status
    from public.help_requests where id = p_id;
  if v_author is null then
    raise exception 'request not found';
  end if;
  if v_author <> uid then
    raise exception 'not authorized';
  end if;
  if v_status <> 'open' then
    raise exception 'only open requests can be edited';
  end if;
  if length(coalesce(trim(p_title), '')) < 4 then
    raise exception 'title too short';
  end if;
  if length(coalesce(trim(p_body), '')) < 10 then
    raise exception 'body too short';
  end if;

  update public.help_requests set
    title       = trim(p_title),
    body        = trim(p_body),
    category    = p_category,
    urgency     = coalesce(p_urgency, 'normal'),
    department  = nullif(trim(coalesce(p_department, '')), ''),
    semester    = p_semester,
    course_code = nullif(trim(coalesce(p_course_code, '')), '')
  where id = p_id;
end;
$$;

-- resolve_help_request → owner or admin. Notifies followers (not the author).
create or replace function public.resolve_help_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_author uuid;
  f        record;
begin
  select author_id into v_author from public.help_requests where id = p_id;
  if v_author is null then
    raise exception 'request not found';
  end if;
  if v_author <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;

  update public.help_requests
     set status = 'resolved', resolved_at = now()
   where id = p_id and status = 'open';

  -- Tell followers the thing they were waiting on is done.
  for f in
    select user_id from public.help_request_followers where request_id = p_id
  loop
    perform public.create_notification(
      f.user_id, v_author, 'help_resolved', 'help',
      jsonb_build_object('request_id', p_id));
  end loop;
end;
$$;

-- reopen_help_request → owner or admin. Clears the selection pointer but leaves
-- any awarded Aura and the response's is_selected history intact (no clawback,
-- and re-selecting the same helper never double-awards — see select_help_helper).
create or replace function public.reopen_help_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_author uuid;
begin
  select author_id into v_author from public.help_requests where id = p_id;
  if v_author is null then
    raise exception 'request not found';
  end if;
  if v_author <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;

  update public.help_requests
     set status = 'open', resolved_at = null, selected_response_id = null
   where id = p_id and status = 'resolved';
end;
$$;

-- respond_to_help → any signed-in student on an OPEN request; blocks the author
-- from "helping" their own request. Returns the new response id.
create or replace function public.respond_to_help(
  p_request_id uuid,
  p_body       text,
  p_kind       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_author uuid;
  v_status text;
  v_kind   text := coalesce(p_kind, 'offer');
  new_id   uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  select author_id, status into v_author, v_status
    from public.help_requests where id = p_request_id;
  if v_author is null then
    raise exception 'request not found';
  end if;
  if v_author = uid then
    raise exception 'you cannot respond to your own request';
  end if;
  if v_status <> 'open' then
    raise exception 'this request is resolved';
  end if;
  if v_kind not in ('offer','answer') then
    v_kind := 'offer';
  end if;
  -- An "answer" must carry text; a bare "offer" may be a tap of "I can help".
  if v_kind = 'answer' and length(coalesce(trim(p_body), '')) = 0 then
    raise exception 'write your answer first';
  end if;

  insert into public.help_responses (request_id, author_id, body, kind)
    values (p_request_id, uid,
            nullif(trim(coalesce(p_body, '')), ''), v_kind)
    returning id into new_id;

  return new_id;
end;
$$;

-- delete_help_response → the response's own author (only if not selected), or an
-- admin. Selected responses are part of the resolved record and are immutable.
create or replace function public.delete_help_response(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid         uuid := auth.uid();
  v_author    uuid;
  v_selected  boolean;
begin
  select author_id, is_selected into v_author, v_selected
    from public.help_responses where id = p_id;
  if v_author is null then
    raise exception 'response not found';
  end if;
  if v_author <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  if v_selected and not public.is_admin(uid) then
    raise exception 'a selected response cannot be deleted';
  end if;

  delete from public.help_responses where id = p_id;
end;
$$;

-- select_help_helper → the gratitude loop. Owner (or admin) picks the response
-- that helped: it marks the response selected, resolves the request, awards the
-- helper Aura ONCE (guarded on response_id in aura metadata so re-selecting the
-- same helper after a reopen never farms points), and thanks the helper.
create or replace function public.select_help_helper(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  v_request  uuid;
  v_author   uuid;   -- request author
  v_helper   uuid;   -- response author
  v_already  boolean;
begin
  select resp.request_id, resp.author_id, req.author_id
    into v_request, v_helper, v_author
    from public.help_responses resp
    join public.help_requests req on req.id = resp.request_id
   where resp.id = p_response_id;
  if v_request is null then
    raise exception 'response not found';
  end if;
  if v_author <> uid and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;

  -- Point the request at this response, mark it, and resolve.
  update public.help_responses set is_selected = false where request_id = v_request;
  update public.help_responses set is_selected = true  where id = p_response_id;
  update public.help_requests
     set selected_response_id = p_response_id,
         status = 'resolved',
         resolved_at = coalesce(resolved_at, now())
   where id = v_request;

  -- Award Aura once per response (idempotent across reopen/re-select).
  select exists (
    select 1 from public.aura_transactions
    where reason = 'help_thanked'
      and (metadata->>'response_id')::uuid = p_response_id
  ) into v_already;

  if not v_already then
    insert into public.aura_transactions (user_id, delta, reason, metadata)
      values (v_helper, 15, 'help_thanked',
              jsonb_build_object('request_id', v_request,
                                 'response_id', p_response_id));
  end if;

  -- Thank the helper (system-style, individual notification).
  perform public.create_notification(
    v_helper, v_author, 'help_thanked', 'help',
    jsonb_build_object('request_id', v_request, 'response_id', p_response_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: revoke from public/anon, grant execute to authenticated only.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_help_request(text,text,text,text,text,smallint,text,boolean,boolean)',
    'update_help_request(uuid,text,text,text,text,text,smallint,text)',
    'resolve_help_request(uuid)',
    'reopen_help_request(uuid)',
    'respond_to_help(uuid,text,text)',
    'delete_help_response(uuid)',
    'select_help_helper(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
