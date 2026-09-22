-- =============================================================================
-- 0011  Brands.
--
-- A brand is an advertiser entity that owns campaigns and products. It stores
-- point-of-contact info so the ops team can reach the brand owner directly.
--
-- Rules:
--   * Admin-only table: no end-user RLS policy exists, so any authenticated
--     non-admin request is blocked by default-deny.
--   * All mutations go through SECURITY DEFINER RPCs that call assert_admin()
--     and write the audit_log in the same transaction.
--   * Deletion is blocked when the brand is referenced by campaigns or products
--     (soft referential protection — no FK enforces this at the schema level so
--     that campaigns / products can land in a later migration without needing to
--     backfill brand_id first).
--   * brand_seq is a bigserial that drives the human-readable BR-NNN id shown
--     in the UI.  The formatted id is computed in the client layer as
--     'BR-' || lpad(brand_seq::text, 3, '0') so no extra view is needed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table if not exists public.brands (
  id           uuid         primary key default gen_random_uuid(),
  brand_seq    bigint       generated always as identity,
  name         text         not null,
  poc_name     text,
  poc_number   text,
  poc_email    text,
  website      text,
  created_by   uuid         references public.profiles(id),
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

comment on table  public.brands                is 'Advertiser brands. Admin-only; no end-user access.';
comment on column public.brands.brand_seq      is 'Monotonic sequence used to build the human-readable BR-NNN display id.';
comment on column public.brands.poc_name       is 'Point-of-contact name at the brand.';
comment on column public.brands.poc_number     is 'Point-of-contact phone/WhatsApp at the brand.';
comment on column public.brands.poc_email      is 'Point-of-contact e-mail at the brand.';

-- -----------------------------------------------------------------------------
-- updated_at trigger (reuse the shared helper from 0003 if it exists, otherwise
-- create a local one using the same body).
-- -----------------------------------------------------------------------------
create or replace function public.set_brands_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_brands_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — admin-only (no end-user policies; default-deny blocks everyone else).
-- -----------------------------------------------------------------------------
alter table public.brands enable row level security;

drop policy if exists brands_select_admin on public.brands;
drop policy if exists brands_insert_admin on public.brands;
drop policy if exists brands_update_admin on public.brands;
drop policy if exists brands_delete_admin on public.brands;

create policy brands_select_admin on public.brands
  for select to authenticated
  using (public.is_admin());

create policy brands_insert_admin on public.brands
  for insert to authenticated
  with check (public.is_admin());

create policy brands_update_admin on public.brands
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy brands_delete_admin on public.brands
  for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- admin_create_brand
-- -----------------------------------------------------------------------------
create or replace function public.admin_create_brand(
  p_name       text,
  p_poc_name   text default null,
  p_poc_number text default null,
  p_poc_email  text default null,
  p_website    text default null
)
returns public.brands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin  uuid := public.assert_admin();
  v_brand  public.brands;
  v_name   text := btrim(coalesce(p_name, ''));
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
begin
  if length(v_name) = 0 then
    raise exception 'brand name is required' using errcode = 'P0001';
  end if;
  if length(v_name) > 200 then
    raise exception 'brand name must be 200 characters or fewer' using errcode = 'P0001';
  end if;
  if v_website is not null and v_website !~* '^https?://' then
    raise exception 'website must be a full http(s) URL' using errcode = 'P0001';
  end if;

  insert into public.brands (name, poc_name, poc_number, poc_email, website, created_by)
  values (
    v_name,
    nullif(btrim(coalesce(p_poc_name,   '')), ''),
    nullif(btrim(coalesce(p_poc_number, '')), ''),
    nullif(btrim(coalesce(p_poc_email,  '')), ''),
    v_website,
    v_admin
  )
  returning * into v_brand;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    'create_brand',
    'brands',
    v_brand.id,
    jsonb_build_object(
      'name',       v_brand.name,
      'poc_name',   v_brand.poc_name,
      'poc_email',  v_brand.poc_email,
      'website',    v_brand.website
    )
  );

  return v_brand;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_update_brand
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_brand(
  p_brand_id   uuid,
  p_name       text default null,
  p_poc_name   text default null,
  p_poc_number text default null,
  p_poc_email  text default null,
  p_website    text default null
)
returns public.brands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin   uuid := public.assert_admin();
  v_before  public.brands;
  v_brand   public.brands;
  v_website text;
