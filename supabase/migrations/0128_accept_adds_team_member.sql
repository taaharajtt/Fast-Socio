-- ===========================================================================
-- 0128 — Accepting a request to join fills the team.
--
-- Until now, accepting an application only flipped the status and notified the
-- applicant; the author still had to hand-edit the post to tag the new member
-- and lower "people needed". Now the accept path does both atomically:
--   • inserts the applicant into smart_match_team_members (idempotent), and
--   • decrements smart_match_posts.people_needed, floored at 0.
--
-- The decrement only runs when the insert actually added a row, so re-adding
-- someone already tagged as a current team member can't double-count.
--
-- Everything else (authorization, pending-only guard, decline path, the
-- smart_match_accepted notification) is preserved verbatim from 0105.
--
-- The 0105 CHECK pinned people_needed to 1..20, which the decrement would trip
-- on the last open slot, so it is widened to 0..20 — 0 now means "team full"
-- and the card renders it that way. Creating a post still requires >= 1 (the
-- client form's own minimum); only this RPC can drive a post down to 0.
-- ===========================================================================
alter table public.smart_match_posts
  drop constraint if exists smart_match_posts_people_needed_check;

alter table public.smart_match_posts
  add constraint smart_match_posts_people_needed_check
  check (people_needed is null or people_needed between 0 and 20);

create or replace function public.respond_smart_match_interest(
  p_id     uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_applicant uuid;
  v_post uuid;
  v_status text;
  v_author uuid;
  v_mode text;
  v_added int := 0;
begin
  select a.applicant_id, a.post_id, a.status, p.author_id, p.mode
    into v_applicant, v_post, v_status, v_author, v_mode
    from public.smart_match_applications a
    join public.smart_match_posts p on p.id = a.post_id
   where a.id = p_id;
  if v_applicant is null then
    raise exception 'application not found';
  end if;
  if v_author <> uid then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'application is not pending';
  end if;

  update public.smart_match_applications
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_id;

  if p_accept then
    -- Tag the applicant into the current team. Display-only membership, same
    -- as the author tagging them by hand — confers no permissions.
    with ins as (
      insert into public.smart_match_team_members (post_id, user_id, added_by)
      values (v_post, v_applicant, uid)
      on conflict (post_id, user_id) do nothing
      returning 1
    )
    select count(*)::int into v_added from ins;

    -- One fewer person needed, but never below zero and never resurrecting a
    -- null (a post that never declared a headcount stays null).
    if v_added > 0 then
      update public.smart_match_posts
         set people_needed = greatest(people_needed - 1, 0)
       where id = v_post
         and people_needed is not null;
    end if;

    perform public.create_notification(
      v_applicant, uid, 'smart_match_accepted', 'matching',
      jsonb_build_object('post_id', v_post, 'mode', v_mode, 'application_id', p_id));
  end if;
end;
$$;

revoke all on function public.respond_smart_match_interest(uuid,boolean) from public, anon;
grant execute on function public.respond_smart_match_interest(uuid,boolean) to authenticated;
