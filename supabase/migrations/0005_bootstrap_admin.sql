-- =============================================================================
-- 0005  Admin bootstrapping.
--
-- There is no public admin sign-up. Admin accounts are created out of band:
--   * create the auth user   ->  node scripts/create-admin.mjs  (service role)
--   * promote it to admin    ->  select public.promote_admin('admin@example.com');
-- promote_admin is intentionally NOT executable by anon or authenticated.
-- =============================================================================

create or replace function public.promote_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'no auth user with email %', p_email using errcode = 'P0002';
  end if;

  insert into public.profiles (id, full_name, role)
  values (v_user_id, split_part(p_email, '@', 1), 'admin')
  on conflict (id) do update set role = 'admin';

  return v_user_id;
end;
$$;

revoke all on function public.promote_admin(text) from public;
revoke all on function public.promote_admin(text) from anon, authenticated;
grant execute on function public.promote_admin(text) to service_role;
