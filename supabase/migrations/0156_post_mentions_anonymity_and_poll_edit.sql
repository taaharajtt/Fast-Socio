-- ---------------------------------------------------------------------------
-- FAST SOCIO — Post @-mentions: keep anonymity, and keep a poll's question in
-- sync when its post is edited.
--
-- Two gaps that only become reachable now that the post composer can actually
-- produce mention tokens and the card exposes Edit on every kind of own post.
-- ---------------------------------------------------------------------------

-- 1. notify_post_mentions (mig 0122) passed new.author_id as the actor
--    unconditionally. On an ANONYMOUS post that hands the mentioned user the
--    author's identity through the notifications -> profiles join — the exact
--    leak migs 0116/0117/0118 fixed for help responses, community messages and
--    post review. Same remedy: mask the actor, keep the notification.
create or replace function public.notify_post_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec   record;
  v_uid uuid;
begin
  if new.hidden or new.moderation_status <> 'approved' then
    return null;
  end if;

  for rec in
    select distinct (regexp_matches(
      new.body, '@\[[a-z0-9_]{1,20}\]\(([0-9a-fA-F-]{36})\)', 'g'))[1] as uid
  loop
    begin
      v_uid := rec.uid::uuid;
    exception when others then
      continue;
    end;

    -- Never notify someone that they tagged themselves.
    if v_uid = new.author_id then
      continue;
    end if;

    perform public.create_notification(
      v_uid,
      case when new.is_anonymous then null else new.author_id end,
      'mention',
      'likes',
      jsonb_build_object('post_id', new.id, 'is_anonymous', new.is_anonymous)
    );
  end loop;

  return null;
end;
$$;

-- 2. edit_post (mig 0134) already treats a poll's body as its question and
--    refuses to empty it, but only wrote posts.body — so editing a poll post
--    left post_polls.question holding the ORIGINAL wording. Nothing renders
--    that column today, which is precisely why the drift would go unnoticed.
create or replace function public.edit_post(p_post_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid      uuid := auth.uid();
  v_author uuid;
  v_image  text;
  v_poll   uuid;
  v_body   text := btrim(coalesce(p_body, ''));
begin
  select author_id, image_url, poll_id
    into v_author, v_image, v_poll
    from public.posts where id = p_post_id;

  if v_author is null then
    raise exception 'post not found';
  end if;
  if uid is null or v_author <> uid then
    raise exception 'not authorized';
  end if;
  -- A poll's body is its question, so it can never be emptied.
  if v_body = '' and (v_poll is not null or v_image is null) then
    raise exception 'write something';
  end if;
  if length(v_body) > 2000 then
    raise exception 'posts are limited to 2000 characters';
  end if;
  -- post_polls.question is capped at 300 (mig 0071). Without this the sync
  -- below would fail the whole edit on a CHECK violation instead of saying why.
  if v_poll is not null and length(v_body) > 300 then
    raise exception 'poll questions are limited to 300 characters';
  end if;

  update public.posts
     set body      = v_body,
         edited_at = now()
   where id = p_post_id;

  -- Keep the poll's stored question with the question the post now shows.
  if v_poll is not null then
    update public.post_polls
       set question = v_body
     where id = v_poll;
  end if;
end;
$function$;

grant execute on function public.edit_post(uuid, text) to authenticated;
