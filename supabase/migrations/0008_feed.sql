-- =============================================================================
-- FAST SOCIO — Feed: posts, likes, comments, anonymous posting (Phase 4)
--
-- Anonymity model (Decision: author hidden from all non-admin queries):
--   * Clients CANNOT select the posts base table directly (select revoked).
--   * Reads go through the feed_posts VIEW, which nulls author fields for
--     anonymous posts unless the viewer is the author or an admin.
--   * De-anonymization is only via deanonymize_post() (SECURITY DEFINER), which
--     writes an entry to moderation_audit_log on every call.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table public.posts (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.profiles (id) on delete cascade,
  body           text check (body is null or char_length(body) <= 2000),
  image_url      text,
  is_anonymous   boolean not null default false,
  like_count     integer not null default 0,
  comment_count  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (body is not null or image_url is not null)
);

create index posts_created_at_idx on public.posts (created_at desc);
create index posts_author_idx on public.posts (author_id);

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

-- Clients never read the base table (it exposes author_id). They read feed_posts.
revoke select on public.posts from anon, authenticated;

create policy "users create their own posts"
  on public.posts for insert to authenticated
  with check (author_id = auth.uid());

create policy "authors update their own posts"
  on public.posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy "authors delete their own posts"
  on public.posts for delete to authenticated
  using (author_id = auth.uid());

-- Award Aura for non-anonymous posts (anonymous posts earn none, to avoid any
-- ledger-based correlation that could de-anonymize the author).
create or replace function public.award_post_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.is_anonymous then
    insert into public.aura_transactions (user_id, delta, reason)
      values (new.author_id, 2, 'post_created');
  end if;
  return null;
end;
$$;

create trigger posts_award_aura
  after insert on public.posts
  for each row execute function public.award_post_aura();

-- ---------------------------------------------------------------------------
-- post_likes
-- ---------------------------------------------------------------------------
create table public.post_likes (
  post_id     uuid not null references public.posts (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index post_likes_post_idx on public.post_likes (post_id);

alter table public.post_likes enable row level security;

create policy "users read likes"
  on public.post_likes for select to authenticated using (true);
create policy "users manage their own likes"
  on public.post_likes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.sync_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid := coalesce(new.post_id, old.post_id);
begin
  update public.posts
     set like_count = (select count(*) from public.post_likes where post_id = pid)
   where id = pid;
  return null;
end;
$$;

create trigger post_likes_sync
  after insert or delete on public.post_likes
  for each row execute function public.sync_like_count();

-- ---------------------------------------------------------------------------
-- post_comments (non-anonymous)
-- ---------------------------------------------------------------------------
create table public.post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index post_comments_post_idx on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;

create policy "users read comments"
  on public.post_comments for select to authenticated using (true);
create policy "users create their own comments"
  on public.post_comments for insert to authenticated
  with check (author_id = auth.uid());
create policy "authors delete their own comments"
  on public.post_comments for delete to authenticated
  using (author_id = auth.uid());

create or replace function public.sync_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid := coalesce(new.post_id, old.post_id);
begin
  update public.posts
     set comment_count = (select count(*) from public.post_comments where post_id = pid)
   where id = pid;
  return null;
end;
$$;

create trigger post_comments_sync
  after insert or delete on public.post_comments
  for each row execute function public.sync_comment_count();

-- ---------------------------------------------------------------------------
-- feed_posts VIEW — the only read path for clients. Nulls author for anonymous
-- posts (unless viewer is the author or an admin) and hides blocked authors.
-- ---------------------------------------------------------------------------
create or replace view public.feed_posts as
select
  p.id,
  p.body,
  p.image_url,
  p.is_anonymous,
  p.like_count,
  p.comment_count,
  p.created_at,
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
where not exists (
  select 1 from public.blocked_users b
  where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
     or (b.blocker_id = p.author_id and b.blocked_id = auth.uid())
);

grant select on public.feed_posts to authenticated;

-- ---------------------------------------------------------------------------
-- deanonymize_post — admin-only; logs every call to the audit log.
-- ---------------------------------------------------------------------------
create or replace function public.deanonymize_post(p_post_id uuid)
returns table (author_id uuid, author_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_id uuid := auth.uid();
begin
  if not public.is_admin(admin_id) then
    raise exception 'not authorized';
  end if;

  insert into public.moderation_audit_log (actor_id, action, target_type, target_id, reason)
    values (admin_id, 'deanonymize_post', 'post', p_post_id, 'admin lookup');

  return query
    select p.author_id, pr.full_name
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    where p.id = p_post_id;
end;
$$;

revoke all on function public.deanonymize_post(uuid) from public;
grant execute on function public.deanonymize_post(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- post-media storage bucket (public read; author-scoped upload).
-- Path: post-media/<user_id>/<uuid>.<ext>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

drop policy if exists "post media is publicly readable" on storage.objects;
create policy "post media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'post-media');

drop policy if exists "users upload their own post media" on storage.objects;
create policy "users upload their own post media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete their own post media" on storage.objects;
create policy "users delete their own post media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
