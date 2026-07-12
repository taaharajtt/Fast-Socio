-- =============================================================================
-- FAST SOCIO — Instagram-style comments: one-level replies + comment reactions
--
-- Two additions to the existing flat post_comments model:
--   1. Threaded replies, exactly ONE level deep (like Instagram). A reply points
--      at a top-level comment via parent_id; a reply of a reply is rejected by a
--      BEFORE-INSERT trigger. parent.reply_count is kept incrementally so the UI
--      can show "View replies (N)" without a count(*) per comment.
--   2. Per-comment likes (comment_likes), mirroring post_likes: read-open,
--      block-guarded insert, own-row delete, an incremental like_count on the
--      comment. One like per user per comment (composite PK).
--
-- Existing data is untouched and stays valid: every current row keeps
-- parent_id = NULL (a top-level comment) with reply_count/like_count = 0, so no
-- backfill is required. posts.comment_count continues to count ALL rows
-- (top-level + replies), matching how Instagram totals a post's comments.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- post_comments: threading + denormalized counters.
-- ---------------------------------------------------------------------------
alter table public.post_comments
  add column if not exists parent_id   uuid references public.post_comments (id) on delete cascade,
  add column if not exists reply_count integer not null default 0,
  add column if not exists like_count  integer not null default 0;

-- Fetch a comment's replies oldest-first (the lazy "View replies" query).
create index if not exists post_comments_parent_idx
  on public.post_comments (parent_id, created_at)
  where parent_id is not null;

-- Enforce single-level nesting and same-post integrity. A CHECK can't do this
-- (it needs to read the parent row), so it lives in a BEFORE INSERT trigger.
create or replace function public.enforce_comment_depth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_post   uuid;
  v_parent_parent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select post_id, parent_id
    into v_parent_post, v_parent_parent
    from public.post_comments
   where id = new.parent_id;

  if not found then
    raise exception 'parent comment not found';
  end if;
  if v_parent_parent is not null then
    raise exception 'replies can only be one level deep';
  end if;
  if v_parent_post <> new.post_id then
    raise exception 'reply must belong to the same post as its parent';
  end if;

  return new;
end;
$$;

drop trigger if exists post_comments_enforce_depth on public.post_comments;
create trigger post_comments_enforce_depth
  before insert on public.post_comments
  for each row execute function public.enforce_comment_depth();

-- Incremental reply_count on the parent comment.
create or replace function public.sync_reply_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.parent_id is not null then
    update public.post_comments
       set reply_count = reply_count + 1
     where id = new.parent_id;
  elsif tg_op = 'DELETE' and old.parent_id is not null then
    update public.post_comments
       set reply_count = greatest(reply_count - 1, 0)
     where id = old.parent_id;
  end if;
  return null;
end;
$$;

drop trigger if exists post_comments_sync_reply_count on public.post_comments;
create trigger post_comments_sync_reply_count
  after insert or delete on public.post_comments
  for each row execute function public.sync_reply_count();

-- ---------------------------------------------------------------------------
-- comment_likes — one like per user per comment. Mirrors post_likes (0008/0025):
-- reads open to authenticated, insert guarded against blocks in either
-- direction, delete/unlike always allowed so a blocked user can still withdraw.
-- ---------------------------------------------------------------------------
create table if not exists public.comment_likes (
  comment_id  uuid not null references public.post_comments (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists comment_likes_comment_idx
  on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;

-- Author of a comment, resolved with definer rights. post_comments SELECT is
-- already open to authenticated, but a helper keeps the block-guard policy tidy
-- and future-proof if that grant ever tightens (mirrors post_author from 0034).
create or replace function public.comment_author(p_comment_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select author_id from public.post_comments where id = p_comment_id;
$$;

revoke all on function public.comment_author(uuid) from public;
grant execute on function public.comment_author(uuid) to authenticated;

create policy "users read comment likes"
  on public.comment_likes for select to authenticated using (true);

create policy "users insert their own comment likes"
  on public.comment_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not public.is_blocked((select auth.uid()), public.comment_author(comment_id))
  );

create policy "users delete their own comment likes"
  on public.comment_likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Incremental like_count on the comment (mirrors sync_like_count, 0028).
create or replace function public.sync_comment_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.post_comments
       set like_count = like_count + 1
     where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update public.post_comments
       set like_count = greatest(like_count - 1, 0)
     where id = old.comment_id;
  end if;
  return null;
end;
$$;

create trigger comment_likes_sync
  after insert or delete on public.comment_likes
  for each row execute function public.sync_comment_like_count();

-- ---------------------------------------------------------------------------
-- notify_comment: a reply notifies the PARENT COMMENT's author ("replied to
-- your comment"); a top-level comment still notifies the POST author. Grouping
-- and self-notify suppression are handled by create_notification (0057).
-- ---------------------------------------------------------------------------
create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  grp       text;
begin
  if new.parent_id is null then
    select author_id into recipient from public.posts where id = new.post_id;
    grp := 'comment:' || new.post_id;
  else
    select author_id into recipient from public.post_comments where id = new.parent_id;
    grp := 'reply:' || new.parent_id;
  end if;

  perform public.create_notification(
    recipient, new.author_id, 'comment', 'likes',
    jsonb_build_object('post_id', new.post_id, 'parent_id', new.parent_id),
    grp
  );
  return null;
end;
$$;
