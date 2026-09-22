-- =============================================================================
-- 0014  Social Media Usernames for Profiles.
--
-- Adds nullable instagram_username and youtube_username columns to public.profiles.
-- Both columns store plain handles/usernames (without leading '@' or full URLs).
-- =============================================================================

alter table public.profiles
  add column if not exists instagram_username text,
  add column if not exists youtube_username text;

comment on column public.profiles.instagram_username is 'Instagram handle/username without leading @.';
comment on column public.profiles.youtube_username   is 'YouTube handle/channel name without leading @.';
