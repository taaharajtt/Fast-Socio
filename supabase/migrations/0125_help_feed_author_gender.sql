-- Campus Help: expose author_gender (masked identically to author_avatar_url)
-- so the client can render the gendered default avatar for a non-anonymous
-- seeker/helper. Recreated verbatim from mig 0110 with the one addition.
set check_function_bodies = off;

drop view if exists public.help_request_feed;

create view public.help_request_feed
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
  case when r.is_anonymous
            and r.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else p.gender end                                       as author_gender,
  p.department                                                           as author_school,
  public.current_semester(p.username)                                    as author_semester
from public.help_requests r
join public.profiles p on p.id = r.author_id;

revoke all on public.help_request_feed from anon, authenticated;
grant select on public.help_request_feed to authenticated;

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
  case when resp.is_anonymous
            and resp.author_id <> (select auth.uid())
            and not public.is_help_moderator((select auth.uid()))
       then null else p.gender end                                       as author_gender,
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
