-- =============================================================================
-- 0003  Business logic that must be atomic.
--
-- Anything that changes state AND writes an audit row lives in a single
-- SECURITY DEFINER function so the two can never drift apart (one transaction,
-- one rollback). Every admin function re-checks profiles.role on the server.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- assert_admin: used by the API layer AND by every admin_* function below.
-- -----------------------------------------------------------------------------
create or replace function public.assert_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_admin(v_admin) then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  return v_admin;
end;
$$;

-- -----------------------------------------------------------------------------
-- claim_product_slot
--
-- Atomic by construction: a single UPDATE ... WHERE slots_filled < total_slots.
-- Postgres takes a row lock, so concurrent callers are serialised and exactly
-- one of them can consume the last slot. The products_slots_bounds CHECK
-- constraint is the backstop if this is ever rewritten.
--
-- The spec's stub used `select found;` in a `language sql` body, which does not
-- compile (FOUND is a plpgsql variable and a `language sql` function cannot run
-- DML + read FOUND). This is the row-count adaptation.
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
     and slots_filled < total_slots;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

comment on function public.claim_product_slot(uuid) is
  'Atomically consumes one product slot. Returns false when sold out, closed or unknown.';

-- -----------------------------------------------------------------------------
-- Guard: a non-admin can never change privileged order columns or invent a
-- status transition. Runs before the timestamp trigger.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_order_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No JWT in the request context means service_role / server-side code.
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'orders.user_id is immutable' using errcode = '42501';
  end if;
  if new.product_id is distinct from old.product_id then
    raise exception 'orders.product_id is immutable' using errcode = '42501';
  end if;

  if new.order_confirmed_at is distinct from old.order_confirmed_at
     or new.review_submitted_at is distinct from old.review_submitted_at
     or new.approved_at is distinct from old.approved_at
     or new.paid_at is distinct from old.paid_at
     or new.payment_reference is distinct from old.payment_reference
     or new.rejection_reason is distinct from old.rejection_reason
     or new.extracted_name is distinct from old.extracted_name
     or new.extracted_order_id is distinct from old.extracted_order_id
     or new.extracted_phone is distinct from old.extracted_phone
     or new.extracted_product_name is distinct from old.extracted_product_name
  then
    raise exception 'only admins may modify administrative order fields' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'claimed' and new.status = 'order_submitted')
      or (old.status = 'order_confirmed' and new.status = 'review_submitted')
    ) then
      raise exception 'illegal order status transition: % -> %', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_guard_before_update on public.orders;
create trigger orders_guard_before_update
  before update on public.orders
  for each row execute function public.enforce_order_update_guard();

-- -----------------------------------------------------------------------------
-- Guard: privilege escalation on profiles.
-- -----------------------------------------------------------------------------
create or replace function public.prevent_profile_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'user';
    new.phone_verified := false;
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'only admins may change profiles.role' using errcode = '42501';
  end if;
  if new.phone_verified is distinct from old.phone_verified then
    raise exception 'phone_verified is managed by the server' using errcode = '42501';
  end if;

  new.id := old.id;
  return new;
end;
$$;

drop trigger if exists profiles_guard_before_write on public.profiles;
create trigger profiles_guard_before_write
  before insert or update on public.profiles
  for each row execute function public.prevent_profile_escalation();

-- -----------------------------------------------------------------------------
-- Status timestamps are derived from the status change, never trusted from the
-- client. Name sorts after the guard so the guard sees the requested values.
-- -----------------------------------------------------------------------------
create or replace function public.set_order_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'order_confirmed' then
      new.order_confirmed_at := now();
    elsif new.status = 'review_submitted' then
      new.review_submitted_at := now();
    elsif new.status = 'approved' then
      new.approved_at := now();
    elsif new.status = 'paid' then
      new.paid_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_timestamps_before_update on public.orders;
create trigger orders_timestamps_before_update
  before update on public.orders
  for each row execute function public.set_order_status_timestamps();

-- =============================================================================
-- Admin mutations. Status change + audit_log + notification in one transaction.
-- =============================================================================

create or replace function public.admin_transition_order(
  p_order_id uuid,
  p_new_status text,
  p_action text,
  p_reason text default null,
  p_details jsonb default '{}'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.assert_admin();
  v_order public.orders;
  v_previous_status text;
  v_product_name text;
  v_message text;
  v_type text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  v_previous_status := v_order.status;

  if not (
    (v_previous_status = 'order_submitted' and p_new_status in ('order_confirmed', 'rejected'))
    or (v_previous_status = 'review_submitted' and p_new_status in ('approved', 'rejected'))
  ) then
    raise exception 'illegal admin transition: % -> %', v_previous_status, p_new_status
      using errcode = 'P0001';
  end if;

  if p_new_status = 'rejected' and length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'rejection_reason is required' using errcode = 'P0001';
  end if;

  select p.name into v_product_name from public.products p where p.id = v_order.product_id;

  update public.orders
     set status = p_new_status,
         rejection_reason = case when p_new_status = 'rejected' then btrim(p_reason) else null end
   where id = p_order_id
   returning * into v_order;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    p_action,
    'orders',
    p_order_id,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
      'from_status', v_previous_status,
      'to_status', p_new_status,
      'rejection_reason', case when p_new_status = 'rejected' then btrim(p_reason) else null end
    )
  );

  v_type := case
    when p_new_status = 'order_confirmed' then 'order_confirmed'
    when p_new_status = 'approved' then 'review_approved'
    else 'order_rejected'
  end;

  v_message := case
    when p_new_status = 'order_confirmed' then
      format('Your order for %s was confirmed. Submit your review to get paid.', coalesce(v_product_name, 'your product'))
    when p_new_status = 'approved' then
      format('Your review for %s was approved. Payment is being processed.', coalesce(v_product_name, 'your product'))
    else
      format('Your submission for %s was rejected: %s', coalesce(v_product_name, 'your product'), btrim(p_reason))
  end;

  insert into public.notifications (user_id, type, message, related_order_id)
  values (v_order.user_id, v_type, v_message, v_order.id);

  return v_order;
