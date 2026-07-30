-- 0147 — fix-049: announcements become exactly the chat.
--
-- The blocker was the schema, not the markup. `society_announcements.title` is
-- NOT NULL with `char_length(title) between 2 and 120`, so a chat composer —
-- one text field, placeholder "Post an announcement" — literally could not
-- write a row. Deriving a title from the first line would have been a fake
-- title nobody asked for and would show up in the bubble.
--
-- So: title becomes OPTIONAL. Announcements posted from the composer are
-- body-only, like a chat message. Existing titled rows keep their title and the
-- card still renders it, so nothing already posted changes.
--
-- Also adds the two things the composer's icons need in order to be real rather
-- than decorative: an image attachment, and a poll. Polls reuse the existing
-- `community_polls` machinery unchanged — a society IS a `communities` row, so
-- the poll, its options, the votes and `community_poll_results` all work as-is,
-- and `PollCard` + `voteCommunityPoll` need no changes.

-- 1. Title optional, body may be empty when it carries a poll or an image ------
alter table public.society_announcements
  alter column title drop not null;

alter table public.society_announcements
  drop constraint if exists society_announcements_title_check,
  add  constraint society_announcements_title_check
    check (title is null or (char_length(title) >= 2 and char_length(title) <= 120));

alter table public.society_announcements
  add column if not exists poll_id         uuid references public.community_polls(id) on delete set null,
  add column if not exists attachment_url  text,
  add column if not exists attachment_type text;

alter table public.society_announcements
  drop constraint if exists society_announcements_body_check,
  add  constraint society_announcements_body_check
    check (
      char_length(body) <= 4000
      and (
        char_length(body) >= 1
        or attachment_url is not null
        or poll_id is not null
      )
    );

alter table public.society_announcements
  drop constraint if exists society_announcements_attachment_type_check,
  add  constraint society_announcements_attachment_type_check
    check (attachment_type is null or attachment_type = 'image');

alter table public.society_announcements
  drop constraint if exists society_announcements_attachment_pair_check,
  add  constraint society_announcements_attachment_pair_check
    check ((attachment_url is null) = (attachment_type is null));

-- 2. Post a body-only (or image) announcement from the composer ---------------
--    Authorization is unchanged from create_society_announcement: officers and
--    admins only. fix-049 explicitly does not change who may post.
create or replace function public.post_society_announcement(
  p_society         uuid,
  p_body            text,
  p_visibility      text default 'public',
  p_attachment_url  text default null,
  p_attachment_type text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid  uuid := auth.uid();
  v_id uuid;
begin
  if not public.is_society_officer(p_society, uid) and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  if p_visibility not in ('public', 'members') then
    raise exception 'invalid visibility';
  end if;
  if coalesce(btrim(p_body), '') = '' and p_attachment_url is null then
    raise exception 'say something or attach an image';
  end if;
  if p_attachment_url is not null and p_attachment_type <> 'image' then
    raise exception 'only images can be attached';
  end if;

  insert into public.society_announcements
    (society_id, author_id, title, body, visibility, attachment_url, attachment_type)
  values
    (p_society, uid, null, coalesce(btrim(p_body), ''), p_visibility,
     p_attachment_url, p_attachment_type)
  returning id into v_id;

  perform public.notify_society_members(
    p_society, uid, 'society_announcement',
    jsonb_build_object('society_id', p_society, 'announcement_id', v_id)
  );
  return v_id;
end;
$function$;

-- 3. Post a poll as an announcement -------------------------------------------
--    Mirrors create_community_poll, but lands in the announcement thread rather
--    than the chat room. Same poll tables, so voting is already built.
create or replace function public.post_society_announcement_poll(
  p_society    uuid,
  p_question   text,
  p_options    text[],
  p_visibility text default 'public'
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid     uuid := auth.uid();
  v_poll  uuid;
  v_id    uuid;
  v_label text;
  i int := 0;
  n int := 0;
begin
  if not public.is_society_officer(p_society, uid) and not public.is_admin(uid) then
    raise exception 'not authorized';
  end if;
  if p_visibility not in ('public', 'members') then
    raise exception 'invalid visibility';
  end if;
  if char_length(btrim(p_question)) < 1 then
    raise exception 'question is required';
  end if;
  select count(*) into n from unnest(p_options) o where btrim(o) <> '';
  if n < 2 or n > 6 then
    raise exception 'a poll needs 2-6 options';
  end if;

  insert into public.community_polls (community_id, creator_id, question)
    values (p_society, uid, btrim(p_question)) returning id into v_poll;

  foreach v_label in array p_options loop
    if btrim(v_label) <> '' then
      insert into public.community_poll_options (poll_id, label, position)
        values (v_poll, btrim(v_label), i);
      i := i + 1;
    end if;
  end loop;

  insert into public.society_announcements
    (society_id, author_id, title, body, visibility, poll_id)
  values
    (p_society, uid, null, btrim(p_question), p_visibility, v_poll)
  returning id into v_id;

  perform public.notify_society_members(
    p_society, uid, 'society_announcement',
    jsonb_build_object('society_id', p_society, 'announcement_id', v_id)
  );
  return v_id;
end;
$function$;

revoke all on function public.post_society_announcement(uuid, text, text, text, text) from public, anon;
revoke all on function public.post_society_announcement_poll(uuid, text, text[], text) from public, anon;
grant execute on function public.post_society_announcement(uuid, text, text, text, text) to authenticated;
grant execute on function public.post_society_announcement_poll(uuid, text, text[], text) to authenticated;

-- 4. Surface the new columns to the feed --------------------------------------
create or replace view public.society_announcement_feed as
 select a.id,
    a.society_id,
    a.title,
    a.body,
    a.pinned,
    a.visibility,
    a.created_at,
    a.updated_at,
    a.author_id,
    pr.full_name as author_name,
    pr.username as author_username,
    pr.avatar_url as author_avatar,
    a.author_id = auth.uid() as is_mine,
    -- new in 0147
    a.poll_id,
    a.attachment_url,
    a.attachment_type
   from society_announcements a
     join communities c on c.id = a.society_id
     join profiles pr on pr.id = a.author_id
  where c.status = 'approved'::community_status
    and (a.visibility = 'public'::text
         or a.author_id = auth.uid()
         or is_admin(auth.uid())
         or (exists ( select 1
               from community_members m
              where m.community_id = a.society_id and m.user_id = auth.uid())));
