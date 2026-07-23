-- =============================================================================
-- FAST SOCIO — Campus Help: privacy & role hardening
--
-- Fixes the response-visibility model and simplifies the ask form. The Campus
-- Help surface (migs 0102 + 0106) exposed EVERY response through
-- help_response_feed to any authenticated client, so helpers and passers-by
-- could read each other's offers. That is wrong: an ask's responses are a
-- private inbox for the seeker, plus each helper's own row.
--
-- This migration, in one place:
--   1. Restricts help_response_feed rows to the request owner, the response
--      author, and admins — the ONLY parties allowed to see a response.
--   2. Adds anonymous HELPER responses (help_responses.is_anonymous). An
--      anonymous helper is shown to the seeker as school + semester only; the
--      helper_id is preserved server-side for permissions/Aura but never leaks.
--   3. Adds a seeker reply per response (help_responses.seeker_reply): the
--      seeker can reply to a helper, and only that helper (and the seeker/admin)
--      can read it — enforced by the same row filter as (1).
--   4. Surfaces the seeker's school + derived semester on both feeds so an
--      anonymous ask/response can still show "School · Nth Semester" without
--      any identifying field. Per-request department/semester/course are no
--      longer collected by the form (kept as columns for back-compat only).
--   5. reopen_help_request now also clears is_selected on the request's
--      responses, so a reopened ask is a clean open ask (Aura already awarded is
--      never clawed back, and re-selecting is idempotent — see select_help_helper).
--
-- Security posture is unchanged: reads go through masking views (no base-table
-- SELECT grant), writes go through SECURITY DEFINER RPCs that authorize the
-- caller. auth.uid() is wrapped in a scalar subselect throughout for the RLS
-- initplan optimization used across this codebase.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. New columns on help_responses.
--    is_anonymous  — the helper chose to respond anonymously.
--    seeker_reply  — a short reply from the request owner to this helper.
-- ---------------------------------------------------------------------------
alter table public.help_responses
  add column if not exists is_anonymous    boolean not null default false,
  add column if not exists seeker_reply    text,
  add column if not exists seeker_reply_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. help_request_feed — append the seeker's school + derived semester so an
--    anonymous ask can display "School · Nth Semester" with no identifying
--    field. New columns are appended so CREATE OR REPLACE VIEW accepts them.
--    Masking of name/username/avatar/author_id is unchanged from mig 0102.
-- ---------------------------------------------------------------------------
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
       then null else p.avatar_url end                                   as author_avatar_url,
  -- School + derived semester are non-identifying and shown even for anonymous
  -- asks (they are the only author facts an anonymous seeker reveals).
  p.department                                                           as author_school,
  public.current_semester(p.username)                                    as author_semester
from public.help_requests r
join public.profiles p on p.id = r.author_id;

revoke all on public.help_request_feed from anon, authenticated;
grant select on public.help_request_feed to authenticated;

-- ---------------------------------------------------------------------------
-- 3. help_response_feed — the core privacy fix. Dropped and recreated (rather
--    than replaced) because the column set changes shape.
--
--    ROW FILTER: a response is visible ONLY to the request owner (their private
--    inbox), the response author (their own row), or an admin. Everyone else —
--    other helpers, passers-by — gets nothing.
--
--    HELPER ANONYMITY: when a helper responds anonymously, their
--    name/username/avatar/author_id are masked from everyone but themselves and
--    admins (so the seeker sees "Anonymous · School · Nth Semester"). The
--    seeker can still select/thank and approve them — those act on the response
--    id, never the helper id — and the helper_id stays server-side for Aura.
-- ---------------------------------------------------------------------------
drop view if exists public.help_response_feed;

