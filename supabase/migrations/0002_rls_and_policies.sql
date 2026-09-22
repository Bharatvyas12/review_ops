-- =============================================================================
-- 0002  Row Level Security.
--
-- Rules enforced here:
--   * RLS is enabled on every table. No table relies on GRANTs alone.
--   * A user can only touch their own orders / bank_details / notifications.
--   * Admin power comes exclusively from public.profiles.role = 'admin'.
--   * audit_log is append-only: there is no update/delete policy at all.
--   * bank_details.account_number_encrypted is NOT readable by anon or
--     authenticated, not even by an admin session. Only service_role can read
--     the ciphertext, which is why decryption is confined to one server route.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so the policy check itself is not filtered by the
-- profiles RLS policy (which would recurse).
-- -----------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = uid and p.role = 'admin'
  );
$$;

comment on function public.is_admin(uuid) is
  'True when the given auth user has profiles.role = admin. The single source of truth for admin access.';

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere (default deny: no policy == no access).
-- -----------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.bank_details enable row level security;
alter table public.products     enable row level security;
alter table public.orders       enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log    enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_delete_admin on public.profiles;

drop policy if exists bank_details_select_own_or_admin on public.bank_details;
drop policy if exists bank_details_insert_own on public.bank_details;
drop policy if exists bank_details_update_own on public.bank_details;

drop policy if exists products_select on public.products;
drop policy if exists products_insert_admin on public.products;
drop policy if exists products_update_admin on public.products;
drop policy if exists products_delete_admin on public.products;

drop policy if exists orders_select_own_or_admin on public.orders;
drop policy if exists orders_insert_own on public.orders;
drop policy if exists orders_update_own_or_admin on public.orders;
drop policy if exists orders_delete_admin on public.orders;

drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
drop policy if exists notifications_insert_admin on public.notifications;

drop policy if exists audit_log_select_admin on public.audit_log;
drop policy if exists audit_log_insert_admin on public.audit_log;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- bank_details  (owners write; owners + admins read the safe columns only)
-- -----------------------------------------------------------------------------
create policy bank_details_select_own_or_admin on public.bank_details
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy bank_details_insert_own on public.bank_details
  for insert to authenticated
  with check (user_id = auth.uid());

create policy bank_details_update_own on public.bank_details
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Column level privileges: the ciphertext column is invisible to clients even
-- when an admin is signed in. Only service_role (server side) may read it.
revoke all on public.bank_details from anon, authenticated;
grant select (user_id, account_holder_name, account_number_last4, ifsc_code, upi_id, updated_at)
  on public.bank_details to authenticated;
grant insert (user_id, account_holder_name, account_number_encrypted, account_number_last4, ifsc_code, upi_id)
  on public.bank_details to authenticated;
grant update (account_holder_name, account_number_encrypted, account_number_last4, ifsc_code, upi_id, updated_at)
  on public.bank_details to authenticated;
grant all on public.bank_details to service_role;

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
create policy products_select on public.products
  for select to authenticated
  using (status = 'open' or public.is_admin());

create policy products_insert_admin on public.products
  for insert to authenticated
  with check (public.is_admin());

create policy products_update_admin on public.products
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy products_delete_admin on public.products
  for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
create policy orders_select_own_or_admin on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy orders_insert_own on public.orders
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'claimed');

-- Owners may update their own row; the BEFORE UPDATE guard trigger (0003)
-- restricts *which* columns and status transitions a non-admin may touch.
create policy orders_update_own_or_admin on public.orders
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy orders_delete_admin on public.orders
  for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- notifications  (users read/mark their own; only admins/system may create)
-- -----------------------------------------------------------------------------
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_insert_admin on public.notifications
  for insert to authenticated
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- audit_log  (append-only)
-- -----------------------------------------------------------------------------
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- An admin session can only ever write rows authored by itself. The heavier
-- admin actions go through SECURITY DEFINER functions in 0003 which run as the
-- table owner, but this policy keeps direct writes honest too.
create policy audit_log_insert_admin on public.audit_log
  for insert to authenticated
  with check (public.is_admin() and admin_id = auth.uid());

revoke update, delete, truncate on public.audit_log from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Function execution rights
-- -----------------------------------------------------------------------------
revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, service_role;
