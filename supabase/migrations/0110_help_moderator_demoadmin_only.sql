-- =============================================================================
-- FAST SOCIO — Campus Help: scope moderation to the demoadmin account only
--
-- Campus Help previously granted its moderation powers (see any request's
-- responses, unmask anonymous authors, mark resolved, reopen, select/thank,
-- delete any response) to every app admin via public.is_admin(). Product
-- decision: inside Campus Help ONLY the dedicated `demoadmin` account should
-- have those powers. Other super-admins (e.g. i240733, i245525) keep their full
-- /admin dashboard access but behave exactly like a normal student inside Help.
--
-- Mechanism: a Help-specific moderator predicate, is_help_moderator(uid), that
-- is true only for the demoadmin profile. Every Help view/RPC that referenced
-- is_admin() is re-created here to call is_help_moderator() instead. Nothing
-- else in the app changes — is_admin() and the /admin surfaces are untouched.
--
-- The /admin dashboard does not read the Help feed views or call the Help RPCs
-- (Help moderation there flows through the generic `reports` table), so
-- narrowing these objects does not reduce admin dashboard functionality.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 0. The Help moderator predicate. Keyed on the demoadmin username, which is a
--    stable, seeded special account (not a roll-number username). SECURITY
--    DEFINER + stable, mirroring is_admin().
-- ---------------------------------------------------------------------------
create or replace function public.is_help_moderator(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and p.username = 'demoadmin'
      and p.admin_role is not null
  );
$$;

revoke all on function public.is_help_moderator(uuid) from public, anon;
grant execute on function public.is_help_moderator(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. help_request_feed — unmask the seeker for the owner or the Help moderator
--    (was: owner or any admin). Same column set as mig 0109.
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
            and not public.is_help_moderator((select auth.uid()))
       then null else r.author_id end                                    as author_id,
  case when r.is_anonymous
            and r.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else p.full_name end                                    as author_name,
  case when r.is_anonymous
            and r.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else p.username end                                     as author_username,
  case when r.is_anonymous
            and r.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else p.avatar_url end                                   as author_avatar_url,
  p.department                                                           as author_school,
  public.current_semester(p.username)                                    as author_semester
from public.help_requests r
join public.profiles p on p.id = r.author_id;

revoke all on public.help_request_feed from anon, authenticated;
grant select on public.help_request_feed to authenticated;

-- ---------------------------------------------------------------------------
-- 2. help_response_feed — a response is visible to the seeker, the response
--    author, or the Help moderator (was: or any admin). Anonymous helpers are
--    unmasked only to themselves or the Help moderator. Same column set as 0109.
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
  (resp.is_anonymous
     and resp.author_id <> (select auth.uid())
     and not public.is_help_moderator((select auth.uid())))              as author_is_anon,
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else resp.author_id end                                 as author_id,
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else p.full_name end                                    as author_name,
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else p.username end                                     as author_username,
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else p.avatar_url end                                   as author_avatar_url,
  p.department                                                           as author_school,
  public.current_semester(p.username)                                    as author_semester,
  resp.status                                                            as status,
  resp.accepted_at                                                       as accepted_at,
  (req.author_id = (select auth.uid()))                                  as viewer_owns_request,
  resp.seeker_reply,
  resp.seeker_reply_at
from public.help_responses resp
join public.help_requests req on req.id = resp.request_id
join public.profiles p on p.id = resp.author_id
where req.author_id = (select auth.uid())               -- the seeker
   or resp.author_id = (select auth.uid())               -- the helper (own row)
   or public.is_help_moderator((select auth.uid()));      -- demoadmin moderation

revoke all on public.help_response_feed from anon, authenticated;
grant select on public.help_response_feed to authenticated;

-- ---------------------------------------------------------------------------
-- 3. resolve_help_request — owner or Help moderator (was: owner or admin).
-- ---------------------------------------------------------------------------
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
  if v_author <> uid and not public.is_help_moderator(uid) then
    raise exception 'not authorized';
  end if;

  update public.help_requests
     set status = 'resolved', resolved_at = now()
   where id = p_id and status = 'open';

  for f in
    select user_id from public.help_request_followers where request_id = p_id
  loop
    perform public.create_notification(
      f.user_id, v_author, 'help_resolved', 'help',
      jsonb_build_object('request_id', p_id));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. reopen_help_request — owner or Help moderator; keeps the is_selected clear
--    from mig 0109.
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
  if v_author <> uid and not public.is_help_moderator(uid) then
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
-- 5. delete_help_response — response author or Help moderator (was: or admin);
--    a selected response stays immutable except to the Help moderator.
-- ---------------------------------------------------------------------------
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
  if v_author <> uid and not public.is_help_moderator(uid) then
    raise exception 'not authorized';
  end if;
  if v_selected and not public.is_help_moderator(uid) then
    raise exception 'a selected response cannot be deleted';
  end if;

  delete from public.help_responses where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. select_help_helper — owner or Help moderator (was: owner or admin). The
--    gratitude loop (mark selected, resolve, award Aura once, thank) is verbatim
--    from mig 0102 apart from the authorization predicate.
-- ---------------------------------------------------------------------------
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
  if v_author <> uid and not public.is_help_moderator(uid) then
    raise exception 'not authorized';
  end if;

  update public.help_responses set is_selected = false where request_id = v_request;
  update public.help_responses set is_selected = true  where id = p_response_id;
  update public.help_requests
     set selected_response_id = p_response_id,
         status = 'resolved',
         resolved_at = coalesce(resolved_at, now())
   where id = v_request;

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

  perform public.create_notification(
    v_helper, v_author, 'help_thanked', 'help',
    jsonb_build_object('request_id', v_request, 'response_id', p_response_id));
end;
$$;
