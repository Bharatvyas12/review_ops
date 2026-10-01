-- 0016: TEMPORARY — disable the phone-verification gate for the user panel.
--
-- Reverts the phone_verified requirement inside public.assert_verified_user()
-- so unverified numbers can claim slots and submit proof while OTP is turned
-- off in the app (see OTP_VERIFICATION_REQUIRED in src/lib/auth.ts).
--
-- To re-enable OTP: restore the phone_verified check below (see 0006) and set
-- OTP_VERIFICATION_REQUIRED back to true. No data is changed here, so flipping
-- back is safe.
-- -----------------------------------------------------------------------------
create or replace function public.assert_verified_user()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = '42501', hint = 'auth_required';
  end if;
  -- TEMPORARY: phone check bypassed. Original condition was:
  --   if not exists (select 1 from public.profiles p where p.id = v_user and p.phone_verified) then
  --     raise exception 'verify your phone number to continue'
  --       using errcode = '42501', hint = 'phone_unverified';
  --   end if;
  if not exists (select 1 from public.profiles p where p.id = v_user) then
    raise exception 'authentication required'
      using errcode = '42501', hint = 'auth_required';
  end if;
  return v_user;
end;
$$;

comment on function public.assert_verified_user() is
  'TEMPORARY: returns auth.uid() for any signed-in user with a profile row; phone check disabled while OTP is off.';
