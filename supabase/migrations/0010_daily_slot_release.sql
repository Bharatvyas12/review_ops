-- =============================================================================
-- 0010  Daily staggered slot release.
--
-- A product can open its slots a few at a time instead of all at once.
--
--   daily_release_limit  how many slots open per day. NULL keeps the original
--                        behaviour: every slot is claimable immediately.
--   released_slots       how many slots are claimable right now. Claims compare
--                        slots_filled against THIS, never against total_slots.
--   last_release_date    the IST calendar day the daily job last topped this
--                        product up.
--
-- released_slots never decreases (except when an admin lowers total_slots below
-- it, where it is clamped), so yesterday's unclaimed slots stay in the pool and
-- add to today's release. That is the whole rollover story - there is no
-- separate carry-forward counter to keep in sync.
--
-- The calendar is IST because the business runs in India and the job fires at
-- midnight there. 00:00 IST is 18:30 UTC the previous day, which is the cron
-- expression below. pg_cron schedules in the database time zone (UTC on
-- Supabase); if a project runs its database in another zone, change the
-- expression to match.
--
-- Nothing in 0001-0009 is edited. The two admin functions are dropped and
-- recreated because a new parameter changes their signature, exactly as 0008
-- did.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns, backfilled so every existing product behaves exactly as it did.
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists daily_release_limit int,
  add column if not exists released_slots int,
  add column if not exists last_release_date date;

update public.products
   set released_slots = total_slots
 where released_slots is null;

update public.products
   set last_release_date = (created_at at time zone 'Asia/Kolkata')::date
 where last_release_date is null;

alter table public.products
  alter column released_slots set not null;

alter table public.products
  alter column last_release_date set default (now() at time zone 'Asia/Kolkata')::date;

alter table public.products
  alter column last_release_date set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_daily_release_limit_positive') then
    alter table public.products
      add constraint products_daily_release_limit_positive
      check (daily_release_limit is null or daily_release_limit > 0);
  end if;

  -- The new hard invariant: nobody can hold more slots than have been released,
  -- and nothing can be released beyond total_slots. This is the backstop for the
  -- claim rule below, the way products_slots_bounds backstops the old one.
  if not exists (select 1 from pg_constraint where conname = 'products_released_bounds') then
    alter table public.products
      add constraint products_released_bounds
      check (
        released_slots >= 0
        and released_slots <= total_slots
        and slots_filled <= released_slots
      );
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Insert defaults.
--
-- released_slots has to be derived from daily_release_limit (or total_slots when
-- there is no limit), and a column DEFAULT cannot reference another column, so
-- it is set by a BEFORE INSERT trigger. last_release_date starts on the day the
-- product was created.
-- -----------------------------------------------------------------------------
create or replace function public.set_product_release_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.daily_release_limit is not null and new.daily_release_limit < 1 then
    raise exception 'daily_release_limit must be a positive number of slots'
      using errcode = 'P0001';
  end if;

  if new.released_slots is null then
    -- No limit means "everything is open now", which is the historical behaviour.
    new.released_slots := least(
      coalesce(new.daily_release_limit, new.total_slots),
      new.total_slots
    );
  end if;

  if new.last_release_date is null then
    new.last_release_date := (now() at time zone 'Asia/Kolkata')::date;
  end if;

  return new;
end;
$$;

drop trigger if exists products_release_defaults_before_insert on public.products;
create trigger products_release_defaults_before_insert
  before insert on public.products
  for each row execute function public.set_product_release_defaults();

