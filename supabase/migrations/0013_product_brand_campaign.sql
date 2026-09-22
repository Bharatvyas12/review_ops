-- =============================================================================
-- 0013  Link Products to Brands and Campaigns.
--
-- Adds nullable brand_id and campaign_id FK references to public.products,
-- while retaining legacy text columns (brand, campaign) for backward compatibility.
-- Updates admin_create_product and admin_update_product RPC signatures to accept
-- p_brand_id and p_campaign_id parameters.
-- =============================================================================

alter table public.products
  add column if not exists brand_id uuid references public.brands(id),
  add column if not exists campaign_id uuid references public.campaigns(id);

-- Drop old RPC signatures
drop function if exists public.admin_create_product(text, text, text, text, int, numeric, text, text, text, int);
drop function if exists public.admin_create_product(text, text, text, text, int, numeric, text, text, text, int, uuid, uuid);

create or replace function public.admin_create_product(
  p_name text,
  p_brand text default null,
  p_description text default null,
  p_image_url text default null,
  p_total_slots int default 1,
  p_cashback_amount numeric default null,
  p_product_link text default null,
  p_campaign text default null,
  p_asin_code text default null,
  p_daily_release_limit int default null,
  p_brand_id uuid default null,
  p_campaign_id uuid default null
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
  v_limit int := nullif(p_daily_release_limit, 0);
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
  if v_limit is not null and (v_limit < 1 or v_limit > 100000) then
    raise exception 'daily_release_limit must be between 1 and 100000 slots' using errcode = 'P0001';
  end if;

  insert into public.products (
    name, brand, description, image_url, total_slots, cashback_amount, status, created_by,
    product_link, campaign, asin_code, daily_release_limit, brand_id, campaign_id
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
    v_asin,
    v_limit,
    p_brand_id,
    p_campaign_id
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
      'brand_id', v_product.brand_id,
      'campaign_id', v_product.campaign_id,
      'total_slots', v_product.total_slots,
      'released_slots', v_product.released_slots,
      'daily_release_limit', v_product.daily_release_limit,
      'cashback_amount', v_product.cashback_amount,
      'product_link', v_product.product_link,
      'campaign', v_product.campaign,
      'asin_code', v_product.asin_code
    )
  );

  return v_product;
end;
$$;

drop function if exists public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text, int);
drop function if exists public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text, int, uuid, uuid);

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
  p_asin_code text default null,
  p_daily_release_limit int default null,
  p_brand_id uuid default null,
  p_campaign_id uuid default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.assert_admin();
  v_before public.products;
  v_product public.products;
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
  if p_daily_release_limit is not null
     and (p_daily_release_limit < 0 or p_daily_release_limit > 100000)
  then
    raise exception 'daily_release_limit must be between 1 and 100000 slots, or 0 to remove it'
      using errcode = 'P0001';
  end if;

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
         released_slots = least(released_slots, coalesce(p_total_slots, total_slots)),
         cashback_amount = coalesce(p_cashback_amount, cashback_amount),
         status = coalesce(p_status, status),
         product_link = case when p_product_link is null then product_link else v_link end,
         campaign = case when p_campaign is null then campaign else v_campaign end,
         asin_code = case when p_asin_code is null then asin_code else v_asin end,
         daily_release_limit = case
           when p_daily_release_limit is null then daily_release_limit
           when p_daily_release_limit = 0 then null
           else p_daily_release_limit
         end,
         brand_id = case when p_brand_id is null then brand_id else p_brand_id end,
         campaign_id = case when p_campaign_id is null then campaign_id else p_campaign_id end
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
        'name', v_before.name, 'brand', v_before.brand, 'brand_id', v_before.brand_id, 'campaign_id', v_before.campaign_id,
        'total_slots', v_before.total_slots, 'released_slots', v_before.released_slots,
        'daily_release_limit', v_before.daily_release_limit,
        'cashback_amount', v_before.cashback_amount, 'status', v_before.status,
        'product_link', v_before.product_link, 'campaign', v_before.campaign,
        'asin_code', v_before.asin_code
      ),
      'after', jsonb_build_object(
        'name', v_product.name, 'brand', v_product.brand, 'brand_id', v_product.brand_id, 'campaign_id', v_product.campaign_id,
        'total_slots', v_product.total_slots, 'released_slots', v_product.released_slots,
        'daily_release_limit', v_product.daily_release_limit,
        'cashback_amount', v_product.cashback_amount, 'status', v_product.status,
        'product_link', v_product.product_link, 'campaign', v_product.campaign,
        'asin_code', v_product.asin_code
      )
    )
  );

  return v_product;
end;
$$;

revoke all on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text, int, uuid, uuid) from public;
revoke all on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text, int, uuid, uuid) from public;
revoke execute on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text, int, uuid, uuid) from anon;
revoke execute on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text, int, uuid, uuid) from anon;
grant execute on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text, int, uuid, uuid) to authenticated;
grant execute on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text, int, uuid, uuid) to authenticated;
