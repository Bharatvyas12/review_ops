-- =============================================================================
-- 0012  Campaigns.
--
-- A campaign is a (brand, number) pair — e.g. boAt × Campaign 3.
-- Numbers are 1-10, unique per brand, enforced both by a CHECK constraint and
-- by the UNIQUE index.  The admin_create_campaign RPC checks the pair does not
-- already exist before inserting, giving a clean error message instead of a
-- raw unique-violation.
--
-- brand_id is a hard FK with ON DELETE RESTRICT so a brand row cannot be
-- dropped while it still has campaigns.  (admin_delete_brand already blocks
-- on product name-match; this covers the campaigns side at the schema level.)
--
-- RLS / audit pattern mirrors 0011 (brands) exactly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------
create table if not exists public.campaigns (
  id               uuid    primary key default gen_random_uuid(),
  brand_id         uuid    not null references public.brands(id) on delete restrict,
  campaign_number  int     not null check (campaign_number between 1 and 10),
  created_by       uuid    references public.profiles(id),
  created_at       timestamptz not null default now(),
  unique (brand_id, campaign_number)
);

comment on table  public.campaigns                    is 'Brand × campaign-number pairs. Admin-only; no end-user access.';
comment on column public.campaigns.campaign_number    is 'Fixed ordinal 1-10 within the brand, enforced by CHECK and UNIQUE.';

-- -----------------------------------------------------------------------------
-- RLS — admin-only
-- -----------------------------------------------------------------------------
alter table public.campaigns enable row level security;

drop policy if exists campaigns_select_admin on public.campaigns;
drop policy if exists campaigns_insert_admin on public.campaigns;
drop policy if exists campaigns_delete_admin on public.campaigns;

create policy campaigns_select_admin on public.campaigns
  for select to authenticated
  using (public.is_admin());

create policy campaigns_insert_admin on public.campaigns
  for insert to authenticated
  with check (public.is_admin());

create policy campaigns_delete_admin on public.campaigns
  for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- admin_create_campaign
-- -----------------------------------------------------------------------------
create or replace function public.admin_create_campaign(
  p_brand_id        uuid,
  p_campaign_number int
)
returns public.campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin     uuid := public.assert_admin();
  v_brand     public.brands;
  v_campaign  public.campaigns;
begin
  -- Brand must exist.
  select * into v_brand from public.brands where id = p_brand_id;
  if not found then
    raise exception 'brand not found' using errcode = 'P0002';
  end if;

  -- Validate campaign number range.
  if p_campaign_number is null or p_campaign_number < 1 or p_campaign_number > 10 then
    raise exception 'campaign_number must be between 1 and 10' using errcode = 'P0001';
  end if;

  -- Give a clear message instead of a raw unique-violation.
  if exists (
    select 1 from public.campaigns
     where brand_id = p_brand_id
       and campaign_number = p_campaign_number
  ) then
    raise exception 'Campaign % is already registered for brand "%"',
      p_campaign_number, v_brand.name
      using errcode = 'P0001';
  end if;

  insert into public.campaigns (brand_id, campaign_number, created_by)
  values (p_brand_id, p_campaign_number, v_admin)
  returning * into v_campaign;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    'create_campaign',
    'campaigns',
    v_campaign.id,
    jsonb_build_object(
      'brand_id',        p_brand_id,
      'brand_name',      v_brand.name,
      'campaign_number', p_campaign_number
    )
  );

  return v_campaign;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_delete_campaign
-- -----------------------------------------------------------------------------
create or replace function public.admin_delete_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin     uuid := public.assert_admin();
  v_campaign  public.campaigns;
  v_brand     public.brands;
begin
  select * into v_campaign from public.campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  select name into v_brand from public.brands where id = v_campaign.brand_id;

  delete from public.campaigns where id = p_campaign_id;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    'delete_campaign',
    'campaigns',
    p_campaign_id,
    jsonb_build_object(
      'brand_id',        v_campaign.brand_id,
      'brand_name',      v_brand.name,
      'campaign_number', v_campaign.campaign_number
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.admin_create_campaign(uuid, int) from public;
revoke all on function public.admin_delete_campaign(uuid) from public;

revoke execute on function public.admin_create_campaign(uuid, int) from anon;
revoke execute on function public.admin_delete_campaign(uuid) from anon;

grant execute on function public.admin_create_campaign(uuid, int) to authenticated;
grant execute on function public.admin_delete_campaign(uuid) to authenticated;
