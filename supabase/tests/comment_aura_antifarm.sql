-- ===========================================================================
-- Verification for migration 0181 (comment Aura anti-farming).
--
-- Run against a database that already has 0181 applied. It creates its own
-- fixtures inside a transaction and ROLLS BACK, so it leaves no residue.
--
--   psql "$DATABASE_URL" -f supabase/tests/comment_aura_antifarm.sql
--
-- Every check raises an exception on failure; a clean run prints only NOTICEs.
-- ===========================================================================

begin;

do $$
declare
  v_author uuid;
  v_alice  uuid;
  v_bob    uuid;
  v_post   uuid;
  c1 uuid; c2 uuid; c3 uuid;

  v_balance integer;
begin
  -- Fixtures. profiles.id references auth.users in production; these inserts
  -- assume the test database allows direct profile seeding (as the other
  -- scripts in this directory do).
  select id into v_author from public.profiles order by created_at limit 1;
  select id into v_alice  from public.profiles where id <> v_author order by created_at limit 1;
  select id into v_bob    from public.profiles where id not in (v_author, v_alice) order by created_at limit 1;
  if v_bob is null then
    raise exception 'need at least 3 profiles to run this verification';
  end if;

  insert into public.posts (author_id, body, is_anonymous)
  values (v_author, 'aura antifarm fixture', false)
  returning id into v_post;

  -- Baseline AFTER the post-created award.
  select aura_score into v_balance from public.profiles where id = v_author;

  -- 1. First comment by alice: +2.
  insert into public.post_comments (post_id, author_id, body)
  values (v_post, v_alice, 'first') returning id into c1;
  if (select aura_score from public.profiles where id = v_author) <> v_balance + 2 then
    raise exception '1: first comment did not award +2';
  end if;

  -- 2. Second comment by alice: nothing more.
  insert into public.post_comments (post_id, author_id, body)
  values (v_post, v_alice, 'second') returning id into c2;
  if (select aura_score from public.profiles where id = v_author) <> v_balance + 2 then
    raise exception '2: repeat commenter awarded again';
  end if;

  -- 3. A distinct commenter: another +2.
  insert into public.post_comments (post_id, author_id, body)
  values (v_post, v_bob, 'from bob') returning id into c3;
  if (select aura_score from public.profiles where id = v_author) <> v_balance + 4 then
    raise exception '3: distinct commenter was not awarded';
  end if;

  -- 4. Deleting one of alice's two comments reverses nothing.
  delete from public.post_comments where id = c1;
  if (select aura_score from public.profiles where id = v_author) <> v_balance + 4 then
    raise exception '4: reversed while a comment from that person remained';
  end if;

  -- 5. Deleting alice's LAST comment reverses exactly 2.
  delete from public.post_comments where id = c2;
  if (select aura_score from public.profiles where id = v_author) <> v_balance + 2 then
    raise exception '5: final comment did not reverse 2';
  end if;

  -- 6. The grant record is gone, so nothing can reverse twice.
  if exists (
    select 1 from public.comment_aura_grants
     where post_id = v_post and commenter_id = v_alice
  ) then
    raise exception '6: grant record survived the reversal';
  end if;

  -- 7. Alice comments again: earns once more, and only once.
  insert into public.post_comments (post_id, author_id, body)
  values (v_post, v_alice, 'again');
  insert into public.post_comments (post_id, author_id, body)
  values (v_post, v_alice, 'and again');
  if (select aura_score from public.profiles where id = v_author) <> v_balance + 4 then
    raise exception '7: re-commenting did not award exactly once';
  end if;

  -- 8. Deleting the POST does not debit the author and leaves no grants.
  select aura_score into v_balance from public.profiles where id = v_author;
  delete from public.posts where id = v_post;
  if (select aura_score from public.profiles where id = v_author) <> v_balance then
    raise exception '8: post deletion moved Aura';
  end if;
  if exists (select 1 from public.comment_aura_grants where post_id = v_post) then
    raise exception '8: grant records survived post deletion';
  end if;

  raise notice 'comment aura anti-farming: all checks passed';
end;
$$;

rollback;
