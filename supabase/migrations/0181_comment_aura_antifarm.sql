-- =============================================================================
-- 0181 — Comment Aura, farm-proofed.
--
-- THE HOLE. Mig 0020 paid the post author +2 for EVERY comment row inserted,
-- and had no delete path at all. Two consequences:
--   1. One user could mint unlimited Aura for a friend by spamming comments on
--      a single post.
--   2. Deleting the comments kept the Aura, so the evidence could be erased.
--
-- THE RULE THIS ENFORCES.
--   A post author is paid +2 AT MOST ONCE per (post, commenter) pair, and that
--   payment is reversed exactly when the pair's LAST remaining comment on that
--   post disappears.
--
-- The invariant is kept in the DATABASE, not the app: a row in
-- `comment_aura_grants` exists IF AND ONLY IF that commenter currently has at
-- least one comment on that post AND the author was paid for it. The primary
-- key is what makes the grant idempotent under concurrency — two simultaneous
-- first comments race on the same key, one inserts, the other conflicts and
-- pays nothing.
--
-- Deliberately NOT done here: a global "max 25 comments per post" cap. The
-- per-commenter reward limit already removes the incentive to spam without
-- letting an early spammer consume a shared quota and shut a real conversation
-- down. Structure for a later cap is left in place (see COMMENT_LIMITS in
-- src/lib/feed/comment-guard.ts).
--
-- Safe to re-run. Forward-only. No other Aura reason is touched.
-- =============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The idempotency record.
--
-- One row per rewarded (post, commenter) pair. `author_id` is denormalized so
-- a reversal knows who to debit without re-reading the post.
-- ---------------------------------------------------------------------------
create table if not exists public.comment_aura_grants (
  post_id      uuid not null references public.posts (id) on delete cascade,
  commenter_id uuid not null references public.profiles (id) on delete cascade,
  author_id    uuid not null references public.profiles (id) on delete cascade,
  granted_at   timestamptz not null default now(),
  primary key (post_id, commenter_id)
);

create index if not exists comment_aura_grants_author_idx
  on public.comment_aura_grants (author_id);

alter table public.comment_aura_grants enable row level security;

-- No client policies at all: like `aura_transactions`, this table is written
-- only by the SECURITY DEFINER triggers below.
revoke all on table public.comment_aura_grants from anon, authenticated;

-- "Does this commenter still have a comment here?" needs this exact shape;
-- post_comments_post_idx is (post_id, created_at).
create index if not exists post_comments_post_author_idx
  on public.post_comments (post_id, author_id);

-- ---------------------------------------------------------------------------
-- 2. Backfill.
--
-- Existing distinct (post, commenter) pairs are recorded as already-granted.
-- No ledger rows are written or removed: history is left exactly as it is. The
-- effect is forward-looking — an existing commenter's NEXT comment cannot
-- re-earn, and deleting their comments reverses at most the one grant.
-- ---------------------------------------------------------------------------
insert into public.comment_aura_grants (post_id, commenter_id, author_id, granted_at)
select c.post_id, c.author_id, p.author_id, min(c.created_at)
  from public.post_comments c
  join public.posts p on p.id = c.post_id
 where p.author_id <> c.author_id
 group by c.post_id, c.author_id, p.author_id
on conflict (post_id, commenter_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Award: first comment by this commenter on this post only.
--
-- The `on conflict do nothing ... returning` is the whole guard. It is a single
-- atomic statement, so N concurrent first comments produce exactly one
-- RETURNING row and therefore exactly one ledger entry. Self-comments still
-- earn nothing.
-- ---------------------------------------------------------------------------
create or replace function public.award_comment_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author  uuid;
  v_granted boolean := false;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.author_id then
    return null;
  end if;

  insert into public.comment_aura_grants (post_id, commenter_id, author_id)
  values (new.post_id, new.author_id, v_author)
  on conflict (post_id, commenter_id) do nothing
  returning true into v_granted;

  if coalesce(v_granted, false) then
    insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (
      v_author, 2, 'comment_received',
      jsonb_build_object('post_id', new.post_id, 'commenter_id', new.author_id)
    );
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reconcile on delete: reverse only when the pair's LAST comment goes.
--
-- Ordering of the guards matters:
--   * If the POST is gone, this delete is the cascade from `delete from posts`.
--     The grant rows cascade away with it, so there is nothing to reverse and
--     nothing to debit — otherwise deleting a well-commented post would strip
--     the author of Aura legitimately earned while it existed.
--   * The advisory lock serializes concurrent deletes of two comments by the
--     same person on the same post, so they cannot both observe "none left".
--   * The reversal is gated on `delete ... returning`, so a retried or repeated
--     delete finds no grant row and debits nothing. Deleting a parent comment
--     (whose replies cascade) reconciles each affected commenter exactly once.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_comment_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining boolean;
  v_reversed  uuid;
begin
  if not exists (select 1 from public.posts where id = old.post_id) then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(old.post_id::text || ':' || old.author_id::text, 0)
  );

  select exists (
    select 1 from public.post_comments
     where post_id = old.post_id and author_id = old.author_id
  ) into v_remaining;

  if v_remaining then
    return null;
  end if;

  delete from public.comment_aura_grants
   where post_id = old.post_id and commenter_id = old.author_id
  returning author_id into v_reversed;

  if v_reversed is not null then
    insert into public.aura_transactions (user_id, delta, reason, metadata)
    values (
      v_reversed, -2, 'comment_received',
      jsonb_build_object(
        'post_id', old.post_id,
        'commenter_id', old.author_id,
        'reversal', true
      )
    );
  end if;

  return null;
end;
$$;

drop trigger if exists post_comments_reconcile_aura on public.post_comments;
create trigger post_comments_reconcile_aura
  after delete on public.post_comments
  for each row execute function public.reconcile_comment_aura();

revoke all on function public.award_comment_aura() from public, anon, authenticated;
revoke all on function public.reconcile_comment_aura() from public, anon, authenticated;
