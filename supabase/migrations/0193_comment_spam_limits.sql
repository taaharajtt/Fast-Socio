-- =============================================================================
-- 0193 — comment anti-spam, enforced by the database.
--
-- WHAT WAS WRONG
-- Every comment limit lived in the `addComment` server action. A modified
-- client that talks to PostgREST directly never runs it, so the real ceiling on
-- comments was the 80/hour backstop 0187 added — and nothing at all stopped one
-- person burying a single post. The app's own numbers also disagreed with each
-- other: a 15s cooldown, 5 per 10 minutes, 60/hour in the action, 80/hour in
-- the database, and a per-post cap that was deliberately left switched off.
--
-- THE FOUR RULES, now one definition, in the transaction that writes the row:
--
--   1. COOLDOWN        one comment per user per post every 30 seconds
--   2. HOURLY          at most 5 per user per post per rolling 60 minutes
--   3. PERSONAL CAP    at most 10 currently-existing per user per post
--   4. POST CAP        at most 30 currently-existing on the post, all users
--
-- Replies are comments. Every rule counts `post_comments` rows whatever their
-- `parent_id`, so a reply consumes the same budget as a top-level comment.
--
-- ---------------------------------------------------------------------------
-- WHY TWO DIFFERENT SOURCES OF TRUTH, AND WHY THAT IS THE POINT
--
-- Rules 3 and 4 are about what EXISTS, so they count live rows: deleting a
-- comment genuinely frees a slot, which is what "currently existing" means.
--
-- Rules 1 and 2 are about what HAPPENED, and counting live rows would make them
-- trivially defeatable — comment, delete, comment, delete is unlimited if
-- history is erased with the row. So they read `rate_limit_events`, the
-- append-only log 0003 already maintains, keyed `comment:<post_id>`. A row
-- lands there only when a comment is actually created, and nothing removes it
-- when the comment is deleted. Delete-and-retry therefore frees a lifetime slot
-- and still waits out the cooldown and the hour, exactly as specified.
--
-- ---------------------------------------------------------------------------
-- CONCURRENCY: ONE LOCK, AND WHY ONE IS ENOUGH
--
-- A transaction-scoped advisory lock on the POST serialises every insert into
-- that post. Two people commenting on a 29-comment post cannot both read 29 and
-- both write; the second waits, re-reads 30, and is rejected. The 31st comment
-- is not possible.
--
-- A second lock on (user, post) would add nothing: the per-user rules are all
-- scoped to this same post, so post-level serialisation is already a superset
-- of user-and-post serialisation. Taking two locks would only introduce an
-- ordering to get wrong. The lock is transaction-scoped, so it is released at
-- commit or rollback with no unlock path to forget, and different posts hash to
-- different keys and never contend.
--
-- ---------------------------------------------------------------------------
-- WHERE THIS RUNS
--
-- BEFORE INSERT, and named so it sorts after the two existing BEFORE triggers:
-- PostgreSQL fires same-event triggers in NAME order, so `enforce_not_banned_*`
-- and `post_comments_enforce_depth` still run first (both cheaper, and a banned
-- or malformed insert should not take a lock). Raising here aborts the
-- statement before ANY AFTER trigger, so a rejected comment creates no Aura
-- row, no achievement progress, no notification and no counter change — none of
-- those triggers ever runs.
--
-- IDENTITY. `auth.uid()` must equal `new.author_id` whenever there is a JWT, so
-- no SECURITY DEFINER wrapper can write a comment on somebody else's behalf.
-- The limits themselves apply even when there is no JWT (a psql session, an
-- admin script), because "it came from a definer function" is not a reason to
-- be exempt. The ONLY exemption is an explicit, transaction-scoped
-- `app.comment_import` flag, the same escape hatch 0178 uses for match imports
-- and 0009 for community moderation. Nothing in the application sets it, and a
-- client cannot: PostgREST offers no way to SET a GUC, and no RPC here does.
-- =============================================================================

set check_function_bodies = off;

-- Supports the two durable-history reads below. The existing
-- rate_limit_events index from 0003 covers (user_id, action); adding created_at
-- makes both the cooldown probe and the hourly count index-only.
create index if not exists rate_limit_events_user_action_time_idx
  on public.rate_limit_events (user_id, action, created_at desc);

-- Rules 3 and 4 read live rows. post_comments_post_author_idx (post_id,
-- author_id) and post_comments_post_idx (post_id, created_at) already serve
-- them; recorded here so the next reader does not add a third.

create or replace function public.enforce_comment_spam_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_action  text;
  v_recent  boolean;
  v_hour    integer;
  v_mine    integer;
  v_total   integer;
