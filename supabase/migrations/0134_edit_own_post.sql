-- 0134 — fix-009: let an author edit their own post's text.
--
-- Scope is the BODY only. Media, anonymity, community and moderation status are
-- all immutable through this path.
--
-- Note on "only the body column mutable": RLS cannot restrict WHICH columns an
-- UPDATE touches — a policy filters rows, not columns. Column-level GRANTs
-- could, but revoking UPDATE on `posts` from `authenticated` to re-grant two
-- columns risks silently breaking any future author-scoped write. So the
-- column guarantee lives where this codebase already puts such guarantees: a
-- SECURITY DEFINER function that is the only way in. The existing
-- "authors update their own posts" policy keeps the row-level half, and gains
-- the WITH CHECK it was missing so a post can never be reassigned to someone
-- else mid-update.

alter table public.posts
  add column if not exists edited_at timestamptz;

-- The policy had a USING clause but no WITH CHECK, so an update could move a
-- row to another author.
drop policy if exists "authors update their own posts" on public.posts;
create policy "authors update their own posts"
  on public.posts for update
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

/**
 * Edit a post's text. Ownership is re-checked here rather than trusted from the
 * caller, and only `body`/`edited_at` are written — the same validation the
 * create path applies (non-empty unless the post carries an image, 2000-char
 * cap).
 */
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

  update public.posts
     set body      = v_body,
         edited_at = now()
   where id = p_post_id;
end;
$function$;

grant execute on function public.edit_post(uuid, text) to authenticated;
