-- Community owners/moderators had no notification when a member's post landed
-- in their Review queue (set_community_post_status() in 0017 sets it 'pending'
-- silently) — they'd only discover it by opening the community themselves.

create or replace function public.notify_community_post_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mod_record record;
  v_comm_name text;
begin
  -- Only trigger for community posts that start in 'pending' status.
  if new.community_id is not null and new.moderation_status = 'pending' then
    select name into v_comm_name from public.communities where id = new.community_id;

    -- Notify all owners and moderators of this community (excluding the author).
    for mod_record in
      select user_id from public.community_members
       where community_id = new.community_id
         and role in ('owner', 'moderator')
         and user_id <> new.author_id
    loop
      perform public.create_notification(
        mod_record.user_id,
        case when new.is_anonymous then null else new.author_id end,
        'community_post_review',
        'communities',
        jsonb_build_object(
          'community_id', new.community_id,
          'community_name', v_comm_name,
          'post_id', new.id
        )
      );
    end loop;
  end if;
  return null;
end;
$$;

create trigger posts_notify_community_review
  after insert on public.posts
  for each row execute function public.notify_community_post_review();

revoke all on function public.notify_community_post_review() from public, anon, authenticated;
