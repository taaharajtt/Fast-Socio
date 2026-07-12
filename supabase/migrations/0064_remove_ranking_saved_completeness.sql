-- =============================================================================
-- FAST SOCIO — Remove feed ranking, saved posts, and profile completeness.
--
-- Reverts three refactor features by request, back to a single chronological
-- feed with no bookmarks and no completeness cache:
--   * get_ranked_feed RPC dropped (home feed is now plain created_at DESC).
--   * saved_posts table dropped; feed_posts loses saved_by_me + the ranking-only
--     author_semester/aura/interests columns (drop+recreate to shed columns).
--   * completeness column + compute_profile_completeness + award_completion_bonus
--     dropped; protect_profile_columns loses its completeness guard.
--
-- All OTHER Phase-9 feed behaviour (shadow-ban / mute / moderation filters) is
-- preserved. Order matters: drop the ranked RPC and re-slim the view before
-- dropping saved_posts; re-issue the guard before dropping the column.
-- =============================================================================

set check_function_bodies = off;

-- 1. Drop the ranked-feed RPC (nothing else references it).
drop function if exists public.get_ranked_feed(integer, double precision, uuid);

-- 2. Recreate feed_posts without saved_by_me and the ranking-only author
--    signals. Keeps liked_by_me, author_department/verified, and every Phase-9
--    visibility filter. DROP+CREATE because a view can't drop columns in place.
drop view if exists public.feed_posts;

create view public.feed_posts as
select
  p.id, p.body, p.image_url, p.is_anonymous, p.community_id,
  p.like_count, p.comment_count, p.created_at,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::uuid else p.author_id end as author_id,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.full_name end as author_name,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.avatar_url end as author_avatar,
  (exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid()))
    as liked_by_me,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.department end as author_department,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then false else pr.verified end as author_verified
from posts p
join profiles pr on pr.id = p.author_id
where p.hidden = false
  and not exists (
    select 1 from blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
       or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
  and (not pr.shadow_banned or p.author_id = auth.uid())
  and not exists (
    select 1 from muted_users mu
    where mu.muter_id = auth.uid() and mu.muted_id = p.author_id)
  and (p.community_id is null
       or exists (select 1 from communities c
                  where c.id = p.community_id and c.status = 'approved'::community_status))
  and p.moderation_status = 'approved'::post_moderation;

grant select on public.feed_posts to authenticated;

-- 3. Drop saved posts entirely.
drop table if exists public.saved_posts;

-- 4. Re-issue the column guard without completeness (keeps every other guard
--    from mig 0061, still using current_user so definer writes pass).
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' then
    new.aura_score               := old.aura_score;
    new.is_admin                 := old.is_admin;
    new.is_banned                := old.is_banned;
    new.xp                       := old.xp;
    new.level                    := old.level;
    new.shadow_banned            := old.shadow_banned;
    new.posting_restricted_until := old.posting_restricted_until;
    new.suspended_until          := old.suspended_until;
  end if;
  return new;
end;
$$;

-- 5. Drop the completeness functions, then the cached column.
drop function if exists public.award_completion_bonus();
drop function if exists public.compute_profile_completeness(uuid);
alter table public.profiles drop column if exists completeness;