create view public.help_response_feed
with (security_invoker = false) as
select
  resp.id,
  resp.request_id,
  resp.body,
  resp.kind,
  resp.is_selected,
  resp.created_at,
  (resp.author_id = (select auth.uid()))                                 as is_mine,
  resp.is_anonymous,
  -- Whether this row's helper identity is hidden from the current viewer.
  (resp.is_anonymous
     and resp.author_id <> (select auth.uid())
     and not public.is_admin((select auth.uid())))                       as author_is_anon,
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else resp.author_id end                                 as author_id,
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.full_name end                                    as author_name,
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.username end                                     as author_username,
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_admin((select auth.uid()))
       then null else p.avatar_url end                                   as author_avatar_url,
  -- Non-identifying facts, always shown (the only helper facts an anonymous
  -- responder reveals).
  p.department                                                           as author_school,
  public.current_semester(p.username)                                    as author_semester,
  resp.status                                                            as status,
  resp.accepted_at                                                       as accepted_at,
  (req.author_id = (select auth.uid()))                                  as viewer_owns_request,
  -- The seeker's reply to this helper. Visible only to the two parties + admin
  -- because the row itself is only returned to them (see the WHERE below).
  resp.seeker_reply,
  resp.seeker_reply_at
from public.help_responses resp
join public.help_requests req on req.id = resp.request_id
join public.profiles p on p.id = resp.author_id
where req.author_id = (select auth.uid())      -- the seeker: their private inbox
   or resp.author_id = (select auth.uid())      -- the helper: their own response
   or public.is_admin((select auth.uid()));      -- moderation

revoke all on public.help_response_feed from anon, authenticated;
grant select on public.help_response_feed to authenticated;

-- ---------------------------------------------------------------------------
-- 4. respond_to_help — add p_is_anonymous. The old 3-arg version is dropped so
--    there is a single, unambiguous signature.
-- ---------------------------------------------------------------------------
drop function if exists public.respond_to_help(uuid, text, text);

create or replace function public.respond_to_help(
  p_request_id   uuid,
  p_body         text,
  p_kind         text,
  p_is_anonymous boolean
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
  if v_kind = 'answer' and length(coalesce(trim(p_body), '')) = 0 then
    raise exception 'write your answer first';
  end if;

  insert into public.help_responses (request_id, author_id, body, kind, is_anonymous)
    values (p_request_id, uid,
            nullif(trim(coalesce(p_body, '')), ''), v_kind,
            coalesce(p_is_anonymous, false))
    returning id into new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. reply_to_help_response — the request owner replies to one helper's
--    response. Owner-only; the reply is stored on the response and only ever
--    read back by the seeker, that helper, or an admin (the view's row filter).
-- ---------------------------------------------------------------------------
create or replace function public.reply_to_help_response(
  p_response_id uuid,
  p_body        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  v_owner uuid;   -- request author
  v_text  text := nullif(trim(coalesce(p_body, '')), '');
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  select req.author_id into v_owner
    from public.help_responses resp
    join public.help_requests req on req.id = resp.request_id
   where resp.id = p_response_id;
  if v_owner is null then
    raise exception 'response not found';
  end if;
  if v_owner <> uid then
    raise exception 'not authorized';
  end if;
  if v_text is not null and length(v_text) > 1000 then
    raise exception 'reply too long';
  end if;

  update public.help_responses
     set seeker_reply    = v_text,
         seeker_reply_at = case when v_text is null then null else now() end
   where id = p_response_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. reopen_help_request — same authorization as before (owner/admin), but now
--    also clears is_selected on every response of the request so a reopened ask
--    is indistinguishable from a fresh open one. Awarded Aura is intentionally
--    NOT clawed back; re-selecting the same helper later is idempotent because
--    select_help_helper guards the Aura grant on response_id.
-- ---------------------------------------------------------------------------
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

  update public.help_responses
     set is_selected = false
   where request_id = p_id and is_selected;

  update public.help_requests
     set status = 'open', resolved_at = null, selected_response_id = null
   where id = p_id and status = 'resolved';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants for the changed/new RPCs.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'respond_to_help(uuid,text,text,boolean)',
    'reply_to_help_response(uuid,text)',
    'reopen_help_request(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
