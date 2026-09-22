-- =============================================================================
-- 0008  Product detail fields.
--
-- Records the extra Amazon-facing detail on a product:
--   * product_link  - the Amazon product URL
--   * campaign      - the campaign label the admin files the product under
--   * asin_code     - Amazon's ASIN
--
-- brand_name gets no column: public.products.brand already exists and holds
-- exactly that value, so the form reuses it rather than growing a duplicate.
--
-- admin_create_product and admin_update_product take three new arguments, which
-- makes a new function signature. The old ones are dropped before the new ones
-- are created: leaving them in place would leave two overloads for the same
-- PostgREST call, and PostgREST cannot choose between them.
--
-- Nothing in 0001-0007 is edited.
-- =============================================================================

alter table public.products add column if not exists product_link text;
alter table public.products add column if not exists campaign text;
alter table public.products add column if not exists asin_code text;

comment on column public.products.product_link is
  'Amazon product URL. Null when the admin has not recorded one.';
comment on column public.products.campaign is
  'Free-text campaign label the product is filed under.';
comment on column public.products.asin_code is
  'Amazon ASIN, stored upper-cased. Null when unknown.';

-- Added conditionally so re-running this file stays a no-op. The same rules are
-- enforced in the admin functions below; these constraints are the backstop if a
-- row is ever written another way.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_product_link_shape') then
    alter table public.products
      add constraint products_product_link_shape
      check (product_link is null or (length(product_link) between 8 and 1024 and product_link ~* '^https?://'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_campaign_length') then
    alter table public.products
      add constraint products_campaign_length
      check (campaign is null or length(btrim(campaign)) between 1 and 120);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'products_asin_code_shape') then
    alter table public.products
      add constraint products_asin_code_shape
      check (asin_code is null or asin_code ~ '^[A-Z0-9]{10}$');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_create_product, extended with the new detail fields.
-- -----------------------------------------------------------------------------
drop function if exists public.admin_create_product(text, text, text, text, int, numeric);

create or replace function public.admin_create_product(
  p_name text,
  p_brand text default null,
  p_description text default null,
  p_image_url text default null,
  p_total_slots int default 1,
  p_cashback_amount numeric default null,
  p_product_link text default null,
  p_campaign text default null,
  p_asin_code text default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.assert_admin();
  v_product public.products;
  v_link text := nullif(btrim(coalesce(p_product_link, '')), '');
  v_campaign text := nullif(btrim(coalesce(p_campaign, '')), '');
  v_asin text := upper(nullif(btrim(coalesce(p_asin_code, '')), ''));
begin
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'product name is required' using errcode = 'P0001';
  end if;
  if p_total_slots is null or p_total_slots < 1 or p_total_slots > 100000 then
    raise exception 'total_slots must be between 1 and 100000' using errcode = 'P0001';
  end if;
  if p_cashback_amount is not null and p_cashback_amount < 0 then
    raise exception 'cashback_amount cannot be negative' using errcode = 'P0001';
  end if;
  if v_link is not null and (length(v_link) > 1024 or v_link !~* '^https?://') then
    raise exception 'product_link must be a full http(s) URL' using errcode = 'P0001';
  end if;
  if v_campaign is not null and length(v_campaign) > 120 then
    raise exception 'campaign must be 120 characters or fewer' using errcode = 'P0001';
  end if;
  if v_asin is not null and v_asin !~ '^[A-Z0-9]{10}$' then
    raise exception 'asin_code must be exactly 10 letters or digits' using errcode = 'P0001';
  end if;

  insert into public.products (
    name, brand, description, image_url, total_slots, cashback_amount, status, created_by,
    product_link, campaign, asin_code
  )
  values (
    btrim(p_name),
    nullif(btrim(coalesce(p_brand, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_image_url, '')), ''),
    p_total_slots,
    p_cashback_amount,
    'open',
    v_admin,
    v_link,
    v_campaign,
    v_asin
  )
  returning * into v_product;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    'create_product',
    'products',
    v_product.id,
    jsonb_build_object(
      'name', v_product.name,
      'brand', v_product.brand,
      'total_slots', v_product.total_slots,
      'cashback_amount', v_product.cashback_amount,
      'product_link', v_product.product_link,
      'campaign', v_product.campaign,
      'asin_code', v_product.asin_code
    )
  );

  return v_product;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_update_product, extended the same way.
--
-- The new fields follow the existing convention: null leaves the stored value
-- alone, an empty string clears it.
-- -----------------------------------------------------------------------------
drop function if exists public.admin_update_product(uuid, text, text, text, text, int, numeric, text);

create or replace function public.admin_update_product(
  p_product_id uuid,
  p_name text default null,
  p_brand text default null,
  p_description text default null,
  p_image_url text default null,
  p_total_slots int default null,
  p_cashback_amount numeric default null,
  p_status text default null,
  p_product_link text default null,
  p_campaign text default null,
  p_asin_code text default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.assert_admin();
  v_product public.products;
  v_before public.products;
  v_link text;
  v_campaign text;
  v_asin text;
begin
  select * into v_before from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if p_status is not null and p_status not in ('open', 'closed') then
    raise exception 'invalid product status' using errcode = 'P0001';
  end if;
  if p_name is not null and length(btrim(p_name)) = 0 then
    raise exception 'product name cannot be empty' using errcode = 'P0001';
  end if;
  if p_total_slots is not null and (p_total_slots < 1 or p_total_slots > 100000) then
    raise exception 'total_slots must be between 1 and 100000' using errcode = 'P0001';
  end if;
  if p_total_slots is not null and p_total_slots < v_before.slots_filled then
    raise exception 'total_slots cannot be lower than the % slots already filled', v_before.slots_filled
      using errcode = 'P0001';
  end if;
  if p_cashback_amount is not null and p_cashback_amount < 0 then
    raise exception 'cashback_amount cannot be negative' using errcode = 'P0001';
  end if;

  -- Only validated when the caller is actually changing the field, so an
  -- unrelated edit to an old row can never be blocked by it.
  if p_product_link is not null then
    v_link := nullif(btrim(p_product_link), '');
    if v_link is not null and (length(v_link) > 1024 or v_link !~* '^https?://') then
      raise exception 'product_link must be a full http(s) URL' using errcode = 'P0001';
    end if;
  end if;

  if p_campaign is not null then
    v_campaign := nullif(btrim(p_campaign), '');
    if v_campaign is not null and length(v_campaign) > 120 then
      raise exception 'campaign must be 120 characters or fewer' using errcode = 'P0001';
    end if;
  end if;

  if p_asin_code is not null then
    v_asin := upper(nullif(btrim(p_asin_code), ''));
    if v_asin is not null and v_asin !~ '^[A-Z0-9]{10}$' then
      raise exception 'asin_code must be exactly 10 letters or digits' using errcode = 'P0001';
    end if;
  end if;

  update public.products
     set name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         brand = case when p_brand is null then brand else nullif(btrim(p_brand), '') end,
         description = case when p_description is null then description else nullif(btrim(p_description), '') end,
         image_url = case when p_image_url is null then image_url else nullif(btrim(p_image_url), '') end,
         total_slots = coalesce(p_total_slots, total_slots),
         cashback_amount = coalesce(p_cashback_amount, cashback_amount),
         status = coalesce(p_status, status),
         product_link = case when p_product_link is null then product_link else v_link end,
         campaign = case when p_campaign is null then campaign else v_campaign end,
         asin_code = case when p_asin_code is null then asin_code else v_asin end
   where id = p_product_id
   returning * into v_product;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    case
      when p_status = 'closed' and v_before.status <> 'closed' then 'close_product'
      when p_status = 'open' and v_before.status <> 'open' then 'reopen_product'
      else 'update_product'
    end,
    'products',
    p_product_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', v_before.name, 'brand', v_before.brand, 'total_slots', v_before.total_slots,
        'cashback_amount', v_before.cashback_amount, 'status', v_before.status,
        'product_link', v_before.product_link, 'campaign', v_before.campaign,
        'asin_code', v_before.asin_code
      ),
      'after', jsonb_build_object(
        'name', v_product.name, 'brand', v_product.brand, 'total_slots', v_product.total_slots,
        'cashback_amount', v_product.cashback_amount, 'status', v_product.status,
        'product_link', v_product.product_link, 'campaign', v_product.campaign,
        'asin_code', v_product.asin_code
      )
    )
  );

  return v_product;
end;
$$;

-- The drops above took the old grants with them, so they are re-issued here. The
-- functions self-check with assert_admin() as well.
revoke all on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text) from public;
revoke all on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text) from public;
revoke execute on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text) from anon;
revoke execute on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text) from anon;
grant execute on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text) to authenticated;
grant execute on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text) to authenticated;