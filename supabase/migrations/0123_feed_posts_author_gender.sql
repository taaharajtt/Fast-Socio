-- feed_posts: expose author_gender so the client can render the gendered
-- default avatar (boy.jpg/girl.jpg) when the author has no avatar_url.
-- Drop+recreate from the current definition (mig 0071) — every visibility
-- filter is preserved verbatim; only pr.gender is added.
drop view if exists public.feed_posts;

create view public.feed_posts as
select
  p.id, p.body, p.image_url, p.is_anonymous, p.community_id, p.poll_id,
  p.like_count, p.comment_count, p.created_at,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::uuid else p.author_id end as author_id,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.full_name end as author_name,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.avatar_url end as author_avatar,
  case when p.is_anonymous and p.author_id <> auth.uid() and not is_admin(auth.uid())
       then null::text else pr.gender end as author_gender,
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
