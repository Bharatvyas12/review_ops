-- =============================================================================
-- 0007  Withdraw a claim.
--
-- Lets a reviewer back out of a claim they have not acted on yet, and gives the
-- slot straight back to the pool. Nothing in 0001-0006 is edited: this adds one
-- function.
--
--   * withdraw_order_claim(order id)  - release the slot + drop the claim + audit
--
-- Why a delete rather than a new status: a withdrawn claim never reached the
-- team, so there is nothing for anybody to see afterwards. The
-- orders_one_active_per_product index only covers rows that still exist, so
-- deleting frees the reviewer to claim the same product again, which is exactly
-- what "give the slot back" should mean.
--
-- Only a claim that is still 'claimed' can be withdrawn. Once the order
-- screenshot has been submitted an admin is already acting on it, and the row
-- must stay put for them - the same rule the update guard in 0006 enforces.
-- =============================================================================

create or replace function public.withdraw_order_claim(p_order_id uuid)
returns table (
  order_id uuid,
  product_id uuid,
  slots_filled int,
  total_slots int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_product_id uuid;
  v_order public.orders;
  v_product public.products;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501', hint = 'auth_required';
  end if;

  -- Ownership is asserted in the lookup itself, so guessing somebody else's
  -- order id fails here rather than relying on RLS to hide the row.
  select o.product_id into v_product_id
    from public.orders o
   where o.id = p_order_id and o.user_id = v_user;

  if not found then
    raise exception 'order not found' using errcode = 'P0002', hint = 'order_not_found';
  end if;

  -- Lock order matters: the claim path takes the product row and then inserts
  -- the order, so this takes products first and the order second. Two
  -- overlapping withdraws therefore queue on the product lock instead of
  -- deadlocking on each other.
  select * into v_product
    from public.products p
   where p.id = v_product_id
   for update;

  if not found then
    raise exception 'that product no longer exists' using errcode = 'P0002', hint = 'product_not_found';
  end if;

  select * into v_order
    from public.orders o
   where o.id = p_order_id and o.user_id = v_user
   for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002', hint = 'order_not_found';
  end if;

  -- Re-checked while holding the lock: the reviewer may have submitted the
  -- screenshot a moment ago, in which case the row has to stay for the admin.
  if v_order.status <> 'claimed' then
    raise exception 'this claim has already been submitted and can no longer be withdrawn'
      using errcode = 'P0001', hint = 'order_locked';
  end if;

  -- greatest() is a belt-and-braces guard: the products_slots_bounds CHECK
  -- constraint would refuse a negative count, but a clamp here means a
  -- double-submit can never turn into an error the user has to read.
  -- Every column here is qualified: `slots_filled` is also a RETURNS TABLE
  -- output name, and an unqualified reference is ambiguous to the planner.
  update public.products p
     set slots_filled = greatest(p.slots_filled - 1, 0)
   where p.id = v_product_id
   returning * into v_product;

  -- Defensive: a claim in this state should not have notifications pointing at
  -- it, but notifications.related_order_id has no ON DELETE rule, so clear any
  -- that exist rather than letting the foreign key block the withdrawal.
  delete from public.notifications n where n.related_order_id = p_order_id;

  delete from public.orders o where o.id = p_order_id;

  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_user,
    'withdraw_claim',
    'orders',
    p_order_id,
    jsonb_build_object(
      'actor_role', 'user',
      'product_id', v_product_id,
      'previous_status', v_order.status,
      'slots_filled_after', v_product.slots_filled,
      'total_slots', v_product.total_slots,
      'extracted_order_id', v_order.extracted_order_id,
      'had_screenshot', v_order.order_screenshot_url is not null
    )
  );

  return query select p_order_id, v_product_id, v_product.slots_filled, v_product.total_slots;
end;
$$;

comment on function public.withdraw_order_claim(uuid) is
  'Owner-only: releases a still-unsubmitted claim, returns the slot to the pool and audits the change.';

revoke all on function public.withdraw_order_claim(uuid) from public;
revoke execute on function public.withdraw_order_claim(uuid) from anon, authenticated;
grant execute on function public.withdraw_order_claim(uuid) to authenticated;
