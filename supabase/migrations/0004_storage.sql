-- =============================================================================
-- 0004  Private storage buckets + policies.
--
-- Both buckets are PRIVATE. Nothing is served from a permanent public URL; the
-- app hands out short-lived signed URLs (see src/lib/storage.ts).
-- file_size_limit / allowed_mime_types are enforced by Storage itself, in
-- addition to the server-side validation in the upload route.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'screenshots',
  'screenshots',
  false,
  5242880, -- 5 MB
  array['image/png','image/jpeg','image/webp','image/heic','image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,
  5242880, -- 5 MB
  array['image/png','image/jpeg','image/webp','image/heic','image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists screenshots_admin_all on storage.objects;
drop policy if exists screenshots_owner_insert on storage.objects;
drop policy if exists screenshots_owner_select on storage.objects;
drop policy if exists product_images_admin_all on storage.objects;
drop policy if exists product_images_read on storage.objects;

-- Screenshots: admins manage everything; a user may only write into a folder
-- named after their own auth uid and only read that same folder.
create policy screenshots_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'screenshots' and public.is_admin())
  with check (bucket_id = 'screenshots' and public.is_admin());

create policy screenshots_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy screenshots_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'screenshots'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Product images: admins manage; any signed-in user may read (product catalogue).
create policy product_images_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

create policy product_images_read on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images');