begin
  -- The one exemption. Deliberately narrow, deliberately not reachable from a
  -- client. See the header.
  if current_setting('app.comment_import', true) = '1' then
    return new;
  end if;

  -- A definer wrapper does not get to write as someone else.
  if uid is not null and uid <> new.author_id then
    raise exception 'comment_author_mismatch'
      using errcode = '42501',
            hint = 'A comment may only be created by its own author.';
  end if;

  v_action := 'comment:' || new.post_id::text;

  -- SERIALISE THE WHOLE POST. Everything below is a read-then-write decision,
  -- and this is what stops two concurrent inserts both seeing 29.
  perform pg_advisory_xact_lock(hashtextextended(v_action, 0));

  -- ---- 4. Post cap, checked FIRST. ---------------------------------------
  -- A deliberate departure from the order the brief lists the rules in: when a
  -- discussion is closed, "wait 30 seconds" is advice that cannot work, and the
  -- stale-UI case (the reader's page still says 29) is exactly when a person
  -- meets this. They should be told the thread is full, not told to wait.
  --
  -- `>= 30` also handles the posts that already have more than 30 from before
  -- this migration: they are locked to new comments and NOTHING is deleted.
  -- They keep their real count and reopen naturally if they ever fall below 30.
  select count(*) into v_total
    from public.post_comments c where c.post_id = new.post_id;
  if v_total >= 30 then
    raise exception 'comment_post_full'
      using errcode = 'P0001',
            hint = 'This post has reached its limit of 30 comments.';
  end if;

  -- ---- 1. Cooldown: 30 seconds per user per post. ------------------------
  -- Read from the durable log, not from live rows, so deleting the previous
  -- comment does not reset the clock.
  select exists (
    select 1 from public.rate_limit_events e
     where e.user_id = new.author_id
       and e.action = v_action
       and e.created_at > now() - interval '30 seconds'
  ) into v_recent;
  if v_recent then
    raise exception 'comment_cooldown'
      using errcode = 'P0001',
            hint = 'Please wait 30 seconds before commenting on this post again.';
  end if;

  -- ---- 2. Rolling hour: 5 per user per post. -----------------------------
  select count(*) into v_hour
    from public.rate_limit_events e
   where e.user_id = new.author_id
     and e.action = v_action
     and e.created_at > now() - interval '1 hour';
  if v_hour >= 5 then
    raise exception 'comment_hourly_limit'
      using errcode = 'P0001',
            hint = 'You can only post 5 comments per hour on the same post.';
  end if;

  -- ---- 3. Personal cap: 10 currently existing per user per post. ---------
  -- Live rows on purpose: deleting one of your own comments frees a slot.
  select count(*) into v_mine
    from public.post_comments c
   where c.post_id = new.post_id and c.author_id = new.author_id;
  if v_mine >= 10 then
    raise exception 'comment_user_post_limit'
      using errcode = 'P0001',
            hint = 'You have reached your limit of 10 comments on this post.';
  end if;

  -- Every check passed: record the creation in the durable log. Written HERE,
  -- after the last rejection and before the row exists, so the log counts
  -- comments that were actually created and never counts a rejected attempt.
  insert into public.rate_limit_events (user_id, action)
  values (new.author_id, v_action);

  return new;
end;
$$;

comment on function public.enforce_comment_spam_limits() is
  'BEFORE INSERT on post_comments: 30s per-post cooldown, 5/hour per user per post, 10 existing per user per post, 30 existing per post. Serialised by a post-scoped advisory lock. Cooldown and hourly read the append-only rate_limit_events log so delete-and-retry cannot reset them. See migration 0193.';

revoke all on function public.enforce_comment_spam_limits()
  from public, anon, authenticated;

-- Named to sort AFTER the existing BEFORE INSERT triggers
-- (enforce_not_banned_post_comments, post_comments_enforce_depth,
-- post_comments_rate_limit), which fire in name order.
drop trigger if exists post_comments_spam_limits on public.post_comments;
create trigger post_comments_spam_limits
  before insert on public.post_comments
  for each row execute function public.enforce_comment_spam_limits();

-- 0187's 80/hour ACROSS ALL POSTS is deliberately left in place. It is not a
-- conflicting limit but a wider one: these four rules bound what one person can
-- do to one post, and that bounds what they can do to the whole feed. Both are
-- enforced, and the stricter one wins wherever they overlap.

-- =============================================================================
-- VERIFY
--   -- nothing is deleted by this migration:
--   select count(*) from public.post_comments;   -- unchanged
--
--   -- posts already over the cap keep their real count and are simply closed:
--   select post_id, count(*) from public.post_comments
--    group by post_id having count(*) >= 30;
--
--   supabase/tests/comment_spam_limits.sql exercises all four rules,
--   concurrency, and the delete-and-retry evasion.
--
-- ROLLBACK
--   drop trigger if exists post_comments_spam_limits on public.post_comments;
--   drop function if exists public.enforce_comment_spam_limits();
--   The rate_limit_events rows it wrote are harmless history and age out.
-- =============================================================================