begin
  select * into v_before from public.brands where id = p_brand_id for update;
  if not found then
    raise exception 'brand not found' using errcode = 'P0002';
  end if;

  if p_name is not null and length(btrim(p_name)) = 0 then
    raise exception 'brand name cannot be empty' using errcode = 'P0001';
  end if;
  if p_name is not null and length(btrim(p_name)) > 200 then
    raise exception 'brand name must be 200 characters or fewer' using errcode = 'P0001';
  end if;

  if p_website is not null then
    v_website := nullif(btrim(p_website), '');
    if v_website is not null and v_website !~* '^https?://' then
      raise exception 'website must be a full http(s) URL' using errcode = 'P0001';
    end if;
  end if;

  update public.brands
     set name       = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         poc_name   = case when p_poc_name   is null then poc_name   else nullif(btrim(p_poc_name),   '') end,
         poc_number = case when p_poc_number is null then poc_number else nullif(btrim(p_poc_number), '') end,
         poc_email  = case when p_poc_email  is null then poc_email  else nullif(btrim(p_poc_email),  '') end,
         website    = case when p_website    is null then website    else v_website end
   where id = p_brand_id
   returning * into v_brand;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    'update_brand',
    'brands',
    p_brand_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', v_before.name, 'poc_name', v_before.poc_name,
        'poc_email', v_before.poc_email, 'website', v_before.website
      ),
      'after', jsonb_build_object(
        'name', v_brand.name, 'poc_name', v_brand.poc_name,
        'poc_email', v_brand.poc_email, 'website', v_brand.website
      )
    )
  );

  return v_brand;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_delete_brand
--
-- Blocked when any campaign (products.campaign text value) or product row still
-- references this brand by name. Since brand linkage is currently a text field
-- (not a FK), we block on name match as a conservative safety check.
-- When a brand_id FK is added to campaigns/products in a future migration, this
-- function should be updated to check that FK instead.
-- -----------------------------------------------------------------------------
create or replace function public.admin_delete_brand(p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin    uuid := public.assert_admin();
  v_brand    public.brands;
  v_products int;
begin
  select * into v_brand from public.brands where id = p_brand_id for update;
  if not found then
    raise exception 'brand not found' using errcode = 'P0002';
  end if;

  -- Block deletion when products still carry this brand name.
  select count(*)::int into v_products
    from public.products
   where brand = v_brand.name;

  if v_products > 0 then
    raise exception
      'cannot delete brand "%": it is used by % product(s). Remove or re-assign those products first.',
      v_brand.name, v_products
      using errcode = 'P0001';
  end if;

  delete from public.brands where id = p_brand_id;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    'delete_brand',
    'brands',
    p_brand_id,
    jsonb_build_object('name', v_brand.name)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants — same pattern as admin_create_product / admin_update_product.
-- assert_admin() re-checks inside the function body; these grants allow the
-- authenticated role to call the RPC at all.
-- -----------------------------------------------------------------------------
revoke all on function public.admin_create_brand(text, text, text, text, text) from public;
revoke all on function public.admin_update_brand(uuid, text, text, text, text, text) from public;
revoke all on function public.admin_delete_brand(uuid) from public;

revoke execute on function public.admin_create_brand(text, text, text, text, text) from anon;
revoke execute on function public.admin_update_brand(uuid, text, text, text, text, text) from anon;
revoke execute on function public.admin_delete_brand(uuid) from anon;

grant execute on function public.admin_create_brand(text, text, text, text, text) to authenticated;
grant execute on function public.admin_update_brand(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.admin_delete_brand(uuid) to authenticated;
