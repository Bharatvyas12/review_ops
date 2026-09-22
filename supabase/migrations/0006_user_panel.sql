-- =============================================================================
-- 0006  User panel support.
--
-- Adds only what the user-facing panel needs. Nothing in 0001-0005 is edited:
-- the one existing function that had to change (the orders guard) is replaced
-- with `create or replace`, which is the migration-safe way to do it.
--
-- New objects
--   * public.phone_verifications  - hashed OTP codes, unreachable by any client
--   * public.rate_limits          - persistent rate limiting (replaces the
--                                   per-isolate in-memory window in production)
--   * consume_rate_limit()        - atomic fixed-window counter
--   * verify_phone_code()         - atomic OTP check + consume + flip the flag
--   * claim_product_for_user()    - verified-only claim, reuses claim_product_slot
--   * submit_order_proof()        - ownership + verified checks, then submit
--   * submit_review_proof()       - same, for the review stage
--   * user_save_bank_details()    - encrypt-at-rest write + audit row as the user
--   * realtime publication entries for products / orders / notifications
-- =============================================================================

-- -----------------------------------------------------------------------------
-- OTP codes.
--
-- RLS is enabled with NO policies and no grants to anon/authenticated, so a
-- client session cannot read, insert or brute-force this table even with the
-- anon key. Only service_role (server-side routes) can touch it, and even then
-- only a SHA-256 hash of the code is stored - never the code itself.
-- -----------------------------------------------------------------------------
create table if not exists public.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    constraint phone_verifications_user_id_fkey references public.profiles(id) on delete cascade,
  phone text not null,
  code_hash text not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists phone_verifications_user_idx
  on public.phone_verifications (user_id, created_at desc);
create index if not exists phone_verifications_live_idx
  on public.phone_verifications (user_id)
  where consumed_at is null;

alter table public.phone_verifications enable row level security;

revoke all on public.phone_verifications from anon, authenticated;
grant all on public.phone_verifications to service_role;

comment on table public.phone_verifications is
  'One-time phone codes. Stores a hash only; no client role can read this table.';

-- -----------------------------------------------------------------------------
-- Persistent rate limiting.
--
-- Phase 1 fell back to a per-isolate in-memory window when Upstash was not
-- configured, which does not hold across Cloudflare isolates. This table makes
-- the limiter durable with no extra vendor, and the function is atomic so
-- concurrent requests cannot both slip past the last allowed attempt.
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key text primary key,
  count int not null default 0,
  window_started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists rate_limits_expires_idx on public.rate_limits (expires_at);

alter table public.rate_limits enable row level security;

revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit int,
  p_window_ms int
)
returns table (allowed boolean, remaining int, retry_after_seconds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.rate_limits;
  v_seconds double precision := greatest(p_window_ms, 1)::double precision / 1000.0;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 400 then
    raise exception 'invalid rate limit key' using errcode = 'P0001';
  end if;
  if p_limit < 1 or p_window_ms < 1 then
    raise exception 'invalid rate limit arguments' using errcode = 'P0001';
  end if;

  -- Single statement: the row lock serialises concurrent callers.
  insert into public.rate_limits as rl (key, count, window_started_at, expires_at)
  values (p_key, 1, v_now, v_now + make_interval(secs => v_seconds))
  on conflict (key) do update
    set count = case when rl.expires_at <= v_now then 1 else rl.count + 1 end,
        window_started_at = case when rl.expires_at <= v_now then v_now else rl.window_started_at end,
        expires_at = case
          when rl.expires_at <= v_now then v_now + make_interval(secs => v_seconds)
          else rl.expires_at
        end
  returning * into v_row;

  allowed := v_row.count <= p_limit;
  remaining := greatest(0, p_limit - v_row.count);
  retry_after_seconds := case
    when v_row.count <= p_limit then 0
    else greatest(1, ceil(extract(epoch from (v_row.expires_at - v_now))))::int
  end;
  return next;
end;
$$;

comment on function public.consume_rate_limit(text, int, int) is
  'Atomic fixed-window counter used by the app rate limiter. service_role only.';

revoke all on function public.consume_rate_limit(text, int, int) from public;
-- Supabase grants EXECUTE on a new function to anon/authenticated by default, so
-- revoke ... from public alone is NOT enough. Without this line any anonymous
-- caller holding the anon key could reach a SECURITY DEFINER function that has no
-- admin check of its own.
revoke execute on function public.consume_rate_limit(text, int, int) from anon, authenticated;
grant execute on function public.consume_rate_limit(text, int, int) to service_role;

-- -----------------------------------------------------------------------------
-- Realtime: the live slot counter and the live order tracker subscribe to these
-- tables from the browser with the anon key, so every message is still filtered
-- by the RLS policies in 0002. Guarded so re-running the migration is a no-op.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['products', 'orders', 'notifications'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Orders guard, extended for the user panel.
--
-- Phase 1 blocked a non-admin from touching the extracted_* columns at all.
-- The user confirm screen is exactly where those values get corrected, so the
-- owner may now write them - but only while the order is still an unsubmitted
-- 'claimed' row. Everything genuinely administrative stays admin-only, and the
-- proof columns freeze once the matching stage has been submitted.
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

  -- Review proof is editable only while the review is still owed.
  if old.status not in ('order_confirmed', 'review_pending') and (
       new.review_screenshot_url is distinct from old.review_screenshot_url
    or new.review_link is distinct from old.review_link
  ) then
    raise exception 'review proof is locked once the review has been submitted'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'claimed' and new.status = 'order_submitted')
      or (old.status = 'order_confirmed' and new.status = 'review_submitted')
      or (old.status = 'review_pending' and new.status = 'review_submitted')
    ) then
      raise exception 'illegal order status transition: % -> %', old.status, new.status
        using errcode = '42501';
    end if;

    -- Submitting an order proof is only meaningful once the user has confirmed
    -- what the extraction read.
    if old.status = 'claimed' and new.status = 'order_submitted' and new.user_confirmed is not true then
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
-- assert_verified_user: the user-panel counterpart of assert_admin().
--
-- Requirement: an unverified phone must not be able to claim or submit. This is
-- enforced here in the database, not merely by hiding a button, so a crafted
-- RPC call from a client is rejected too.
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
  if not exists (select 1 from public.profiles p where p.id = v_user and p.phone_verified) then
    raise exception 'verify your phone number to continue'
      using errcode = '42501', hint = 'phone_unverified';
  end if;
  return v_user;