-- -----------------------------------------------------------------------------
-- claim_product_slot, now bounded by released_slots.
--
-- Still a single UPDATE ... WHERE, so Postgres serialises concurrent claimants
-- and exactly one of them can take the last released slot. The only change from
-- the 0003 version is which column the availability test reads: a product with
-- 50 slots and a daily release of 5 takes 5 claims on day one, not 50.
-- -----------------------------------------------------------------------------
create or replace function public.claim_product_slot(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.products
     set slots_filled = slots_filled + 1
   where id = p_product_id
     and status = 'open'
     and slots_filled < released_slots;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

comment on function public.claim_product_slot(uuid) is
  'Atomically consumes one released product slot. Returns false when the released batch is gone, closed or unknown.';

revoke all on function public.claim_product_slot(uuid) from public;
revoke execute on function public.claim_product_slot(uuid) from anon;
grant execute on function public.claim_product_slot(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- release_daily_slots: the job body.
--
-- Deliberately date-driven rather than "add one batch": it computes the number
-- of days since last_release_date and adds daily_release_limit per elapsed day,
-- capped at total_slots. A missed run (cron paused, function failing, weekend
-- maintenance) therefore catches up on the next run instead of losing a batch.
-- Only open products with a limit are touched, and last_release_date moves to
-- today in the same statement, so a double run on the same day is a no-op.
--
-- Returns how many products it topped up, which makes it easy to run by hand
-- and see what it did.
-- -----------------------------------------------------------------------------
create or replace function public.release_daily_slots()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_released int;
begin
  with advanced as (
    update public.products
       set released_slots = least(
             total_slots,
             released_slots + daily_release_limit * (v_today - last_release_date)
           ),
           last_release_date = v_today
     where status = 'open'
       and daily_release_limit is not null
       and released_slots < total_slots
       and last_release_date < v_today
    returning 1
  )
  select count(*)::int into v_released from advanced;

  return v_released;
end;
$$;

comment on function public.release_daily_slots() is
  'Advances released_slots by daily_release_limit per elapsed day (capped at total_slots) for every open product that has a limit. Idempotent within a day.';

-- Only the scheduler and the server may drive releases; a signed-in user must
-- not be able to open a batch early.
revoke all on function public.release_daily_slots() from public;
revoke execute on function public.release_daily_slots() from anon, authenticated;
grant execute on function public.release_daily_slots() to service_role;

-- -----------------------------------------------------------------------------
-- Schedule it: every day at 00:00 IST.
--
-- Wrapped in an exception handler on purpose. pg_cron is an extension the
-- project owner has to enable, and it is not available in the in-process test
-- database at all, so a hard `create extension` would make this migration fail
-- everywhere it is not pre-installed. When it cannot be scheduled the function
-- above still exists and works - the notice says exactly what to do.
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available here (%); release_daily_slots() exists but is not scheduled. Enable pg_cron (Database > Extensions) and re-run this file.', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unscheduled first so re-running this file never stacks duplicate jobs.
    begin
      perform cron.unschedule(jobid) from cron.job where jobname = 'daily_slot_release';
    exception when others then
      null;
    end;

    perform cron.schedule(
      'daily_slot_release',
      '30 18 * * *',
      $cron$select public.release_daily_slots();$cron$
    );

    raise notice 'pg_cron job daily_slot_release scheduled for 00:00 IST (18:30 UTC).';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- admin_create_product, extended with the daily release limit.
--
-- A limit of 0 or null means "no staggering": the trigger then releases every
-- slot immediately, which is exactly what the console did before.
-- -----------------------------------------------------------------------------
drop function if exists public.admin_create_product(text, text, text, text, int, numeric, text, text, text);

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
  p_daily_release_limit int default null
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
    product_link, campaign, asin_code, daily_release_limit
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
    v_limit
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

-- -----------------------------------------------------------------------------
-- admin_update_product, extended the same way.
--
-- null leaves the limit alone (so an unrelated edit, or the close/reopen action,
-- cannot clear it by accident), 0 removes it, any other number sets it.
-- Lowering total_slots clamps released_slots, because released_slots is never
-- allowed to exceed it. Changing the limit never rewinds released_slots: slots
-- that are already open cannot be un-opened.
-- -----------------------------------------------------------------------------
drop function if exists public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text);

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
  p_daily_release_limit int default null
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
         end
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
        'released_slots', v_before.released_slots,
        'daily_release_limit', v_before.daily_release_limit,
        'cashback_amount', v_before.cashback_amount, 'status', v_before.status,
        'product_link', v_before.product_link, 'campaign', v_before.campaign,
        'asin_code', v_before.asin_code
      ),
      'after', jsonb_build_object(
        'name', v_product.name, 'brand', v_product.brand, 'total_slots', v_product.total_slots,
        'released_slots', v_product.released_slots,
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

-- The drops above took the old grants with them, so they are re-issued here. The
-- functions self-check with assert_admin() as well.
revoke all on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text, int) from public;
revoke all on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text, int) from public;
revoke execute on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text, int) from anon;
revoke execute on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text, int) from anon;
grant execute on function public.admin_create_product(text, text, text, text, int, numeric, text, text, text, int) to authenticated;
grant execute on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text, text, text, text, int) to authenticated;