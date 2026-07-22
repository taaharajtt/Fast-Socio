-- =============================================================================
-- FAST SOCIO — Campus Help: SOCIO / ME refocus (Phase 2)
--
-- The Help surface is being simplified from a five-tab ticketing board into two
-- tabs — SOCIO (the public help feed, urgent-boosted) and ME (your own asks,
-- responses, and history). This migration carries the DB-side changes:
--
--   1. New category set (academic / advice / help / sports / events /
--      lost_found), replacing the phase-1 seven. Tables are empty in prod, so no
--      data remap is needed — just swap the CHECK.
--   2. An OFFER-APPROVAL lifecycle on help_responses (pending → accepted /
--      declined). Approving an offer does NOT resolve the request; it just lets
--      the two parties open a chat (identity is revealed through the chat, the
--      same way every other connection in the app works). The gratitude loop
--      (select_help_helper → resolve + thank + Aura) is unchanged.
--   3. get_or_create_conversation gains an additive accepted-offer branch, so an
--      approved helper (and only an approved helper) can message the asker.
--
-- Urgency stays a text column (low/normal/urgent) — the UI now only ever writes
-- 'normal' or 'urgent' via a single toggle, so no schema churn there. Followers
-- stay in place too; the UI simply stops surfacing them.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Category set. The phase-1 CHECK was inline/anonymous, so Postgres named it
--    help_requests_category_check. Drop it and add the new named constraint.
-- ---------------------------------------------------------------------------
alter table public.help_requests
  drop constraint if exists help_requests_category_check;

alter table public.help_requests
  add constraint help_requests_category_check
  check (category in ('academic','advice','help','sports','events','lost_found'));

-- ---------------------------------------------------------------------------
-- 2. Offer-approval lifecycle on help_responses.
--    status: pending (default) → accepted / declined, decided by the request
--    owner. accepted_at records when a chat was unlocked.
-- ---------------------------------------------------------------------------
alter table public.help_responses
  add column if not exists status text not null default 'pending'
    check (status in ('pending','accepted','declined')),
  add column if not exists accepted_at timestamptz;

create index if not exists help_responses_status_idx
  on public.help_responses (request_id, status);

-- ---------------------------------------------------------------------------
-- 3. Expose status + accepted_at on the response feed view. New columns are
--    appended at the end so CREATE OR REPLACE VIEW accepts the change.
-- ---------------------------------------------------------------------------
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
       then null else p.avatar_url end                                   as author_avatar_url,
  -- Approval lifecycle. is_op is who can act: the request author sees offers and
  -- approves them; the helper sees whether they were approved.
  resp.status                                                            as status,
  resp.accepted_at                                                       as accepted_at,
  (req.author_id = (select auth.uid()))                                  as viewer_owns_request
from public.help_responses resp
join public.help_requests req on req.id = resp.request_id
join public.profiles p on p.id = resp.author_id;

revoke all on public.help_response_feed from anon, authenticated;
grant select on public.help_response_feed to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Approve / decline an offer (request owner only, pending → accepted/declined).
--    Approving unlocks the chat (via get_or_create_conversation, below) and
--    notifies the helper. It intentionally does NOT resolve the request — the
--    asker may still be talking to several helpers.
-- ---------------------------------------------------------------------------
create or replace function public.accept_help_offer(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_request uuid;
  v_owner   uuid;   -- request author
  v_helper  uuid;   -- response author
  v_status  text;
  v_blocked boolean;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select resp.request_id, resp.author_id, resp.status, req.author_id
    into v_request, v_helper, v_status, v_owner
    from public.help_responses resp
    join public.help_requests req on req.id = resp.request_id
   where resp.id = p_response_id;
  if v_request is null then
    raise exception 'response not found';
  end if;
  if v_owner <> uid then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'this offer has already been answered';
  end if;

  -- Never open a channel across a block in either direction.
  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = uid and b.blocked_id = v_helper)
       or (b.blocker_id = v_helper and b.blocked_id = uid)
  ) into v_blocked;
  if v_blocked then
    raise exception 'blocked';
  end if;

  update public.help_responses
     set status = 'accepted', accepted_at = now()
   where id = p_response_id;

  -- Tell the helper they were approved (individual, system-style).
  perform public.create_notification(
    v_helper, v_owner, 'help_offer_accepted', 'help',
    jsonb_build_object('request_id', v_request, 'response_id', p_response_id));
end;
$$;

create or replace function public.decline_help_offer(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_owner   uuid;
  v_status  text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  select resp.status, req.author_id
    into v_status, v_owner
    from public.help_responses resp
    join public.help_requests req on req.id = resp.request_id
   where resp.id = p_response_id;
  if v_owner is null then
    raise exception 'response not found';
  end if;
  if v_owner <> uid then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'this offer has already been answered';
  end if;

  update public.help_responses
     set status = 'declined'
   where id = p_response_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_or_create_conversation — add an accepted-help-offer branch. Re-declared
--    in full (carrying every existing branch) so the eligibility set stays
--    correct. Identity reveal for anonymous askers happens HERE and only here:
--    the asker chose to approve this helper, so a chat between them is intended.
-- ---------------------------------------------------------------------------
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

  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = me)
  ) into blocked;
  if blocked then
    raise exception 'blocked';
  end if;

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
    or exists (
      select 1 from public.smart_match_applications a
      join public.smart_match_posts p on p.id = a.post_id
      where a.status = 'accepted'
        and ((p.author_id = me and a.applicant_id = other_id)
          or (p.author_id = other_id and a.applicant_id = me))
    )
    or exists (
      select 1 from public.help_responses resp
      join public.help_requests req on req.id = resp.request_id
      where resp.status = 'accepted'
        and ((req.author_id = me and resp.author_id = other_id)
          or (req.author_id = other_id and resp.author_id = me))
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

-- ---------------------------------------------------------------------------
-- 6. open_help_conversation — open (or fetch) the chat unlocked by an approved
--    offer, keyed on the response so NO party id ever crosses to the client.
--    Either the request owner or the approved helper may call it; the asker's
--    id stays server-side, preserving anonymity right up to the chat itself.
-- ---------------------------------------------------------------------------
create or replace function public.open_help_conversation(p_response_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  v_owner  uuid;   -- request author (asker)
  v_helper uuid;   -- response author
  v_status text;
  other_id uuid;
  lo uuid;
  hi uuid;
  conv_id uuid;
  blocked boolean;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  select resp.author_id, resp.status, req.author_id
    into v_helper, v_status, v_owner
    from public.help_responses resp
    join public.help_requests req on req.id = resp.request_id
   where resp.id = p_response_id;
  if v_owner is null then
    raise exception 'response not found';
  end if;
  if v_status <> 'accepted' then
    raise exception 'this offer has not been approved';
  end if;

  if me = v_owner then
    other_id := v_helper;
  elsif me = v_helper then
    other_id := v_owner;
  else
    raise exception 'not authorized';
  end if;

  select exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = me)
  ) into blocked;
  if blocked then
    raise exception 'blocked';
  end if;

  lo := least(me, other_id);
  hi := greatest(me, other_id);
  insert into public.conversations (user_low, user_high)
    values (lo, hi)
    on conflict (user_low, user_high) do nothing;
  select id into conv_id from public.conversations
   where user_low = lo and user_high = hi;
  return conv_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants: revoke from public/anon, grant execute to authenticated only.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'accept_help_offer(uuid)',
    'decline_help_offer(uuid)',
    'open_help_conversation(uuid)',
    'get_or_create_conversation(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