end;
$$;

create or replace function public.admin_mark_paid(
  p_order_id uuid,
  p_payment_reference text,
  p_details jsonb default '{}'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.assert_admin();
  v_order public.orders;
  v_product_name text;
  v_reference text := btrim(coalesce(p_payment_reference, ''));
begin
  if length(v_reference) = 0 then
    raise exception 'payment_reference is required' using errcode = 'P0001';
  end if;
  if length(v_reference) > 120 then
    raise exception 'payment_reference is too long' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status <> 'approved' then
    raise exception 'only approved orders can be marked paid (current: %)', v_order.status
      using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'paid', payment_reference = v_reference
   where id = p_order_id
   returning * into v_order;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    'mark_paid',
    'orders',
    p_order_id,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
      'payment_reference', v_reference,
      'from_status', 'approved',
      'to_status', 'paid'
    )
  );

  select p.name into v_product_name from public.products p where p.id = v_order.product_id;

  insert into public.notifications (user_id, type, message, related_order_id)
  values (
    v_order.user_id,
    'payment_sent',
    format('Payment sent for %s. Reference: %s', coalesce(v_product_name, 'your order'), v_reference),
    v_order.id
  );

  return v_order;
end;
$$;

create or replace function public.admin_create_product(
  p_name text,
  p_brand text default null,
  p_description text default null,
  p_image_url text default null,
  p_total_slots int default 1,
  p_cashback_amount numeric default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.assert_admin();
  v_product public.products;
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

  insert into public.products (name, brand, description, image_url, total_slots, cashback_amount, status, created_by)
  values (
    btrim(p_name),
    nullif(btrim(coalesce(p_brand, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_image_url, '')), ''),
    p_total_slots,
    p_cashback_amount,
    'open',
    v_admin
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
      'total_slots', v_product.total_slots,
      'cashback_amount', v_product.cashback_amount
    )
  );

  return v_product;
end;
$$;

create or replace function public.admin_update_product(
  p_product_id uuid,
  p_name text default null,
  p_brand text default null,
  p_description text default null,
  p_image_url text default null,
  p_total_slots int default null,
  p_cashback_amount numeric default null,
  p_status text default null
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

  update public.products
     set name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         brand = case when p_brand is null then brand else nullif(btrim(p_brand), '') end,
         description = case when p_description is null then description else nullif(btrim(p_description), '') end,
         image_url = case when p_image_url is null then image_url else nullif(btrim(p_image_url), '') end,
         total_slots = coalesce(p_total_slots, total_slots),
         cashback_amount = coalesce(p_cashback_amount, cashback_amount),
         status = coalesce(p_status, status)
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
        'cashback_amount', v_before.cashback_amount, 'status', v_before.status
      ),
      'after', jsonb_build_object(
        'name', v_product.name, 'brand', v_product.brand, 'total_slots', v_product.total_slots,
        'cashback_amount', v_product.cashback_amount, 'status', v_product.status
      )
    )
  );

  return v_product;
end;
$$;

create or replace function public.admin_log_bank_reveal(
  p_user_id uuid,
  p_order_id uuid default null,
  p_context text default 'payments_console'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.assert_admin();
  v_id uuid;
begin
  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_admin,
    'reveal_bank_account',
    'bank_details',
    p_user_id,
    jsonb_build_object('context', p_context, 'order_id', p_order_id)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Execution rights: admin functions are for signed-in users only (they
-- self-check the role) and never for the anonymous role.
-- -----------------------------------------------------------------------------
revoke all on function public.assert_admin() from public;
revoke all on function public.claim_product_slot(uuid) from public;
revoke all on function public.admin_transition_order(uuid, text, text, text, jsonb) from public;
revoke all on function public.admin_mark_paid(uuid, text, jsonb) from public;
revoke all on function public.admin_create_product(text, text, text, text, int, numeric) from public;
revoke all on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text) from public;
revoke all on function public.admin_log_bank_reveal(uuid, uuid, text) from public;

-- Supabase grants EXECUTE to anon by default, so revoke it explicitly. The
-- admin_* functions re-check the caller anyway (assert_admin); this just keeps
-- anonymous requests from reaching them at all.
revoke execute on function public.claim_product_slot(uuid) from anon;
revoke execute on function public.admin_transition_order(uuid, text, text, text, jsonb) from anon;
revoke execute on function public.admin_mark_paid(uuid, text, jsonb) from anon;
revoke execute on function public.admin_create_product(text, text, text, text, int, numeric) from anon;
revoke execute on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text) from anon;
revoke execute on function public.admin_log_bank_reveal(uuid, uuid, text) from anon;
revoke execute on function public.is_admin(uuid) from anon;

grant execute on function public.assert_admin() to authenticated, service_role;
grant execute on function public.claim_product_slot(uuid) to authenticated;
grant execute on function public.admin_transition_order(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.admin_mark_paid(uuid, text, jsonb) to authenticated;
grant execute on function public.admin_create_product(text, text, text, text, int, numeric) to authenticated;
grant execute on function public.admin_update_product(uuid, text, text, text, text, int, numeric, text) to authenticated;
grant execute on function public.admin_log_bank_reveal(uuid, uuid, text) to authenticated;
