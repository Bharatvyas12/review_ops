-- =============================================================================
-- 0009  The order-approval stage is gone.
--
-- Submitting a confirmed order proof now moves the order straight to
-- review_pending. Nobody has to verify the purchase screenshot first; it is
-- still collected and stored on the order for the record.
--
-- What this changes
--   * submit_order_proof()  - writes review_pending instead of order_submitted
--   * enforce_order_update_guard() - allowed transitions follow
--
-- What this deliberately does NOT change
--   * The orders.status CHECK still lists order_confirmed. Dropping a value from
--     a live check constraint is a breaking migration, so the value stays legal
--     for rows that already carry it - it is simply never written again.
--   * admin_transition_order() is untouched: the review queue still uses it to
--     move review_submitted -> approved/rejected.
--   * order_confirmed_at and its trigger stay, for the same reason.
--
-- Nothing in 0001-0008 is edited; the two functions below are replaced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Existing rows sitting in the retired stage.
--
-- order_submitted can no longer be reached or advanced from the app, so without
-- this a reviewer whose screenshot was already in would be stuck with no way
-- forward. They did what was asked of them, so they move to the review step.
-- Idempotent, and a no-op once no rows carry the old status.
-- -----------------------------------------------------------------------------
update public.orders
   set status = 'review_pending'
 where status = 'order_submitted';

-- -----------------------------------------------------------------------------
-- enforce_order_update_guard, with the approval step removed.
--
-- The only intended differences from the 0006 version:
--   * claimed -> review_pending is now the legal transition (was
--     claimed -> order_submitted);
--   * claimed -> order_submitted is no longer offered, so nothing can put a row
--     back into the retired stage;
--   * order_submitted -> review_pending is kept as a one-way escape hatch, so a
--     row that somehow lands in the retired stage is never permanently stuck.
-- Everything else, including which fields are admin-only and when proof becomes
-- immutable, is unchanged.
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

  -- Admin-only for the whole lifetime of the row.
  if new.order_confirmed_at is distinct from old.order_confirmed_at
     or new.review_submitted_at is distinct from old.review_submitted_at
     or new.approved_at is distinct from old.approved_at
     or new.paid_at is distinct from old.paid_at
     or new.payment_reference is distinct from old.payment_reference
     or new.rejection_reason is distinct from old.rejection_reason
  then
    raise exception 'only admins may modify administrative order fields' using errcode = '42501';
  end if;

  -- Owner-editable only while the claim is still unsubmitted.
  if old.status <> 'claimed' and (
       new.extracted_name is distinct from old.extracted_name
    or new.extracted_order_id is distinct from old.extracted_order_id
    or new.extracted_phone is distinct from old.extracted_phone
    or new.extracted_product_name is distinct from old.extracted_product_name
    or new.order_screenshot_url is distinct from old.order_screenshot_url
  ) then
    raise exception 'order proof is locked once the order has been submitted'
      using errcode = '42501';
  end if;

  -- Review proof is editable only while the review is still owed. order_confirmed
  -- stays in this list because existing rows still carry it.
  if old.status not in ('order_confirmed', 'review_pending') and (
       new.review_screenshot_url is distinct from old.review_screenshot_url
    or new.review_link is distinct from old.review_link
  ) then
    raise exception 'review proof is locked once the review has been submitted'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'claimed' and new.status = 'review_pending')
      or (old.status = 'order_submitted' and new.status = 'review_pending')
      or (old.status = 'order_confirmed' and new.status = 'review_submitted')
      or (old.status = 'review_pending' and new.status = 'review_submitted')
    ) then
      raise exception 'illegal order status transition: % -> %', old.status, new.status
        using errcode = '42501';
    end if;

    -- Submitting the order proof is only meaningful once the user has confirmed
    -- what the extraction read.
    if old.status = 'claimed' and new.status = 'review_pending' and new.user_confirmed is not true then
      raise exception 'confirm the order details before submitting' using errcode = '42501';
    end if;

    -- A review submission needs at least one form of proof.
    if old.status in ('order_confirmed', 'review_pending')
       and new.status = 'review_submitted'
       and coalesce(new.review_screenshot_url, new.review_link) is null
    then
      raise exception 'attach a review screenshot or paste the review link'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- submit_order_proof, now landing in review_pending.
--
-- The screenshot is still recorded on the order - it is kept as the record of
-- what was bought - it just no longer gates anything. Everything else about this
-- function (ownership, verified phone, path prefix, field validation) is
-- unchanged from 0006.
-- -----------------------------------------------------------------------------
create or replace function public.submit_order_proof(
  p_order_id uuid,
  p_screenshot_path text,
  p_name text default null,
  p_order_ref text default null,
  p_phone text default null,
  p_product_name text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.assert_verified_user();
  v_order public.orders;
  v_path text := btrim(coalesce(p_screenshot_path, ''));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_ref text := nullif(btrim(coalesce(p_order_ref, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_product text := nullif(btrim(coalesce(p_product_name, '')), '');
begin
  select * into v_order
    from public.orders
   where id = p_order_id and user_id = v_user
   for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002', hint = 'order_not_found';
  end if;

  if v_order.status <> 'claimed' then
    raise exception 'this order has already been submitted'
      using errcode = 'P0001', hint = 'order_locked';
  end if;

  if length(v_path) = 0 or v_path not like v_user::text || '/%' then
    raise exception 'invalid screenshot path' using errcode = '42501', hint = 'invalid_path';
  end if;

  if v_ref is null or length(v_ref) < 3 then
    raise exception 'the order id from the screenshot is required'
      using errcode = 'P0001', hint = 'order_ref_required';
  end if;

  if length(v_path) > 1024
     or (v_name is not null and length(v_name) > 200)
     or length(v_ref) > 200
     or (v_phone is not null and (length(v_phone) > 40 or v_phone !~ '^[0-9+][0-9+ -]{4,39}$'))
     or (v_product is not null and length(v_product) > 300)
  then
    raise exception 'one of the submitted fields is not valid'
      using errcode = 'P0001', hint = 'invalid_field';
  end if;

  update public.orders
     set order_screenshot_url = v_path,
         extracted_name = v_name,
         extracted_order_id = v_ref,
         extracted_phone = v_phone,
         extracted_product_name = v_product,
         user_confirmed = true,
         status = 'review_pending'
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.submit_order_proof(uuid, text, text, text, text, text) from public;
revoke execute on function public.submit_order_proof(uuid, text, text, text, text, text) from anon;
grant execute on function public.submit_order_proof(uuid, text, text, text, text, text) to authenticated;