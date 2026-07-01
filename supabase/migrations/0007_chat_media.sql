-- =============================================================================
-- FAST SOCIO — Chat media bucket (Phase 3 extras: image + voice attachments)
-- Path convention: chat-media/<conversation_id>/<uuid>.<ext>
-- Public read (images/audio render via URL); writes restricted to a participant
-- of the conversation named in the path.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

drop policy if exists "chat media is publicly readable" on storage.objects;
create policy "chat media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'chat-media');

-- Only a participant of the conversation in the first path segment may upload.
drop policy if exists "participants upload chat media" on storage.objects;
create policy "participants upload chat media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-media'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.user_low = auth.uid() or c.user_high = auth.uid())
    )
  );

drop policy if exists "participants delete their chat media" on storage.objects;
create policy "participants delete their chat media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-media'
    and owner = auth.uid()
  );
