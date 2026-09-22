-- =============================================================================
-- 0001  Schema for the review / order tracking platform.
-- Supports both the admin panel (this phase) and the user panel (next phase).
-- =============================================================================

-- gen_random_uuid() has been built into Postgres since 13, which is why the
-- defaults below work without an extension. pgcrypto is attempted only for
-- older servers, and a missing extension must not abort the migration.
do $$
begin
  create extension if not exists "pgcrypto";
exception when others then
  raise notice 'pgcrypto unavailable; using the built-in gen_random_uuid()';
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles  (extends auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text,
  phone_verified boolean not null default false,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for every auth.users row. role drives every admin RLS policy.';

-- -----------------------------------------------------------------------------
-- bank_details  (columns are write-only for regular users, see 0002)
-- -----------------------------------------------------------------------------
create table if not exists public.bank_details (
  user_id uuid primary key
    constraint bank_details_user_id_fkey references public.profiles(id) on delete cascade,
  account_holder_name text,
  -- AES-256-GCM ciphertext produced by src/lib/crypto.ts. Never decrypt client-side.
  account_number_encrypted text,
  account_number_last4 text check (account_number_last4 is null or account_number_last4 ~ '^[0-9]{4}$'),
  ifsc_code text,
  upi_id text,
  updated_at timestamptz not null default now()
);

comment on column public.bank_details.account_number_encrypted is
  'Application-layer AES-256-GCM ciphertext, format v1.<iv>.<ciphertext> (base64url). Readable only by service_role.';

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  brand text,
  description text,
  -- Storage object path inside the private product-images bucket, or an absolute URL.
  image_url text,
  total_slots int not null check (total_slots > 0),
  slots_filled int not null default 0,
  cashback_amount numeric(12,2) check (cashback_amount is null or cashback_amount >= 0),
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid
    constraint products_created_by_fkey references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Hard guarantee that concurrent claims can never oversell a product.
  constraint products_slots_bounds check (slots_filled >= 0 and slots_filled <= total_slots)
);

create index if not exists products_status_idx on public.products (status);
create index if not exists products_created_at_idx on public.products (created_at desc);

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    constraint orders_user_id_fkey references public.profiles(id) on delete cascade,
  product_id uuid not null
    constraint orders_product_id_fkey references public.products(id) on delete restrict,
  status text not null default 'claimed' check (status in (
    'claimed','order_submitted','order_confirmed','review_pending',
    'review_submitted','approved','paid','rejected'
  )),

  order_screenshot_url text,
  extracted_name text,
  extracted_order_id text,
  extracted_phone text,
  extracted_product_name text,
  user_confirmed boolean not null default false,
  order_confirmed_at timestamptz,

  review_screenshot_url text,
  review_link text,
  review_submitted_at timestamptz,
  approved_at timestamptz,

  payment_reference text,
  paid_at timestamptz,

  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_rejection_reason_required
    check (status <> 'rejected' or length(btrim(coalesce(rejection_reason, ''))) > 0),
  constraint orders_paid_requires_reference
    check (status <> 'paid' or length(btrim(coalesce(payment_reference, ''))) > 0)
);

create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_user_id_idx on public.orders (user_id, created_at desc);
create index if not exists orders_product_id_idx on public.orders (product_id);
create index if not exists orders_paid_at_idx on public.orders (paid_at desc);

-- One live order per user per product; a rejected order frees the user to retry.
create unique index if not exists orders_one_active_per_product
  on public.orders (user_id, product_id)
  where status <> 'rejected';

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    constraint notifications_user_id_fkey references public.profiles(id) on delete cascade,
  type text not null,
  message text not null check (length(btrim(message)) between 1 and 1000),
  related_order_id uuid
    constraint notifications_related_order_id_fkey references public.orders(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where is_read = false;

-- -----------------------------------------------------------------------------
-- audit_log  (append-only: no update/delete policy or grant exists anywhere)
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null
    constraint audit_log_admin_id_fkey references public.profiles(id) on delete restrict,
  action text not null,
  target_table text not null,
  target_id uuid not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_table, target_id);
create index if not exists audit_log_admin_idx on public.audit_log (admin_id, created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bank_details_touch_updated_at on public.bank_details;
create trigger bank_details_touch_updated_at
  before update on public.bank_details
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Auto-create a profile for every new auth user (future user panel sign-ups).
-- security definer so it can write public.profiles regardless of the caller.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), split_part(new.email, '@', 1), 'User'),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
