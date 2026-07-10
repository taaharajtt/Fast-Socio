-- M2: content & DM moderation. Reads/writes go through SECURITY DEFINER RPCs so
-- moderators (is_admin) get a consistent, audited surface regardless of the
-- per-table RLS. Soft-hide is used where a `hidden` column exists; hard delete
-- captures a before-snapshot into the audit log.
-- (Applied to the live DB as migration 0039_admin_content_moderation.)

create or replace function public._admin_guard()
returns void language plpgsql as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not authorized: admin required';
  end if;
end $$;

create or replace function public.admin_content_feed(
  p_type text, p_search text default null, p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_q text := '%' || coalesce(p_search, '') || '%';
  v_rows jsonb; v_total bigint;
begin
  perform public._admin_guard();

  if p_type = 'post' then
    select count(*) into v_total from posts p where (p_search is null or p.body ilike v_q);
    select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_rows from (
      select p.created_at as ts, jsonb_build_object(
        'id', p.id, 'author_id', p.author_id,
        'author', case when p.is_anonymous then 'Anonymous' else coalesce(pr.full_name, '—') end,
        'body', p.body, 'created_at', p.created_at, 'hidden', p.hidden,
        'context', coalesce(c.name, 'Feed'),
        'extra', jsonb_build_object('likes', p.like_count, 'comments', p.comment_count, 'moderation', p.moderation_status)
      ) x
      from posts p
      left join profiles pr on pr.id = p.author_id
      left join communities c on c.id = p.community_id
      where (p_search is null or p.body ilike v_q)
      order by p.created_at desc limit v_lim offset v_off
    ) q;

  elsif p_type = 'comment' then
    select count(*) into v_total from post_comments pc where (p_search is null or pc.body ilike v_q);
    select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_rows from (
      select pc.created_at as ts, jsonb_build_object(
        'id', pc.id, 'author_id', pc.author_id, 'author', coalesce(pr.full_name, '—'),
        'body', pc.body, 'created_at', pc.created_at, 'hidden', pc.hidden,
        'context', 'post ' || left(pc.post_id::text, 8), 'extra', '{}'::jsonb
      ) x
      from post_comments pc
      left join profiles pr on pr.id = pc.author_id
      where (p_search is null or pc.body ilike v_q)
      order by pc.created_at desc limit v_lim offset v_off
    ) q;

  elsif p_type = 'message' then
    select count(*) into v_total from messages m where (p_search is null or m.body ilike v_q);
    select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_rows from (
      select m.created_at as ts, jsonb_build_object(
        'id', m.id, 'author_id', m.sender_id, 'author', coalesce(pr.full_name, '—'),
        'body', coalesce(m.body, ''), 'created_at', m.created_at, 'hidden', m.hidden,
        'context', 'dm ' || left(m.conversation_id::text, 8),
        'extra', jsonb_build_object('attachment', m.attachment_type, 'conversation_id', m.conversation_id)
      ) x
      from messages m
      left join profiles pr on pr.id = m.sender_id
      where (p_search is null or m.body ilike v_q)
      order by m.created_at desc limit v_lim offset v_off
    ) q;

  elsif p_type = 'community' then
    select count(*) into v_total from community_chat_messages cm where (p_search is null or cm.body ilike v_q);
    select coalesce(jsonb_agg(x order by ts desc), '[]'::jsonb) into v_rows from (
      select cm.created_at as ts, jsonb_build_object(
        'id', cm.id, 'author_id', cm.sender_id, 'author', coalesce(pr.full_name, '—'),
        'body', cm.body, 'created_at', cm.created_at, 'hidden', false,
        'context', coalesce(c.name, '—'), 'extra', '{}'::jsonb
      ) x
      from community_chat_messages cm
      left join profiles pr on pr.id = cm.sender_id
      left join communities c on c.id = cm.community_id
      where (p_search is null or cm.body ilike v_q)
      order by cm.created_at desc limit v_lim offset v_off
    ) q;
  else
    raise exception 'unknown content type: %', p_type;
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_lim, 'offset', v_off);
end $$;

create or replace function public.admin_set_content_hidden(p_type text, p_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_guard();
  if p_type = 'post' then update posts set hidden = p_hidden where id = p_id;
  elsif p_type = 'comment' then update post_comments set hidden = p_hidden where id = p_id;
  elsif p_type = 'message' then update messages set hidden = p_hidden where id = p_id;
  else raise exception 'cannot hide content type: %', p_type;
  end if;
  perform public.log_admin_action(
    (case when p_hidden then 'content.hide:' else 'content.unhide:' end) || p_type,
    null, p_id, null, null, jsonb_build_object('type', p_type));
end $$;

create or replace function public.admin_delete_content(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform public._admin_guard();
  if p_type = 'post' then
    select to_jsonb(t) into v_before from posts t where id = p_id;
    delete from posts where id = p_id;
  elsif p_type = 'comment' then
    select to_jsonb(t) into v_before from post_comments t where id = p_id;
    delete from post_comments where id = p_id;
  elsif p_type = 'message' then
    select to_jsonb(t) into v_before from messages t where id = p_id;
    delete from messages where id = p_id;
  elsif p_type = 'community' then
    select to_jsonb(t) into v_before from community_chat_messages t where id = p_id;
    delete from community_chat_messages where id = p_id;
  else raise exception 'unknown content type: %', p_type;
  end if;
  perform public.log_admin_action('content.delete:' || p_type, null, p_id, v_before, null,
    jsonb_build_object('type', p_type));
end $$;

create or replace function public.admin_dm_conversations(
  p_search text default null, p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v jsonb;
begin
  perform public._admin_guard();
  select coalesce(jsonb_agg(x order by ts desc nulls last), '[]'::jsonb) into v from (
    select cv.last_message_at as ts, jsonb_build_object(
      'id', cv.id, 'low_name', coalesce(lo.full_name, '—'), 'high_name', coalesce(hi.full_name, '—'),
      'last_message_at', cv.last_message_at,
      'count', (select count(*) from messages m where m.conversation_id = cv.id)
    ) x
    from conversations cv
    left join profiles lo on lo.id = cv.user_low
    left join profiles hi on hi.id = cv.user_high
    where p_search is null
       or lo.full_name ilike '%' || p_search || '%'
       or hi.full_name ilike '%' || p_search || '%'
    order by cv.last_message_at desc nulls last limit v_lim offset v_off
  ) q;
  return v;
end $$;

create or replace function public.admin_dm_messages(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_guard();
  perform public.log_admin_action('dm.view', null, p_conversation_id, null, null,
    jsonb_build_object('conversation', p_conversation_id));
  select coalesce(jsonb_agg(x order by ts asc), '[]'::jsonb) into v from (
    select m.created_at as ts, jsonb_build_object(
      'id', m.id, 'sender_id', m.sender_id, 'sender', coalesce(pr.full_name, '—'),
      'body', m.body, 'attachment_type', m.attachment_type, 'attachment_url', m.attachment_url,
      'shared_post_id', m.shared_post_id, 'hidden', m.hidden, 'created_at', m.created_at
    ) x
    from messages m
    left join profiles pr on pr.id = m.sender_id
    where m.conversation_id = p_conversation_id
  ) q;
  return v;
end $$;

grant execute on function public.admin_content_feed(text, text, int, int) to authenticated;
grant execute on function public.admin_set_content_hidden(text, uuid, boolean) to authenticated;
grant execute on function public.admin_delete_content(text, uuid) to authenticated;
grant execute on function public.admin_dm_conversations(text, int, int) to authenticated;
grant execute on function public.admin_dm_messages(uuid) to authenticated;
