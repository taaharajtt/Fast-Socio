-- =============================================================================
-- FAST SOCIO — Moderation actually hides content (audit fix P3-03)
--
-- updateReportStatus only flipped reports.status; the reported content stayed
-- fully visible on every surface, so "actioned" was a misleading label. This
-- adds a `hidden` flag to the moderatable content tables and a SECURITY DEFINER
-- moderate_report() that sets the report status AND hides/unhides the target
-- (hidden = the report is 'actioned'). Reversible: dismissing restores it.
-- =============================================================================

set check_function_bodies = off;

alter table public.posts          add column if not exists hidden boolean not null default false;
alter table public.post_comments  add column if not exists hidden boolean not null default false;
alter table public.messages       add column if not exists hidden boolean not null default false;

-- feed_posts: never surface hidden posts. Same column set, so CREATE OR REPLACE.
create or replace view public.feed_posts as
select
  p.id, p.body, p.image_url, p.is_anonymous, p.community_id,
  p.like_count, p.comment_count, p.created_at,
  case when p.is_anonymous and p.author_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else p.author_id end as author_id,
  case when p.is_anonymous and p.author_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else pr.full_name end as author_name,
  case when p.is_anonymous and p.author_id <> auth.uid()
         and not public.is_admin(auth.uid())
       then null else pr.avatar_url end as author_avatar,
  exists (
    select 1 from public.post_likes l
    where l.post_id = p.id and l.user_id = auth.uid()
  ) as liked_by_me
from public.posts p
join public.profiles pr on pr.id = p.author_id
where p.hidden = false
  and not exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
       or (b.blocker_id = p.author_id and b.blocked_id = auth.uid())
  )
  and (
    p.community_id is null
    or exists (
      select 1 from public.communities c
      where c.id = p.community_id and c.status = 'approved'
    )
  )
  and p.moderation_status = 'approved';

grant select on public.feed_posts to authenticated;

-- Admin moderation of a report: set status, hide/unhide the target, audit-log it.
create or replace function public.moderate_report(
  p_report_id uuid,
  p_status public.report_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
  v_type   public.report_target_type;
  v_target uuid;
  v_hidden boolean;
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  select target_type, target_id into v_type, v_target
    from public.reports where id = p_report_id;
  if v_type is null then
    raise exception 'report not found';
  end if;

  update public.reports set status = p_status where id = p_report_id;

  -- Content is hidden iff the report was actioned; reversible on any other state.
  v_hidden := (p_status = 'actioned');
  if v_type = 'post' then
    update public.posts set hidden = v_hidden where id = v_target;
  elsif v_type = 'comment' then
    update public.post_comments set hidden = v_hidden where id = v_target;
  elsif v_type = 'message' then
    update public.messages set hidden = v_hidden where id = v_target;
  end if;
  -- profile/community/event: handled via ban / moderate_community / moderate_event.

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, metadata)
    values (admin_id, 'report_' || p_status::text, v_type, v_target,
            jsonb_build_object('report_id', p_report_id, 'hidden', v_hidden));
end;
$$;

revoke all on function public.moderate_report(uuid, public.report_status) from public;
grant execute on function public.moderate_report(uuid, public.report_status) to authenticated;