end;
$$;

comment on function public.assert_verified_user() is
  'Returns auth.uid() for a signed-in user whose phone is verified, else raises.';

-- -----------------------------------------------------------------------------
-- verify_phone_code: consume an OTP atomically.
--
-- Returns a status word rather than raising, so the route can answer precisely
-- without leaking whether a code existed. Attempt accounting, expiry and the
-- single-use mark all happen under one row lock, so a burst of guesses cannot
-- race past max_attempts.
--
-- SECURITY DEFINER + service_role only: it flips profiles.phone_verified, which
-- the profiles guard trigger forbids for any client session.
-- -----------------------------------------------------------------------------
create or replace function public.verify_phone_code(p_user_id uuid, p_code_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.phone_verifications;
  v_phone text;
begin
  if p_user_id is null or p_code_hash is null or length(p_code_hash) = 0 then
    return 'invalid';
  end if;

  select p.phone into v_phone from public.profiles p where p.id = p_user_id;
  if v_phone is null or length(btrim(v_phone)) = 0 then
    return 'no_phone';
  end if;

  select * into v_row
    from public.phone_verifications
   where user_id = p_user_id and consumed_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then
    return 'missing';
  end if;

  if v_row.expires_at <= now() then
    update public.phone_verifications set consumed_at = now() where id = v_row.id;
    return 'expired';
  end if;

  if v_row.attempts >= v_row.max_attempts then
    update public.phone_verifications set consumed_at = now() where id = v_row.id;
    return 'too_many_attempts';
  end if;

  update public.phone_verifications set attempts = attempts + 1 where id = v_row.id;

  -- The code must also belong to the number currently on the profile, so an OTP
  -- issued before a phone change cannot be replayed afterwards.
  if v_row.phone is distinct from v_phone or v_row.code_hash <> p_code_hash then
    return 'invalid';
  end if;

  update public.phone_verifications set consumed_at = now() where id = v_row.id;
  update public.profiles set phone_verified = true where id = p_user_id;
  return 'verified';
end;
$$;

revoke all on function public.verify_phone_code(uuid, text) from public;
-- Supabase grants EXECUTE on a new function to anon/authenticated by default, so
-- revoke ... from public alone is NOT enough. Without this line any anonymous
-- caller holding the anon key could reach a SECURITY DEFINER function that has no
-- admin check of its own.
revoke execute on function public.verify_phone_code(uuid, text) from anon, authenticated;
grant execute on function public.verify_phone_code(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- claim_product_for_user: atomically consume a slot AND create the order.
--
-- Reuses the Phase 1 claim_product_slot() so there is exactly one atomic claim
-- implementation. Both statements run in one transaction: if the order insert
-- fails (for example the user already holds an active claim on this product),
-- the slot increment is rolled back with it.
--
-- Returns NULL when the slot could not be taken (sold out, closed or unknown).
-- -----------------------------------------------------------------------------
create or replace function public.claim_product_for_user(p_product_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.assert_verified_user();
  v_claimed boolean;
  v_order public.orders;
begin
  v_claimed := public.claim_product_slot(p_product_id);
  if not v_claimed then
    return null;
  end if;

  begin
    insert into public.orders (user_id, product_id, status)
    values (v_user, p_product_id, 'claimed')
    returning * into v_order;
  exception
    when unique_violation then
      raise exception 'you already hold an active claim on this product'
        using errcode = 'P0001', hint = 'duplicate_claim';
    when foreign_key_violation then
      raise exception 'that product does not exist'
        using errcode = 'P0002', hint = 'product_not_found';
  end;

  return v_order;
end;
$$;

revoke all on function public.claim_product_for_user(uuid) from public;
revoke execute on function public.claim_product_for_user(uuid) from anon;
grant execute on function public.claim_product_for_user(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- submit_order_proof
--
-- Ownership, verification state, review state and the storage path are all
-- re-checked here. The path must sit inside the caller's own storage folder, so
-- a user cannot point their order at somebody else's screenshot. The extracted
-- values arrive from the confirm screen - the user's correction is authoritative.
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
         status = 'order_submitted'
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.submit_order_proof(uuid, text, text, text, text, text) from public;
revoke execute on function public.submit_order_proof(uuid, text, text, text, text, text) from anon;
grant execute on function public.submit_order_proof(uuid, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- submit_review_proof
--
-- At least one of screenshot / live review link is required, exactly as the
-- spec asks. review_submitted_at is filled by the existing timestamp trigger,
-- not by the caller.
-- -----------------------------------------------------------------------------
create or replace function public.submit_review_proof(
  p_order_id uuid,
  p_screenshot_path text default null,
  p_review_link text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.assert_verified_user();
  v_order public.orders;
  v_path text := nullif(btrim(coalesce(p_screenshot_path, '')), '');
  v_link text := nullif(btrim(coalesce(p_review_link, '')), '');
begin
  select * into v_order
    from public.orders
   where id = p_order_id and user_id = v_user
   for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002', hint = 'order_not_found';
  end if;

  if v_order.status not in ('order_confirmed', 'review_pending') then
    raise exception 'this order is not waiting for a review'
      using errcode = 'P0001', hint = 'order_locked';
  end if;

  if v_path is null and v_link is null then
    raise exception 'attach a review screenshot or paste the review link'
      using errcode = 'P0001', hint = 'proof_required';
  end if;

  if v_path is not null and (length(v_path) > 1024 or v_path not like v_user::text || '/%') then
    raise exception 'invalid screenshot path' using errcode = '42501', hint = 'invalid_path';
  end if;

  if v_link is not null and (length(v_link) > 1024 or v_link !~* '^https?://[^[:space:]]+$') then
    raise exception 'the review link must be a full http(s) url'
      using errcode = 'P0001', hint = 'invalid_link';
  end if;

  update public.orders
     set review_screenshot_url = v_path,
         review_link = v_link,
         status = 'review_submitted'
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.submit_review_proof(uuid, text, text) from public;
revoke execute on function public.submit_review_proof(uuid, text, text) from anon;
grant execute on function public.submit_review_proof(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- user_save_bank_details
--
-- Encryption itself happens in the app layer (src/lib/crypto.ts) - there is no
-- second crypto implementation here. This function only stores the ciphertext,
-- records the change against the *user* in audit_log, and returns the masked
-- projection.
--
-- The return type is deliberately a narrow table rather than public.bank_details:
-- returning the row type would echo account_number_encrypted back through
-- PostgREST, which the spec forbids.
--
-- Blank fields keep their stored value, so a user can update their holder name
-- or UPI without re-typing the account number.
-- -----------------------------------------------------------------------------
create or replace function public.user_save_bank_details(
  p_account_holder_name text default null,
  p_account_number_encrypted text default null,
  p_account_number_last4 text default null,
  p_ifsc_code text default null,
  p_upi_id text default null
)
returns table (
  user_id uuid,
  account_holder_name text,
  account_number_last4 text,
  ifsc_code text,
  upi_id text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_prev public.bank_details;
  v_existed boolean;
  v_holder text;
  v_req_enc text;
  v_req_last4 text;
  v_ifsc text;
  v_upi text;
  v_enc text;
  v_last4 text;
  v_changed boolean;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501', hint = 'auth_required';
  end if;

  -- Qualified deliberately: the RETURNS TABLE output column is also called
  -- user_id, and an unqualified reference is ambiguous to the planner.
  select * into v_prev from public.bank_details b where b.user_id = v_user;
  v_existed := found;

  v_holder := nullif(btrim(coalesce(p_account_holder_name, '')), '');
  v_req_enc := nullif(btrim(coalesce(p_account_number_encrypted, '')), '');
  v_req_last4 := nullif(btrim(coalesce(p_account_number_last4, '')), '');
  v_ifsc := upper(nullif(btrim(coalesce(p_ifsc_code, '')), ''));
  v_upi := nullif(btrim(coalesce(p_upi_id, '')), '');

  -- Resolve "blank means keep what is stored".
  v_enc := coalesce(v_req_enc, v_prev.account_number_encrypted);
  v_last4 := coalesce(v_req_last4, v_prev.account_number_last4);
  v_ifsc := coalesce(v_ifsc, v_prev.ifsc_code);
  v_upi := coalesce(v_upi, v_prev.upi_id);
  v_holder := coalesce(v_holder, v_prev.account_holder_name);

  if v_enc is null and v_upi is null then
    raise exception 'provide a bank account or a UPI id'
      using errcode = 'P0001', hint = 'payout_required';
  end if;

  if v_req_enc is not null then
    if v_req_last4 is null or v_req_last4 !~ '^[0-9]{4}$' then
      raise exception 'the last four digits of the account number are required'
        using errcode = 'P0001', hint = 'invalid_last4';
    end if;
    if length(v_req_enc) > 2048 or v_req_enc !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
      raise exception 'the account number was not encrypted correctly'
        using errcode = 'P0001', hint = 'invalid_ciphertext';
    end if;
  end if;

  if v_enc is not null and v_ifsc is not null and v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'enter a valid IFSC code' using errcode = 'P0001', hint = 'invalid_ifsc';
  end if;

  if v_req_enc is not null and (v_ifsc is null or v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$') then
    raise exception 'an IFSC code is required with a bank account number'
      using errcode = 'P0001', hint = 'invalid_ifsc';
  end if;

  if v_upi is not null
     and (length(v_upi) > 256 or v_upi !~ '^[A-Za-z0-9._+-]{2,64}@[A-Za-z][A-Za-z0-9]{1,63}$')
  then
    raise exception 'enter a valid UPI id' using errcode = 'P0001', hint = 'invalid_upi';
  end if;

  if v_holder is not null and length(v_holder) > 120 then
    raise exception 'the account holder name is too long'
      using errcode = 'P0001', hint = 'invalid_field';
  end if;

  v_changed := v_req_enc is not null
    and (not v_existed or v_req_enc is distinct from v_prev.account_number_encrypted);

  insert into public.bank_details (
    user_id, account_holder_name, account_number_encrypted, account_number_last4, ifsc_code, upi_id
  )
  values (v_user, v_holder, v_enc, v_last4, v_ifsc, v_upi)
  -- Named rather than inferred: the RETURNS TABLE column is also user_id, so a
  -- bare `on conflict (user_id)` is ambiguous inside plpgsql.
  on conflict on constraint bank_details_pkey do update
    set account_holder_name = excluded.account_holder_name,
        account_number_encrypted = excluded.account_number_encrypted,
        account_number_last4 = excluded.account_number_last4,
        ifsc_code = excluded.ifsc_code,
        upi_id = excluded.upi_id,
        updated_at = now();

  -- Who changed their payout details, and when. Never the account number.
  insert into public.audit_log (admin_id, action, target_table, target_id, details)
  values (
    v_user,
    case when v_existed then 'update_bank_details' else 'create_bank_details' end,
    'bank_details',
    v_user,
    jsonb_build_object(
      'actor_role', 'user',
      'account_number_changed', v_changed,
      'account_number_last4', v_last4,
      'ifsc_code', v_ifsc,
      'upi_id', v_upi,
      'holder_name', v_holder
    )
  );

  return query
    select b.user_id, b.account_holder_name, b.account_number_last4, b.ifsc_code, b.upi_id, b.updated_at
      from public.bank_details b
     where b.user_id = v_user;
end;
$$;

revoke all on function public.user_save_bank_details(text, text, text, text, text) from public;
revoke execute on function public.user_save_bank_details(text, text, text, text, text) from anon;
grant execute on function public.user_save_bank_details(text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Execution rights for the user-facing helpers.
-- -----------------------------------------------------------------------------
revoke all on function public.assert_verified_user() from public;
revoke execute on function public.assert_verified_user() from anon;
grant execute on function public.assert_verified_user() to authenticated, service_role;
