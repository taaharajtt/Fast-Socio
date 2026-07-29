-- 0133 — fix-036: the profile post count was permanently zero.
--
-- ROOT CAUSE: `public.posts` has RLS ENABLED but carries **no SELECT policy at
-- all** — only INSERT, UPDATE and DELETE policies exist. Under RLS, absent a
-- SELECT policy every read returns zero rows, so the profile's
--   .from("posts").select("id", { count: "exact", head: true })
-- counted nothing, for everyone, always. The feed never noticed because it
-- reads the `feed_posts` view (RLS off) rather than the table.
--
-- The fix is deliberately NOT "add a SELECT policy to posts". Rows carry
-- `author_id` even when `is_anonymous` is true, so a broad SELECT policy would
-- expose the author of every anonymous post — a privacy regression far worse
-- than a wrong number. Instead the count comes from a definer function that
-- returns only an aggregate and applies the viewer-appropriate rule.

create or replace function public.get_profile_post_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::int
    from public.posts p
   where p.author_id = p_user
     and (
       -- Your own profile: everything you have written, anonymous included —
       -- it is your own count, and a total reveals nothing about which post
       -- was which.
       p_user = auth.uid()
       or (
         -- Someone else's profile: only what that viewer could actually see —
         -- attributed posts that cleared moderation.
         p.is_anonymous = false
         and (p.moderation_status is null
              or p.moderation_status = 'approved'::public.post_moderation)
       )
     );
$function$;

grant execute on function public.get_profile_post_count(uuid) to authenticated;
