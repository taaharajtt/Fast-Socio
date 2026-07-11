-- =============================================================================
-- FAST SOCIO — Refactor Phase 9a: Moderation risk engine + report lifecycle.
--
-- The deterministic scoring itself lives in lib/moderation/rules.ts (runs in the
-- create-post/comment server actions). This migration provides the persistence
-- + moderator surface:
--   * risk_score on posts/comments (audit of what the engine decided). Held
--     content is written with moderation_status='pending' (posts) / hidden=true
--     (comments) inline at creation, so it flows into the existing admin
--     content-moderation queue and the feed_posts filter — no extra table.
--   * reports lifecycle: priority + assignment + duplicate-merge columns and the
--     admin functions to drive them. Nothing existing is removed.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Persisted risk score on moderatable content. Repeat-offender signal is
--    derivable from these (author_id + risk over time) — no separate flag table.
-- ---------------------------------------------------------------------------
alter table public.posts
  add column if not exists risk_score smallint not null default 0;
alter table public.post_comments
  add column if not exists risk_score smallint not null default 0;

-- The create-post BEFORE-INSERT trigger already fixes moderation_status; fold in
-- the risk hold so a risky post (score >= 41, set by the server action) is held
-- pending regardless of author trust. Body is mig 0017 + one condition. Comments
-- carry no such trigger — the action sets hidden=true inline for a held comment.
create or replace function public.set_community_post_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.risk_score >= 41 then
    new.moderation_status := 'pending';         -- rule-engine hold wins
  elsif new.community_id is null then
    new.moderation_status := 'approved';
  elsif exists (
    select 1 from public.community_members m
    where m.community_id = new.community_id
      and m.user_id = new.author_id
      and m.role in ('owner', 'moderator')
  ) then
    new.moderation_status := 'approved';
  else
    new.moderation_status := 'pending';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Report lifecycle: priority + assignment + duplicate merge.
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists priority    smallint not null default 0,  -- 0 low · 1 med · 2 high
  add column if not exists assigned_to uuid references public.profiles (id) on delete set null,
  add column if not exists merged_into uuid references public.reports (id) on delete set null;

-- Priority bumps with the number of open reports against the same target, so the
-- queue self-sorts toward the most-reported objects.
create or replace function public.recompute_report_priority(p_type public.report_target_type, p_target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.reports r
     set priority = case
       when cnt >= 5 then 2
       when cnt >= 2 then 1
       else 0 end
  from (
    select count(*) as cnt from public.reports
    where target_type = p_type and target_id = p_target
      and merged_into is null and status in ('pending', 'reviewing')
  ) agg
  where r.target_type = p_type and r.target_id = p_target and r.merged_into is null;
$$;

-- Keep priority current as reports arrive.
create or replace function public.trg_report_priority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_report_priority(new.target_type, new.target_id);
  return null;
end;
$$;

create trigger reports_recompute_priority
  after insert on public.reports
  for each row execute function public.trg_report_priority();

-- Admin: assign a report to a moderator.
create or replace function public.assign_report(p_report uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  update public.reports
     set assigned_to = p_assignee,
         status = case when status = 'pending' then 'reviewing' else status end,
         updated_at = now()
   where id = p_report;
end;
$$;

-- Admin: merge a duplicate report into a primary one (dismiss + link).
create or replace function public.merge_report(p_report uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized';
  end if;
  if p_report = p_into then
    raise exception 'cannot merge a report into itself';
  end if;
  update public.reports
     set merged_into = p_into, status = 'dismissed', updated_at = now()
   where id = p_report;
end;
$$;

revoke all on function public.assign_report(uuid, uuid) from public;
grant execute on function public.assign_report(uuid, uuid) to authenticated;
revoke all on function public.merge_report(uuid, uuid) from public;
grant execute on function public.merge_report(uuid, uuid) to authenticated;
