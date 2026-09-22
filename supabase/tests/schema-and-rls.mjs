#!/usr/bin/env node
/**
 * Runs every migration against an in-process Postgres (PGlite), then exercises
 * the RLS policies, the privilege model, the triggers and the audit trail.
 *
 *   npm run test:schema
 *
 * PGlite is a real Postgres build, so this catches SQL that would otherwise
 * only fail on a live project. The Supabase-provided bits (auth.users,
 * auth.uid(), the storage schema) are stubbed first, exactly as the platform
 * provides them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

// Discovered rather than hard-coded: a hard-coded list silently skips every new
// migration, which would let this suite pass while the real schema moved on.
const MIGRATIONS = readdirSync(new URL("../migrations", import.meta.url))
  .filter((file) => file.endsWith(".sql"))
  .sort();

const PLATFORM_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema if not exists auth;
  create schema if not exists storage;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb default '{}'::jsonb
  );

  -- Supabase exposes the caller's JWT subject through auth.uid().
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );

  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text,
    owner uuid
  );
  alter table storage.objects enable row level security;

  create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;

  -- Supabase grants anon/authenticated/service_role broad privileges on public
  -- objects by default and relies on RLS (plus the column privileges in 0002)
  -- to constrain them. Mirror that here, or the checks below would be testing
  -- GRANTs instead of policies.
  grant usage on schema public, storage to anon, authenticated, service_role;
  grant all on storage.objects to authenticated, service_role;
  grant all on storage.buckets to authenticated, service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;
`;

const results = [];

function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
}

function uuid() {
  return crypto.randomUUID();
}

const db = new PGlite();

/** Query as a given role with an optional JWT subject. */
async function as(role, subject, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [subject ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

async function expectFailure(role, subject, sql, params = []) {
  try {
    await as(role, subject, sql, params);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Same as expectFailure, but returns the error so its `hint` can be asserted. */
async function expectFailureError(role, subject, sql, params = []) {
  try {
    await as(role, subject, sql, params);
    return null;
  } catch (error) {
    return error;
  }
}
async function seedUser(fullName) {
  const id = uuid();
  const email = `${id.slice(0, 8)}@example.com`;
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify({ full_name: fullName }),
  ]);
  return { id, email };
}

/** A fresh product + order pair, so the one-live-order-per-product index never bites. */
async function freshOrder(userId, status = "claimed") {
  const productId = uuid();
  await db.query("insert into products (id, name, total_slots, status) values ($1, $2, 5, 'open')", [
    productId,
    `Fixture ${productId.slice(0, 4)}`,
  ]);
  const orderId = uuid();
  await db.query("insert into orders (id, user_id, product_id, status) values ($1, $2, $3, $4)", [
    orderId,
    userId,
    productId,
    status,
  ]);
  return { orderId, productId };
}

async function main() {
  await db.exec(PLATFORM_STUBS);

  for (const file of MIGRATIONS) {
    const sql = readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8");
    await db.exec(sql);
  }
  check("all migrations applied cleanly", true);

  // ---- schema shape --------------------------------------------------------
  // Tables a client session may reach; each one needs an explicit policy.
  const tables = ["profiles", "bank_details", "products", "orders", "notifications", "audit_log"];
  // Server-side only tables. RLS is enabled and there is deliberately NO policy,
  // so no client role can read or write them even with the anon key.
  const serviceOnlyTables = ["phone_verifications", "rate_limits"];
  const allTables = [...tables, ...serviceOnlyTables];

  const rls = await db.query(
    "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
  );
  const rlsByName = new Map(rls.rows.map((row) => [row.relname, row.relrowsecurity]));
  check(
    "RLS is enabled on every public table",
    rls.rows.length === allTables.length &&
      allTables.every((table) => rlsByName.get(table) === true),
    allTables.filter((table) => rlsByName.get(table) !== true).join(", ") ||
      `all ${allTables.length}`,
  );

  const policies = await db.query("select tablename, cmd, policyname from pg_policies where schemaname = 'public'");
  const policyTables = new Set(policies.rows.map((row) => row.tablename));
  check(
    "every table has at least one policy (no permissive default)",
    tables.every((table) => policyTables.has(table)),
  );
  check(
    "server-only tables expose no policy at all (default deny)",
    serviceOnlyTables.every((table) => !policyTables.has(table)),
    serviceOnlyTables.filter((table) => policyTables.has(table)).join(", ") || "phone_verifications, rate_limits",
  );
  check(
    "audit_log has no update or delete policy",
    !policies.rows.some((row) => row.tablename === "audit_log" && (row.cmd === "UPDATE" || row.cmd === "DELETE")),
  );

  const buckets = await db.query("select id, public from storage.buckets");
  check(
    "storage buckets exist and are private",
    buckets.rows.length === 2 && buckets.rows.every((row) => row.public === false),
  );
  check(
    "storage.objects is protected by policies",
    (await db.query("select 1 from pg_policies where schemaname = 'storage'")).rows.length >= 4,
  );

  // ---- fixtures ------------------------------------------------------------
  const alice = await seedUser("Alice Admin");
  const bob = await seedUser("Bob User");
  const cara = await seedUser("Cara User");

  await db.query("select public.promote_admin($1)", [alice.email]);
  check("promote_admin granted the admin role", true);

  const productId = uuid();
  await db.query(
    "insert into products (id, name, total_slots, cashback_amount, status) values ($1, 'Fixture', 5, 100, 'open')",
    [productId],
  );

  const orderId = uuid();
  await db.query("insert into orders (id, user_id, product_id, status) values ($1, $2, $3, 'claimed')", [
    orderId,
    bob.id,
    productId,
  ]);

  await db.query(
    "insert into bank_details (user_id, account_holder_name, account_number_encrypted, account_number_last4) values ($1, 'Bob', 'v1.aaaa.bbbb', '4321')",
    [bob.id],
  );
  await db.query("insert into notifications (user_id, type, message) values ($1, 'test', 'hi')", [bob.id]);

  // ---- user isolation ------------------------------------------------------
  const crossOrder = await as("authenticated", cara.id, "select id from orders where user_id = $1", [bob.id]);
  check("a user cannot read another user's orders", crossOrder.rows.length === 0);

  const crossBank = await as("authenticated", cara.id, "select user_id from bank_details where user_id = $1", [
    bob.id,
  ]);
  check("a user cannot read another user's bank details", crossBank.rows.length === 0);

  const crossNotes = await as("authenticated", cara.id, "select id from notifications where user_id = $1", [
    bob.id,
  ]);
  check("a user cannot read another user's notifications", crossNotes.rows.length === 0);

  const crossProfile = await as("authenticated", cara.id, "select id from profiles where id = $1", [bob.id]);
  check("a user cannot read another user's profile", crossProfile.rows.length === 0);

  const ownOrder = await as("authenticated", bob.id, "select id from orders where id = $1", [orderId]);
  check("a user can read their own order", ownOrder.rows.length === 1);

  // ---- privilege model -----------------------------------------------------
  check(
    "a user cannot promote themselves",
    Boolean(await expectFailure("authenticated", cara.id, "update profiles set role = 'admin' where id = $1", [cara.id])),
  );
  check(
    "a user cannot self-verify their phone",
    Boolean(await expectFailure("authenticated", cara.id, "update profiles set phone_verified = true where id = $1", [cara.id])),
  );
  check(
    "a user cannot insert a product",
    Boolean(await expectFailure("authenticated", cara.id, "insert into products (name, total_slots) values ('hack', 1)")),
  );
  check(
    "a user cannot read the audit log",
    (await as("authenticated", cara.id, "select id from audit_log")).rows.length === 0,
  );
  check(
    "a user cannot write an audit row",
    Boolean(
      await expectFailure(
        "authenticated",
        cara.id,
        "insert into audit_log (admin_id, action, target_table, target_id) values ($1, 'fake', 'orders', $2)",
        [cara.id, orderId],
      ),
    ),
  );
  check(
    "the ciphertext column is not selectable by a user",
    Boolean(
      await expectFailure("authenticated", bob.id, "select account_number_encrypted from bank_details where user_id = $1", [bob.id]),
    ),
  );
  check(
    "the ciphertext column is not selectable by an admin session",
    Boolean(
      await expectFailure("authenticated", alice.id, "select account_number_encrypted from bank_details where user_id = $1", [bob.id]),
    ),
  );
  check(
    "an admin can read the masked columns",
    (await as("authenticated", alice.id, "select account_number_last4 from bank_details where user_id = $1", [bob.id]))
      .rows[0]?.account_number_last4 === "4321",
  );

  // ---- order lifecycle -----------------------------------------------------
  check(
    "a user cannot jump straight to paid",
    Boolean(await expectFailure("authenticated", bob.id, "update orders set status = 'paid' where id = $1", [orderId])),
  );
  check(
    "a user cannot set approved_at",
    Boolean(
      await expectFailure("authenticated", bob.id, "update orders set approved_at = now() where id = $1", [orderId]),
    ),
  );

  check(
    "submitting an order proof without confirming the details is refused",
    Boolean(
      await expectFailure(
        "authenticated",
        bob.id,
        "update orders set status = 'review_pending' where id = $1",
        [orderId],
      ),
    ),
  );

  await as(
    "authenticated",
    bob.id,
    "update orders set status = 'review_pending', user_confirmed = true where id = $1",
    [orderId],
  );
  const submitted = await as(
    "authenticated",
    bob.id,
    "select status, user_confirmed from orders where id = $1",
    [orderId],
  );
  check(
    "a user can move claimed -> review_pending, with no approval step in between",
    submitted.rows[0]?.status === "review_pending" && submitted.rows[0]?.user_confirmed === true,
  );

  const retiredStage = await freshOrder(bob.id, "claimed");
  check(
    "the retired claimed -> order_submitted transition is now refused",
    Boolean(
      await expectFailure(
        "authenticated",
        bob.id,
        "update orders set status = 'order_submitted', user_confirmed = true where id = $1",
        [retiredStage.orderId],
      ),
    ),
  );

  const stuckOrder = await freshOrder(bob.id, "order_submitted");
  const stuckAdvanced = await expectFailureError(
    "authenticated",
    bob.id,
    "update orders set status = 'review_pending' where id = $1",
    [stuckOrder.orderId],
  );
  check(
    "a row left in the retired stage can still move forward to review_pending",
    stuckAdvanced === null,
    stuckAdvanced?.message ?? "",
  );

  check(
    "an illegal admin transition is refused",
    Boolean(
      await expectFailure("authenticated", alice.id, "select public.admin_transition_order($1, 'paid', 'approve_order')", [orderId]),
    ),
  );
  // admin_transition_order() is still live code - the review queue drives
  // review_submitted -> approved/rejected through it - so its retired order
  // branch keeps its coverage here against a row still carrying that status.
  const legacyConfirm = await freshOrder(bob.id, "order_submitted");

  check(
    "rejecting without a reason is refused",
    Boolean(
      await expectFailure("authenticated", alice.id, "select public.admin_transition_order($1, 'rejected', 'reject_order')", [legacyConfirm.orderId]),
    ),
  );

  await as(
    "authenticated",
    alice.id,
    "select public.admin_transition_order($1, 'order_confirmed', 'approve_order')",
    [legacyConfirm.orderId],
  );
  const confirmed = await db.query("select status, order_confirmed_at from orders where id = $1", [legacyConfirm.orderId]);
  check(
    "a legacy order can still be confirmed and the timestamp is derived",
    confirmed.rows[0]?.status === "order_confirmed" && confirmed.rows[0]?.order_confirmed_at !== null,
  );

  const auditRows = await db.query("select action, admin_id from audit_log where target_id = $1", [legacyConfirm.orderId]);
  check("the approval wrote exactly one audit row", auditRows.rows.length === 1);
  check("the audit row names the acting admin", auditRows.rows[0]?.admin_id === alice.id);

  const notified = await db.query("select type from notifications where related_order_id = $1", [legacyConfirm.orderId]);
  check("the approval notified the user", notified.rows.some((row) => row.type === "order_confirmed"));

  check(
    "marking a non-approved order as paid is refused",
    Boolean(
      await expectFailure("authenticated", alice.id, "select public.admin_mark_paid($1, 'UTR1')", [orderId]),
    ),
  );
  check(
    "marking as paid without a reference is refused",
    Boolean(
      await expectFailure(
        "authenticated",
        alice.id,
        "select public.admin_mark_paid($1, '   ')",
        [(await freshOrder(bob.id, "approved")).orderId],
      ),
    ),
  );

  // A review-submitted order can be rejected, and the reason is stored.
  const toReject = await freshOrder(bob.id, "review_pending");
  check(
    "submitting a review with neither screenshot nor link is refused",
    Boolean(
      await expectFailure(
        "authenticated",
        bob.id,
        "update orders set status = 'review_submitted' where id = $1",
        [toReject.orderId],
      ),
    ),
  );
  await as(
    "authenticated",
    bob.id,
    "update orders set status = 'review_submitted', review_link = 'https://www.amazon.in/review/R2TESTONLY' where id = $1",
    [toReject.orderId],
  );
  await as(
    "authenticated",
    alice.id,
    "select public.admin_transition_order($1, 'rejected', 'reject_review', 'Blurry proof')",
    [toReject.orderId],
  );
  const rejected = await db.query("select status, rejection_reason from orders where id = $1", [toReject.orderId]);
  check(
    "rejecting a review stores the reason",
    rejected.rows[0]?.status === "rejected" && rejected.rows[0]?.rejection_reason === "Blurry proof",
  );

  // The full happy path: approve a review, then pay it.
  const toPay = await freshOrder(bob.id, "review_pending");
  await as(
    "authenticated",
    bob.id,
    "update orders set status = 'review_submitted', review_link = 'https://www.amazon.in/review/R2PAYTEST' where id = $1",
    [toPay.orderId],
  );
  await as("authenticated", alice.id, "select public.admin_transition_order($1, 'approved', 'approve_review')", [toPay.orderId]);
  const approved = await db.query("select status, approved_at from orders where id = $1", [toPay.orderId]);
  check(
    "approving a review sets approved_at",
    approved.rows[0]?.status === "approved" && approved.rows[0]?.approved_at !== null,
  );

  await as("authenticated", alice.id, "select public.admin_mark_paid($1, 'UTR-778899')", [toPay.orderId]);
  const paid = await db.query("select status, paid_at, payment_reference from orders where id = $1", [toPay.orderId]);
  check(
    "marking as paid stores the reference and timestamp",
    paid.rows[0]?.status === "paid" &&
      paid.rows[0]?.payment_reference === "UTR-778899" &&
      paid.rows[0]?.paid_at !== null,
  );
  check(
    "marking as paid was audited",
    (await db.query("select 1 from audit_log where target_id = $1 and action = 'mark_paid'", [toPay.orderId])).rows.length === 1,
  );
  check(
    "the payment notified the user",
    (
      await db.query("select 1 from notifications where related_order_id = $1 and type = 'payment_sent'", [
        toPay.orderId,
      ])
    ).rows.length === 1,
  );
  check(
    "paying an already paid order is refused",
    Boolean(
      await expectFailure("authenticated", alice.id, "select public.admin_mark_paid($1, 'UTR-double')", [toPay.orderId]),
    ),
  );
  check(
    "an anonymous caller cannot run admin functions",
    Boolean(await expectFailure("authenticated", "", "select public.admin_transition_order($1, 'order_confirmed', 'approve_order')", [orderId])),
  );

  // ---- product creation + audit -------------------------------------------
  const created = await as(
    "authenticated",
    alice.id,
    "select public.admin_create_product('Created by admin', 'Brand', null, null, 3, 250) as product",
  );
  check("an admin can create a product through the audited function", Boolean(created.rows[0]?.product));
  check(
    "product creation was audited",
    (await db.query("select 1 from audit_log where action = 'create_product'")).rows.length === 1,
  );
  check(
    "a user cannot create a product through the admin function",
    Boolean(await expectFailure("authenticated", cara.id, "select public.admin_create_product('Nope', null, null, null, 1, null)")),
  );

  // ---- slot claiming -------------------------------------------------------
  const hotId = uuid();
  await db.query("insert into products (id, name, total_slots, status) values ($1, 'Hot', 5, 'open')", [hotId]);

  let wins = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const claim = await as("authenticated", cara.id, "select public.claim_product_slot($1) as ok", [hotId]);
    if (claim.rows[0]?.ok === true) wins += 1;
  }
  const settled = await db.query("select slots_filled, total_slots from products where id = $1", [hotId]);
  check("exactly total_slots claims succeed", wins === 5, `${wins} of 8 won`);
  check("slots_filled never exceeds total_slots", settled.rows[0]?.slots_filled === 5);

  check(
    "the slots bounds constraint blocks a manual oversell",
    Boolean(await expectFailure("authenticated", alice.id, "update products set slots_filled = 99 where id = $1", [hotId])),
  );

  await db.query("update products set status = 'closed' where id = $1", [hotId]);
  const closedClaim = await as("authenticated", cara.id, "select public.claim_product_slot($1) as ok", [hotId]);
  check("a closed product cannot be claimed", closedClaim.rows[0]?.ok === false);

  check(
    "an anonymous caller cannot claim a slot",
    Boolean(await expectFailure("authenticated", "", "select public.claim_product_slot($1)", [hotId])),
  );

  // ---- daily staggered release --------------------------------------------
  const staggeredId = uuid();
  await db.query(
    "insert into products (id, name, total_slots, daily_release_limit) values ($1, 'Staggered', 20, 3)",
    [staggeredId],
  );
  const staggeredRow = (await db.query("select released_slots, total_slots from products where id = $1", [staggeredId])).rows[0];
  check(
    "a product with a daily limit opens one batch on day one",
    staggeredRow?.released_slots === 3 && staggeredRow?.total_slots === 20,
    `${staggeredRow?.released_slots}/${staggeredRow?.total_slots}`,
  );

  const immediateId = uuid();
  await db.query("insert into products (id, name, total_slots) values ($1, 'Immediate', 6)", [immediateId]);
  check(
    "a product without a limit opens every slot",
    (await db.query("select released_slots from products where id = $1", [immediateId])).rows[0]?.released_slots === 6,
  );

  let staggeredWins = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const claim = await as("authenticated", cara.id, "select public.claim_product_slot($1) as ok", [staggeredId]);
    if (claim.rows[0]?.ok === true) staggeredWins += 1;
  }
  check(
    "claims stop at the released batch, not at total_slots",
    staggeredWins === 3,
    `${staggeredWins} of 5 won with 3 of 20 released`,
  );

  await db.query(
    "update products set last_release_date = (now() at time zone 'Asia/Kolkata')::date - 4 where id = $1",
    [staggeredId],
  );
  const releaseRun = await db.query("select public.release_daily_slots() as n");
  check("the daily job reports what it topped up", releaseRun.rows[0]?.n === 1, `n=${releaseRun.rows[0]?.n}`);
  check(
    "four missed days release four batches at once",
    (await db.query("select released_slots from products where id = $1", [staggeredId])).rows[0]?.released_slots === 15,
    "3 + 3*4",
  );
  check(
    "a second run on the same day changes nothing",
    (await db.query("select public.release_daily_slots() as n")).rows[0]?.n === 0,
  );

  const cappedId = uuid();
  await db.query(
    "insert into products (id, name, total_slots, daily_release_limit, last_release_date) values ($1, 'Capped', 6, 5, (now() at time zone 'Asia/Kolkata')::date - 10)",
    [cappedId],
  );
  await db.query("select public.release_daily_slots()");
  const cappedRow = (await db.query("select released_slots, total_slots from products where id = $1", [cappedId])).rows[0];
  check(
    "catch-up never releases more than total_slots",
    cappedRow?.released_slots === cappedRow?.total_slots && cappedRow?.total_slots === 6,
    `${cappedRow?.released_slots}/${cappedRow?.total_slots}`,
  );

  const closedStaggeredId = uuid();
  await db.query(
    "insert into products (id, name, total_slots, daily_release_limit, status, last_release_date) values ($1, 'Closed staggered', 9, 2, 'closed', (now() at time zone 'Asia/Kolkata')::date - 5)",
    [closedStaggeredId],
  );
  await db.query("select public.release_daily_slots()");
  check(
    "a closed product is not topped up",
    (await db.query("select released_slots from products where id = $1", [closedStaggeredId])).rows[0]?.released_slots === 2,
  );

  check(
    "a signed-in user cannot open a batch early",
    Boolean(await expectFailure("authenticated", cara.id, "select public.release_daily_slots()")),
  );
  check(
    "released_slots can never exceed total_slots",
    Boolean(await expectFailure("authenticated", alice.id, "update products set released_slots = 999 where id = $1", [cappedId])),
  );

  const adminCreated = await as(
    "authenticated",
    alice.id,
    "select (public.admin_create_product('Staggered RPC', null, null, null, 12, null, null, null, null, 4)).released_slots as released",
  );
  check("the admin RPC creates a staggered product", adminCreated.rows[0]?.released === 4, `released=${adminCreated.rows[0]?.released}`);

  const adminCleared = await as(
    "authenticated",
    alice.id,
    "select (public.admin_update_product($1, null, null, null, null, null, null, null, null, null, null, 0)).daily_release_limit as limit",
    [staggeredId],
  );
  check(
    "a limit of 0 clears the limit without rewinding released_slots",
    adminCleared.rows[0]?.limit === null &&
      (await db.query("select released_slots from products where id = $1", [staggeredId])).rows[0]?.released_slots === 15,
  );

  const adminLowered = await as(
    "authenticated",
    alice.id,
    "select (public.admin_update_product($1, null, null, null, null, 8)).released_slots as released",
    [staggeredId],
  );
  check(
    "lowering total_slots clamps released_slots",
    adminLowered.rows[0]?.released === 8,
    `released=${adminLowered.rows[0]?.released}`,
  );

  // ---- storage policies ---------------------------------------------------
  const aliceUpload = await as("authenticated", alice.id, "insert into storage.objects (bucket_id, name) values ('screenshots', 'admin/x/shot.png') returning id");
  check("an admin can write into the screenshots bucket", aliceUpload.rows.length === 1);
  check(
    "a user cannot write into another user's screenshot folder",
    Boolean(
      await expectFailure(
        "authenticated",
        cara.id,
        "insert into storage.objects (bucket_id, name) values ('screenshots', $1)",
        [`${bob.id}/order/shot.png`],
      ),
    ),
  );
  const ownUpload = await as("authenticated", cara.id, "insert into storage.objects (bucket_id, name) values ('screenshots', $1) returning id", [
    `${cara.id}/order/shot.png`,
  ]);
  check("a user can write into their own screenshot folder", ownUpload.rows.length === 1);

  // ==========================================================================
  // User panel (phase 2).
  // ==========================================================================

  const dave = await seedUser("Dave Unverified");
  const erin = await seedUser("Erin Verified");
  const frank = await seedUser("Frank Verified");
  const gina = await seedUser("Gina Verified");

  await as("service_role", null, "update profiles set phone_verified = true, phone = '+919876500001' where id = $1", [erin.id]);
  await as("service_role", null, "update profiles set phone_verified = true, phone = '+919876500002' where id = $1", [frank.id]);
  await as("service_role", null, "update profiles set phone_verified = true, phone = '+919876500004' where id = $1", [gina.id]);
  await as("service_role", null, "update profiles set phone = '+919876500003' where id = $1", [dave.id]);

  check(
    "the server can set phone_verified, which no client session may do",
    (
      await db.query(
        "select count(*)::int as n from profiles where phone_verified and id = any($1::uuid[])",
        [[erin.id, frank.id, gina.id]],
      )
    ).rows[0]?.n === 3,
  );

  // ---- the phone-verification gate ----------------------------------------
  const gateProduct = uuid();
  await db.query("insert into products (id, name, total_slots, status) values ($1, 'Gated', 3, 'open')", [gateProduct]);

  const unverifiedClaim = await expectFailureError(
    "authenticated",
    dave.id,
    "select * from public.claim_product_for_user($1)",
    [gateProduct],
  );
  check(
    "an unverified phone number cannot claim a slot, server-side",
    unverifiedClaim?.hint === "phone_unverified",
    unverifiedClaim?.hint ?? "no error raised",
  );

  const daveOrder = (await freshOrder(dave.id, "claimed")).orderId;
  const unverifiedProof = await expectFailureError(
    "authenticated",
    dave.id,
    "select * from public.submit_order_proof($1, $2, 'Dave', 'REF-1')",
    [daveOrder, `${dave.id}/order/x.png`],
  );
  check(
    "an unverified phone number cannot submit order proof, server-side",
    unverifiedProof?.hint === "phone_unverified",
    unverifiedProof?.hint ?? "no error raised",
  );

  const daveReviewOrder = (await freshOrder(dave.id, "order_confirmed")).orderId;
  const unverifiedReview = await expectFailureError(
    "authenticated",
    dave.id,
    "select * from public.submit_review_proof($1, null, 'https://www.amazon.in/gp/customer-reviews/R1DAVE')",
    [daveReviewOrder],
  );
  check(
    "an unverified phone number cannot submit review proof, server-side",
    unverifiedReview?.hint === "phone_unverified",
    unverifiedReview?.hint ?? "no error raised",
  );

  // ---- claiming -----------------------------------------------------------
  const claimable = uuid();
  await db.query("insert into products (id, name, total_slots, status) values ($1, 'Claimable', 2, 'open')", [claimable]);

  const firstClaim = await as("authenticated", erin.id, "select * from public.claim_product_for_user($1)", [claimable]);
  const claimedOrder = firstClaim.rows[0] ?? {};
  check(
    "a verified user can claim a slot, and the order is created in the same call",
    claimedOrder.status === "claimed" && typeof claimedOrder.id === "string",
    claimedOrder.status ?? "no row",
  );
  check(
    "the claim consumed exactly one slot",
    (await db.query("select slots_filled from products where id = $1", [claimable])).rows[0]?.slots_filled === 1,
  );

  const duplicateClaim = await expectFailureError(
    "authenticated",
    erin.id,
    "select * from public.claim_product_for_user($1)",
    [claimable],
  );
  check(
    "a second active claim on the same product is refused",
    duplicateClaim?.hint === "duplicate_claim",
    duplicateClaim?.hint ?? "no error raised",
  );
  check(
    "a refused duplicate claim rolls its slot increment back",
    (await db.query("select slots_filled from products where id = $1", [claimable])).rows[0]?.slots_filled === 1,
  );

  const closedProduct = uuid();
  await db.query("insert into products (id, name, total_slots, status) values ($1, 'Closed', 2, 'closed')", [closedProduct]);
  const closedProductClaim = await as("authenticated", frank.id, "select * from public.claim_product_for_user($1)", [closedProduct]);
  check("claiming a closed product yields no order", (closedProductClaim.rows[0]?.id ?? null) === null);

  const unknownClaim = await as("authenticated", frank.id, "select * from public.claim_product_for_user($1)", [uuid()]);
  check("claiming an unknown product yields no order", (unknownClaim.rows[0]?.id ?? null) === null);

  const hotProduct = uuid();
  await db.query("insert into products (id, name, total_slots, status) values ($1, 'Race', 2, 'open')", [hotProduct]);
  const raceResults = [];
  for (const racer of [erin, frank, gina]) {
    const result = await as("authenticated", racer.id, "select * from public.claim_product_for_user($1)", [hotProduct]);
    raceResults.push(result.rows[0]?.id ?? null);
  }
  check(
    "an oversubscribed product hands out exactly total_slots orders",
    raceResults.filter(Boolean).length === 2,
    `${raceResults.filter(Boolean).length} won`,
  );
  check(
    "an oversubscribed product never oversells its slots",
    (await db.query("select slots_filled, total_slots from products where id = $1", [hotProduct])).rows[0]?.slots_filled === 2,
  );

  // ---- order proof --------------------------------------------------------
  check(
    "order proof refuses a screenshot path outside the caller's own folder",
    (
      await expectFailureError("authenticated", erin.id, "select * from public.submit_order_proof($1, $2, 'Erin', 'REF-123')", [
        claimedOrder.id,
        `${frank.id}/order/x.png`,
      ])
    )?.hint === "invalid_path",
  );
  check(
    "order proof requires the order id read off the screenshot",
    (
      await expectFailureError("authenticated", erin.id, "select * from public.submit_order_proof($1, $2, 'Erin', 'x')", [
        claimedOrder.id,
        `${erin.id}/order/x.png`,
      ])
    )?.hint === "order_ref_required",
  );
  check(
    "order proof refuses an order belonging to somebody else",
    (
      await expectFailureError("authenticated", frank.id, "select * from public.submit_order_proof($1, $2, 'Frank', 'REF-123')", [
        claimedOrder.id,
        `${frank.id}/order/x.png`,
      ])
    )?.hint === "order_not_found",
  );

  const submittedOrder = await as(
    "authenticated",
    erin.id,
    "select * from public.submit_order_proof($1, $2, 'Erin', 'REF-123', '+919876500001', 'Widget')",
    [claimedOrder.id, `${erin.id}/order/x.png`],
  );
  const submittedRow = submittedOrder.rows[0] ?? {};
  check(
    "order proof stores the confirmed fields and flips user_confirmed",
    submittedRow.status === "review_pending" &&
      submittedRow.user_confirmed === true &&
      submittedRow.extracted_order_id === "REF-123",
    submittedRow.status ?? "no row",
  );
  check(
    "the submitted screenshot is recorded against the order",
    submittedRow.order_screenshot_url === `${erin.id}/order/x.png`,
  );
  check(
    "an order that was already submitted cannot be submitted again",
    (
      await expectFailureError("authenticated", erin.id, "select * from public.submit_order_proof($1, $2, 'Erin', 'REF-123')", [
        claimedOrder.id,
        `${erin.id}/order/y.png`,
      ])
    )?.hint === "order_locked",
  );

  // ---- review proof -------------------------------------------------------
  const reviewOrder = await freshOrder(erin.id, "order_confirmed");
  check(
    "review proof requires a screenshot or a link",
    (await expectFailureError("authenticated", erin.id, "select * from public.submit_review_proof($1)", [reviewOrder.orderId]))
      ?.hint === "proof_required",
  );
  check(
    "review proof refuses a non-http link",
    (
      await expectFailureError("authenticated", erin.id, "select * from public.submit_review_proof($1, null, $2)", [
        reviewOrder.orderId,
        "javascript:alert(1)",
      ])
    )?.hint === "invalid_link",
  );
  check(
    "review proof refuses an order that is not waiting for a review",
    (
      await expectFailureError("authenticated", gina.id, "select * from public.submit_review_proof($1, null, 'https://www.amazon.in/gp/customer-reviews/R1GINA')", [
        (await freshOrder(gina.id, "claimed")).orderId,
      ])
    )?.hint === "order_locked",
  );
  check(
    "review proof refuses an order belonging to somebody else",
    (
      await expectFailureError("authenticated", frank.id, "select * from public.submit_review_proof($1, null, 'https://www.amazon.in/gp/customer-reviews/R1FRANK')", [
        reviewOrder.orderId,
      ])
    )?.hint === "order_not_found",
  );

  const submittedReview = await as(
    "authenticated",
    erin.id,
    "select * from public.submit_review_proof($1, null, 'https://www.amazon.in/gp/customer-reviews/R1ERIN')",
    [reviewOrder.orderId],
  );
  const reviewRow = submittedReview.rows[0] ?? {};
  check(
    "review proof stores the link and derives review_submitted_at",
    reviewRow.status === "review_submitted" &&
      reviewRow.review_submitted_at !== null &&
      reviewRow.review_link === "https://www.amazon.in/gp/customer-reviews/R1ERIN",
    reviewRow.status ?? "no row",
  );

  // ---- payout details -----------------------------------------------------
  const ciphertext = `v1.${"A".repeat(24)}.${"B".repeat(24)}`;
  const savedBank = await as("authenticated", erin.id, "select * from public.user_save_bank_details($1, $2, $3, $4, $5)", [
    "Erin Holder",
    ciphertext,
    "4321",
    "HDFC0001234",
    null,
  ]);
  const savedBankRow = savedBank.rows[0] ?? {};
  check("a user can save their payout details", savedBankRow.account_number_last4 === "4321");
  check(
    "the masked save result never carries the ciphertext back",
    !Object.keys(savedBankRow).includes("account_number_encrypted"),
    Object.keys(savedBankRow).join(", "),
  );
  check(
    "only the ciphertext and the last four digits reach the table",
    (await db.query("select account_number_encrypted as c, account_number_last4 as l from bank_details where user_id = $1", [erin.id]))
      .rows[0]?.c === ciphertext,
  );
  check(
    "changing payout details is audited with the user as the actor",
    (
      await db.query("select 1 from audit_log where target_table = 'bank_details' and target_id = $1 and admin_id = $1", [
        erin.id,
      ])
    ).rows.length === 1,
  );
  check(
    "the audit row does not contain the account number",
    !JSON.stringify(
      (await db.query("select details from audit_log where target_table = 'bank_details' and target_id = $1", [erin.id])).rows[0]
        ?.details ?? {},
    ).includes(ciphertext),
  );

  const keptBank = await as("authenticated", erin.id, "select * from public.user_save_bank_details($1, null, null, null, $2)", [
    null,
    "erin@upi",
  ]);
  check(
    "a blank account number keeps the stored one while the UPI id is added",
    keptBank.rows[0]?.account_number_last4 === "4321" && keptBank.rows[0]?.upi_id === "erin@upi",
  );
  check(
    "a blank account number leaves the stored ciphertext untouched",
    (await db.query("select account_number_encrypted as c from bank_details where user_id = $1", [erin.id])).rows[0]?.c === ciphertext,
  );

  check(
    "saving with neither a bank account nor a UPI id is refused",
    (await expectFailureError("authenticated", dave.id, "select * from public.user_save_bank_details('Dave', null, null, null, null)"))?.hint ===
      "payout_required",
  );
  check(
    "a plaintext account number is refused, because the app layer must encrypt it",
    (
      await expectFailureError("authenticated", dave.id, "select * from public.user_save_bank_details('Dave', $1, $2, 'HDFC0001234', null)", [
        "1234567890",
        "7890",
      ])
    )?.hint === "invalid_ciphertext",
  );
  check(
    "an invalid IFSC is refused",
    (
      await expectFailureError("authenticated", dave.id, "select * from public.user_save_bank_details('Dave', $1, $2, 'BOGUS', null)", [
        ciphertext,
        "7890",
      ])
    )?.hint === "invalid_ifsc",
  );
  check(
    "an anonymous caller cannot save payout details",
    (
      await expectFailureError("authenticated", "", "select * from public.user_save_bank_details('Nobody', null, null, null, 'x@y')")
    )?.hint === "auth_required",
  );

  // ---- OTP codes ----------------------------------------------------------
  //
  // issueTestCode mirrors issuePhoneOtp(): a new code retires any code still
  // live for that user first, which is what keeps "one valid code at a time"
  // true. Exercising that sequence here means the checks below reflect the
  // states the application can actually produce.
  async function issueTestCode(userId, phone, codeHash, options = {}) {
    const { maxAttempts = 5, expiresInMs = 5 * 60_000 } = options;
    await as(
      "service_role",
      null,
      "update phone_verifications set consumed_at = now() where user_id = $1 and consumed_at is null",
      [userId],
    );
    await as(
      "service_role",
      null,
      "insert into phone_verifications (user_id, phone, code_hash, max_attempts, expires_at) values ($1, $2, $3, $4, $5)",
      [userId, phone, codeHash, maxAttempts, new Date(Date.now() + expiresInMs).toISOString()],
    );
  }

  const davePhone = "+919876500003";
  const rightHash = "a".repeat(64);
  const wrongHash = "b".repeat(64);

  const verifyAs = async (userId, hash) =>
    (await as("service_role", null, "select public.verify_phone_code($1, $2) as s", [userId, hash])).rows[0]?.s;

  check(
    "verify_phone_code reports no_phone for an account without a number",
    (await verifyAs(uuid(), rightHash)) === "no_phone",
  );
  check(
    "verify_phone_code reports missing when no code was ever issued",
    (await verifyAs(dave.id, rightHash)) === "missing",
  );

  await issueTestCode(dave.id, davePhone, rightHash);
  check(
    "issuing a new code retires the previous one, so only one is ever live",
    (
      await db.query("select count(*)::int as n from phone_verifications where user_id = $1 and consumed_at is null", [dave.id])
    ).rows[0]?.n === 1,
  );

  check("a wrong code is rejected", (await verifyAs(dave.id, wrongHash)) === "invalid");
  check(
    "a wrong guess does not verify the phone",
    (await db.query("select phone_verified from profiles where id = $1", [dave.id])).rows[0]?.phone_verified === false,
  );
  check(
    "a wrong guess is counted against the code",
    (await db.query("select attempts from phone_verifications where user_id = $1 and consumed_at is null", [dave.id]))
      .rows[0]?.attempts === 1,
  );

  await issueTestCode(dave.id, davePhone, rightHash, { expiresInMs: -60_000 });
  check("verify_phone_code reports expired once the window has passed", (await verifyAs(dave.id, rightHash)) === "expired");

  // max_attempts of 2, so the third guess must be cut off.
  await issueTestCode(dave.id, davePhone, rightHash, { maxAttempts: 2 });
  await verifyAs(dave.id, wrongHash);
  await verifyAs(dave.id, wrongHash);
  check("verify_phone_code cuts off guessing after max_attempts", (await verifyAs(dave.id, wrongHash)) === "too_many_attempts");

  await issueTestCode(dave.id, davePhone, rightHash);
  check("the correct code verifies the account", (await verifyAs(dave.id, rightHash)) === "verified");
  check(
    "verifying flips profiles.phone_verified",
    (await db.query("select phone_verified from profiles where id = $1", [dave.id])).rows[0]?.phone_verified === true,
  );
  check("a consumed code cannot be replayed", (await verifyAs(dave.id, rightHash)) === "missing");

  await issueTestCode(dave.id, "+919876500099", rightHash);
  check(
    "a code issued for a different number cannot be used after the number changes",
    (await verifyAs(dave.id, rightHash)) === "invalid",
  );
  // ---- server-only surface ------------------------------------------------
  check(
    "a client session cannot read the OTP table",
    Boolean(await expectFailureError("authenticated", erin.id, "select 1 from phone_verifications")),
  );
  check(
    "a client session cannot read the rate limit table",
    Boolean(await expectFailureError("authenticated", erin.id, "select 1 from rate_limits")),
  );
  check(
    "a client session cannot execute consume_rate_limit",
    Boolean(
      await expectFailureError("authenticated", erin.id, "select public.consume_rate_limit('client:forged', 1, 60000)"),
    ),
  );
  check(
    "an anonymous caller cannot execute consume_rate_limit",
    Boolean(await expectFailureError("anon", "", "select public.consume_rate_limit('anon:forged', 1, 60000)")),
  );
  check(
    "an anonymous caller cannot execute verify_phone_code",
    Boolean(await expectFailureError("anon", "", "select public.verify_phone_code($1, $2)", [dave.id, rightHash])),
  );
  check(
    "a client session cannot execute verify_phone_code",
    Boolean(await expectFailureError("authenticated", erin.id, "select public.verify_phone_code($1, $2)", [erin.id, rightHash])),
  );

  const limitedFirst = await as("service_role", null, "select * from public.consume_rate_limit('test:window', 2, 60000)");
  const limitedSecond = await as("service_role", null, "select * from public.consume_rate_limit('test:window', 2, 60000)");
  const limitedThird = await as("service_role", null, "select * from public.consume_rate_limit('test:window', 2, 60000)");
  check(
    "the shared rate limiter allows exactly the configured number of attempts",
    limitedFirst.rows[0]?.allowed === true && limitedSecond.rows[0]?.allowed === true,
  );
  check(
    "the shared rate limiter blocks past the limit and reports a retry delay",
    limitedThird.rows[0]?.allowed === false && (limitedThird.rows[0]?.retry_after_seconds ?? 0) > 0,
    `retry_after=${limitedThird.rows[0]?.retry_after_seconds}`,
  );
  // ---- the single-file setup bundle ---------------------------------------
  // supabase/setup.sql is what a human pastes into the SQL editor, so it must
  // apply on top of an already-migrated database without duplicating or
  // dropping anything.
  const listPolicies = async () =>
    (
      await db.query("select schemaname, tablename, policyname from pg_policies order by 1, 2, 3")
    ).rows.map((row) => `${row.schemaname}.${row.tablename}.${row.policyname}`);

  const policiesBefore = await listPolicies();
  const bundle = readFileSync(fileURLToPath(new URL("../setup.sql", import.meta.url)), "utf8");
  let bundleError = null;
  try {
    await db.exec(bundle);
  } catch (error) {
    bundleError = error instanceof Error ? error.message : String(error);
  }
  check("supabase/setup.sql applies on top of a migrated database", bundleError === null, bundleError ?? "");

  const rlsAfter = await db.query(
    "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
  );
  check(
    "RLS is still enabled everywhere after re-running the bundle",
    rlsAfter.rows.length > 0 && rlsAfter.rows.every((row) => row.relrowsecurity === true),
    `${rlsAfter.rows.filter((row) => row.relrowsecurity === true).length}/${rlsAfter.rows.length} tables`,
  );

  const policiesAfter = await listPolicies();
  check(
    "the bundle re-run neither duplicates nor drops policies",
    policiesAfter.length === policiesBefore.length &&
      policiesAfter.every((name, index) => name === policiesBefore[index]),
    `${policiesBefore.length} -> ${policiesAfter.length}`,
  );

  const functionsAfter = await db.query(
    "select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace",
  );
  check(
    "the bundle re-run keeps the helper functions",
    (functionsAfter.rows[0]?.n ?? 0) >= 10,
    `${functionsAfter.rows[0]?.n} functions`,
  );
}

try {
  await main();
} catch (error) {
  check("suite completed without an unexpected error", false, error instanceof Error ? error.message : String(error));
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
