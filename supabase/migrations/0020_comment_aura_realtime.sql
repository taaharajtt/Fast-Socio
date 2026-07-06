-- =============================================================================
-- FAST SOCIO — Comment Aura + realtime comments (CR-008 follow-up)
-- Two gaps closed:
--   1. Commenting awarded no Aura. Spec: +2 Aura to the POST AUTHOR per comment,
--      skipped for self-comments. Mirrors award_post_aura's insert-into-ledger
--      pattern (a downstream trigger recomputes profiles.aura).
--   2. post_comments was not in the realtime publication, so the post-detail
--      view could not receive live comment inserts. Added here (RLS still gates
--      per-subscriber delivery).
-- NOTE: the new enum value must be committed before it is used at runtime, so
-- the ALTER TYPE is deliberately its own statement ahead of the trigger.
-- =============================================================================

alter type public.aura_reason add value if not exists 'comment_received';

-- ---------------------------------------------------------------------------
-- +2 Aura to the post author on each comment; never for commenting on your own
-- post. SECURITY DEFINER so it can write the ledger regardless of caller grants.
-- ---------------------------------------------------------------------------
create or replace function public.award_comment_aura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author uuid;
begin
  select author_id into author from public.posts where id = new.post_id;
  if author is not null and author <> new.author_id then
    insert into public.aura_transactions (user_id, delta, reason)
      values (author, 2, 'comment_received');
  end if;
  return null;
end;
$$;

create trigger post_comments_award_aura
  after insert on public.post_comments
  for each row execute function public.award_comment_aura();

-- Realtime for live comment threads (RLS on post_comments still applies).
alter publication supabase_realtime add table public.post_comments;
