#!/usr/bin/env node
/**
 * End-to-end database acceptance checks.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *     node supabase/tests/rls-and-slot-checks.mjs
 *
 * Verifies, against a real project:
 *   1. a user cannot read another user's orders / bank details / notifications
 *   2. a user cannot read audit_log, self-promote to admin, or invent a notification
 *   3. the encrypted account column is not readable by any client session
 *   4. an admin session can read everything it should, and admin actions
 *      produce exactly one audit row plus one notification
 *   5. claim_product_slot is atomic under real concurrency (no oversell)
 *
 * Every run creates fresh throwaway accounts and removes them at the end.
 * Exits non-zero if any check fails, so it can gate a deploy.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.log("SKIP  set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to run these checks.");
  process.exit(0);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const results = [];
const cleanupUserIds = [];
const cleanupProductIds = [];

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
}

function isDenied(response) {
  // RLS denies either with an error, or with an empty result set.
  if (response.error) return true;
  const data = response.data;
  return data === null || (Array.isArray(data) && data.length === 0);
}

async function makeUser(label, password) {
  const email = `rls-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Test ${label}` },
  });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  cleanupUserIds.push(data.user.id);

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn(${label}): ${signInError.message}`);
  return { id: data.user.id, email, client };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const PASSWORD = `Test-${randomUUID()}-pass`;

async function main() {
  const userA = await makeUser("a", PASSWORD);
  const userB = await makeUser("b", PASSWORD);
  const adminUser = await makeUser("admin", PASSWORD);

  const { error: promoteError } = await admin.rpc("promote_admin", { p_email: adminUser.email });
  if (promoteError) throw new Error(`promote_admin: ${promoteError.message}`);
  const adminClient = createClient(url, anonKey, { auth: { persistSession: false } });
  await adminClient.auth.signInWithPassword({ email: adminUser.email, password: PASSWORD });

  // ---- fixture: one product, one order owned by B, bank details for B --------
  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      name: `RLS fixture ${randomUUID().slice(0, 6)}`,
      total_slots: 3,
      cashback_amount: 100,
      status: "open",
      created_by: adminUser.id,
    })
    .select()
    .single();
  if (productError) throw new Error(`insert product: ${productError.message}`);
  cleanupProductIds.push(product.id);

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({ user_id: userB.id, product_id: product.id, status: "order_submitted" })
    .select()
    .single();
  if (orderError) throw new Error(`insert order: ${orderError.message}`);

  await admin.from("bank_details").insert({
    user_id: userB.id,
    account_holder_name: "B Holder",
    account_number_encrypted: "v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb",
    account_number_last4: "4321",
    ifsc_code: "HDFC0001234",
  });
  await admin
    .from("notifications")
    .insert({ user_id: userB.id, type: "test", message: "fixture" });

  // ---- 1. cross-user reads are denied ---------------------------------------
  check("user A cannot read user B's orders", isDenied(await userA.client.from("orders").select("id").eq("id", order.id)));
  check("user A cannot read user B's bank details", isDenied(await userA.client.from("bank_details").select("user_id, account_number_last4").eq("user_id", userB.id)));
  check("user A cannot read user B's notifications", isDenied(await userA.client.from("notifications").select("id").eq("user_id", userB.id)));
  check("user A cannot read user B's profile", isDenied(await userA.client.from("profiles").select("id").eq("id", userB.id)));
  check("user B can read their own order", !isDenied(await userB.client.from("orders").select("id").eq("id", order.id)));

  // ---- 2. privilege escalation and audit_log are closed ---------------------
  check("user A cannot read audit_log", isDenied(await userA.client.from("audit_log").select("id").limit(5)));
  check("user A cannot insert a notification", Boolean((await userA.client.from("notifications").insert({ user_id: userA.id, type: "x", message: "x" })).error));
  check("user A cannot write an audit row", Boolean((await userA.client.from("audit_log").insert({ admin_id: userA.id, action: "fake", target_table: "orders", target_id: order.id })).error));
  check("user A cannot create a product", Boolean((await userA.client.from("products").insert({ name: "hack", total_slots: 1 })).error));

  const selfPromote = await userA.client.from("profiles").update({ role: "admin" }).eq("id", userA.id).select();
  check("user A cannot promote themselves to admin", Boolean(selfPromote.error) || isDenied(selfPromote));

  const phoneSpoof = await userA.client.from("profiles").update({ phone_verified: true }).eq("id", userA.id).select();
  check("user A cannot self-verify their phone", Boolean(phoneSpoof.error));

  // ---- 3. the encrypted column is unreachable from any client session -------
  const ciphertext = await userB.client.from("bank_details").select("account_number_encrypted").eq("user_id", userB.id);
  check("ciphertext is not selectable by an authenticated session", Boolean(ciphertext.error), ciphertext.error?.code ?? "");
  const adminCiphertext = await adminClient.from("bank_details").select("account_number_encrypted").eq("user_id", userB.id);
  check("ciphertext is not selectable even by an admin session", Boolean(adminCiphertext.error), adminCiphertext.error?.code ?? "");
  const masked = await adminClient.from("bank_details").select("user_id, account_number_last4").eq("user_id", userB.id).maybeSingle();
  check("admin can read the masked last four digits", !masked.error && masked.data?.account_number_last4 === "4321");

  // ---- 4. admin actions are audited and notify the user --------------------
  const illegal = await adminClient.rpc("admin_transition_order", {
    p_order_id: order.id,
    p_new_status: "paid",
    p_action: "approve_order",
  });
  check("an illegal transition is refused", Boolean(illegal.error));

  const { data: auditedOrder, error: approveError } = await adminClient.rpc("admin_transition_order", {
    p_order_id: order.id,
    p_new_status: "order_confirmed",
    p_action: "approve_order",
  });
  check("admin can approve an order", !approveError && auditedOrder?.status === "order_confirmed", approveError?.message ?? "");

  const auditRows = await admin.from("audit_log").select("id, action, admin_id").eq("target_id", order.id);
  const approveRows = (auditRows.data ?? []).filter((row) => row.action === "approve_order");
  check("approving wrote exactly one audit row", approveRows.length === 1, `found ${approveRows.length}`);
  check("the audit row names the acting admin", approveRows[0]?.admin_id === adminUser.id);

  const notified = await admin.from("notifications").select("id, type").eq("related_order_id", order.id).eq("type", "order_confirmed");
  check("approving notified the user", (notified.data ?? []).length === 1);

  const unauthenticated = await createClient(url, anonKey).rpc("admin_transition_order", {
    p_order_id: order.id,
    p_new_status: "rejected",
    p_action: "reject_order",
    p_reason: "nope",
  });
  check("an anonymous caller cannot run admin functions", Boolean(unauthenticated.error));

  const rejectWithoutReason = await adminClient.rpc("admin_transition_order", {
    p_order_id: order.id,
    p_new_status: "rejected",
    p_action: "reject_order",
  });
  check("rejecting without a reason is refused", Boolean(rejectWithoutReason.error));

  // ---- 5. slot claiming is atomic under concurrency -------------------------
  const { data: hotProduct, error: hotError } = await admin
    .from("products")
    .insert({ name: `Concurrency fixture ${randomUUID().slice(0, 6)}`, total_slots: 5, status: "open" })
    .select()
    .single();
  if (hotError) throw new Error(`insert hot product: ${hotError.message}`);
  cleanupProductIds.push(hotProduct.id);

  const claimants = await Promise.all(Array.from({ length: 12 }, (_, index) => makeUser(`c${index}`, PASSWORD)));
  const attempts = await Promise.all(
    claimants.map((claimant) => claimant.client.rpc("claim_product_slot", { p_product_id: hotProduct.id })),
  );
  const wins = attempts.filter((attempt) => attempt.data === true).length;
  const failures = attempts.filter((attempt) => attempt.error);

  check("exactly 5 of 12 concurrent claims succeeded", wins === 5, `${wins} succeeded`);
  check("no concurrent claim errored", failures.length === 0, failures[0]?.error?.message ?? "");

  const { data: settled } = await admin.from("products").select("slots_filled, total_slots").eq("id", hotProduct.id).single();
  check("slots_filled stopped at total_slots", settled?.slots_filled === 5, `${settled?.slots_filled}/${settled?.total_slots}`);
  check("no oversell is possible", (settled?.slots_filled ?? 0) <= (settled?.total_slots ?? 0));

  const closed = await admin.from("products").update({ status: "closed" }).eq("id", hotProduct.id);
  if (closed.error) throw new Error(closed.error.message);
  const claimOnClosed = await claimants[0].client.rpc("claim_product_slot", { p_product_id: hotProduct.id });
  check("a closed product cannot be claimed", claimOnClosed.data === false);

  // ---- 6. daily staggered release ------------------------------------------
  const { data: staggered, error: staggeredError } = await admin
    .from("products")
    .insert({
      name: `Staggered fixture ${randomUUID().slice(0, 6)}`,
      total_slots: 30,
      daily_release_limit: 4,
      status: "open",
    })
    .select()
    .single();
  if (staggeredError) throw new Error(`insert staggered product: ${staggeredError.message}`);
  cleanupProductIds.push(staggered.id);

  check(
    "a staggered product opens only its first batch",
    staggered.released_slots === 4 && staggered.total_slots === 30,
    `${staggered.released_slots}/${staggered.total_slots}`,
  );

  // One attempt each from six different accounts: the same account twice would
  // hit the one-live-claim-per-product index rather than the slot limit.
  const staggeredAttempts = await Promise.all(
    claimants
      .slice(6, 12)
      .map((claimant) => claimant.client.rpc("claim_product_slot", { p_product_id: staggered.id })),
  );
  const staggeredWins = staggeredAttempts.filter((attempt) => attempt.data === true).length;
  check(
    "claims stop at the released batch on the real project",
    staggeredWins === 4,
    `${staggeredWins} of 6 won with 4 of 30 released`,
  );
  check(
    "the losers are refused without an error",
    staggeredAttempts.every((attempt) => !attempt.error),
    staggeredAttempts.find((attempt) => attempt.error)?.error?.message ?? "",
  );

  const earlyRelease = await claimants[6].client.rpc("release_daily_slots");
  check(
    "a signed-in user cannot open a batch early",
    Boolean(earlyRelease.error),
    earlyRelease.error?.message ?? "no error",
  );

  const backdated = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const { error: backdateError } = await admin
    .from("products")
    .update({ last_release_date: backdated })
    .eq("id", staggered.id);
  if (backdateError) throw new Error(`backdate last_release_date: ${backdateError.message}`);

  const { error: releaseError } = await admin.rpc("release_daily_slots");
  check("the service role can run the daily job", !releaseError, releaseError?.message ?? "");

  const { data: afterRelease } = await admin
    .from("products")
    .select("released_slots, total_slots")
    .eq("id", staggered.id)
    .single();
  check(
    "three missed days release three batches at once",
    afterRelease?.released_slots === 16,
    `${afterRelease?.released_slots} (4 + 4*3)`,
  );

  await admin.rpc("release_daily_slots");
  const { data: afterSecondRun } = await admin
    .from("products")
    .select("released_slots")
    .eq("id", staggered.id)
    .single();
  check("running the job twice in a day changes nothing", afterSecondRun?.released_slots === 16);

  // ==========================================================================
  // User panel (phase 2): the reviewer-facing claim and proof flow.
  // ==========================================================================

  async function verifyPhone(userId) {
    const { error } = await admin
      .from("profiles")
      .update({ phone_verified: true, phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` })
      .eq("id", userId);
    if (error) throw new Error(`verifyPhone: ${error.message}`);
  }

  const verified = await makeUser("verified", PASSWORD);
  const rival = await makeUser("rival", PASSWORD);
  const unverified = await makeUser("unverified", PASSWORD);
  await verifyPhone(verified.id);
  await verifyPhone(rival.id);

  // ---- the phone gate is enforced by the database, not by the UI ----------
  const { data: gateProduct, error: gateError } = await admin
    .from("products")
    .insert({ name: `Gate fixture ${randomUUID().slice(0, 6)}`, total_slots: 3, status: "open" })
    .select()
    .single();
  if (gateError) throw new Error(`insert gate product: ${gateError.message}`);
  cleanupProductIds.push(gateProduct.id);

  const unverifiedClaim = await unverified.client.rpc("claim_product_for_user", {
    p_product_id: gateProduct.id,
  });
  check("an unverified phone cannot claim, server-side", Boolean(unverifiedClaim.error), unverifiedClaim.error?.message ?? "no error");

  // ---- claiming creates the order in the same transaction -----------------
  const claim = await verified.client.rpc("claim_product_for_user", { p_product_id: gateProduct.id });
  check("a verified user can claim a slot", !claim.error && claim.data?.status === "claimed", claim.error?.message ?? "");
  check("the claim created the order", typeof claim.data?.id === "string");

  const afterClaim = await admin.from("products").select("slots_filled").eq("id", gateProduct.id).single();
  check("the claim consumed exactly one slot", afterClaim.data?.slots_filled === 1, `${afterClaim.data?.slots_filled}`);

  const duplicate = await verified.client.rpc("claim_product_for_user", { p_product_id: gateProduct.id });
  check("a duplicate claim on the same product is refused", Boolean(duplicate.error));
  const afterDuplicate = await admin.from("products").select("slots_filled").eq("id", gateProduct.id).single();
  check("the refused duplicate did not consume a slot", afterDuplicate.data?.slots_filled === 1);

  // ---- race safety on the real claim path ---------------------------------
  const { data: raceProduct, error: raceError } = await admin
    .from("products")
    .insert({ name: `Race fixture ${randomUUID().slice(0, 6)}`, total_slots: 5, status: "open" })
    .select()
    .single();
  if (raceError) throw new Error(`insert race product: ${raceError.message}`);
  cleanupProductIds.push(raceProduct.id);

  const racers = await Promise.all(Array.from({ length: 12 }, (_, index) => makeUser(`r${index}`, PASSWORD)));
  await Promise.all(racers.map((racer) => verifyPhone(racer.id)));

  const raceResults = await Promise.all(
    racers.map((racer) => racer.client.rpc("claim_product_for_user", { p_product_id: raceProduct.id })),
  );
  const raceWins = raceResults.filter((result) => result.data?.id).length;
  check("exactly 5 of 12 concurrent claims created an order", raceWins === 5, `${raceWins} won`);

  const raceSettled = await admin.from("products").select("slots_filled, total_slots").eq("id", raceProduct.id).single();
  check(
    "the concurrency-safe claim never oversells",
    raceSettled.data?.slots_filled === 5 && raceSettled.data?.slots_filled <= raceSettled.data?.total_slots,
    `${raceSettled.data?.slots_filled}/${raceSettled.data?.total_slots}`,
  );

  const raceOrders = await admin.from("orders").select("id").eq("product_id", raceProduct.id);
  check("the winning claims are exactly the orders that exist", (raceOrders.data ?? []).length === 5);

  // ---- proof submission is ownership-checked ------------------------------
  const orderId = claim.data?.id;
  const foreignPath = await rival.client.rpc("submit_order_proof", {
    p_order_id: orderId,
    p_screenshot_path: `${rival.id}/order/x.png`,
    p_name: "Rival",
    p_order_ref: "REF-1",
  });
  check("a user cannot submit proof against another user's order", Boolean(foreignPath.error));

  const foreignFolder = await verified.client.rpc("submit_order_proof", {
    p_order_id: orderId,
    p_screenshot_path: `${rival.id}/order/x.png`,
    p_name: "Verified",
    p_order_ref: "REF-1",
  });
  check("a user cannot submit a screenshot path outside their own folder", Boolean(foreignFolder.error));

  const submitted = await verified.client.rpc("submit_order_proof", {
    p_order_id: orderId,
    p_screenshot_path: `${verified.id}/order/x.png`,
    p_name: "Verified",
    p_order_ref: "REF-123",
  });
  check(
    "a user can submit their own order proof",
    !submitted.error && submitted.data?.status === "review_pending" && submitted.data?.user_confirmed === true,
    submitted.error?.message ?? "",
  );

  const rivalRead = await rival.client.from("orders").select("id").eq("id", orderId);
  check("the rival still cannot read that order", (rivalRead.data ?? []).length === 0);

  // ---- payout details round-trip ------------------------------------------
  const cipherValue = `v1.${"A".repeat(24)}.${"B".repeat(24)}`;
  const savedBank = await verified.client.rpc("user_save_bank_details", {
    p_account_holder_name: "Verified Holder",
    p_account_number_encrypted: cipherValue,
    p_account_number_last4: "4321",
    p_ifsc_code: "HDFC0001234",
    p_upi_id: null,
  });
  check("a user can save encrypted payout details", !savedBank.error && savedBank.data?.[0]?.account_number_last4 === "4321", savedBank.error?.message ?? "");
  check(
    "the save response never carries the ciphertext",
    !("account_number_encrypted" in (savedBank.data?.[0] ?? {})),
    Object.keys(savedBank.data?.[0] ?? {}).join(", "),
  );

  const plaintextAttempt = await verified.client.rpc("user_save_bank_details", {
    p_account_holder_name: "Verified Holder",
    p_account_number_encrypted: "1234567890",
    p_account_number_last4: "7890",
    p_ifsc_code: "HDFC0001234",
    p_upi_id: null,
  });
  check("a plaintext account number is refused by the database", Boolean(plaintextAttempt.error));

  const ciphertextRead = await verified.client.from("bank_details").select("account_number_encrypted").eq("user_id", verified.id);
  check("no client session can read the stored ciphertext", Boolean(ciphertextRead.error) || (ciphertextRead.data ?? []).length === 0);

  const payoutAudit = await admin
    .from("audit_log")
    .select("id, action, admin_id")
    .eq("target_table", "bank_details")
    .eq("target_id", verified.id);
  check("the payout change was audited with the user as the actor", (payoutAudit.data ?? []).some((row) => row.admin_id === verified.id));

  // ---- the server-only surface is not reachable from a browser ------------
  const clientRateLimit = await verified.client.rpc("consume_rate_limit", { p_key: "forged", p_limit: 1, p_window_ms: 60000 });
  check("a signed-in user cannot call consume_rate_limit", Boolean(clientRateLimit.error));
  const anonRateLimit = await createClient(url, anonKey).rpc("consume_rate_limit", { p_key: "forged", p_limit: 1, p_window_ms: 60000 });
  check("an anonymous caller cannot call consume_rate_limit", Boolean(anonRateLimit.error));
  const clientVerify = await verified.client.rpc("verify_phone_code", { p_user_id: verified.id, p_code_hash: "a".repeat(64) });
  check("a signed-in user cannot call verify_phone_code", Boolean(clientVerify.error));

  // ---- the OTP path, end to end against the real functions ---------------
  if (process.env.BANK_ENCRYPTION_KEY) {
    const otpUser = await makeUser("otp", PASSWORD);
    // verify_phone_code also checks that the code belongs to the number currently
    // on the profile, so the profile needs a phone before a code can be issued.
    const otpPhone = "+919876500123";
    const phoneSet = await admin.from("profiles").update({ phone: otpPhone }).eq("id", otpUser.id);
    if (phoneSet.error) throw new Error(`set phone: ${phoneSet.error.message}`);

    const code = "135790";
    const pepper = process.env.OTP_HASH_PEPPER || sha256(`reviewsys:otp:v1:${process.env.BANK_ENCRYPTION_KEY}`);
    const codeHash = sha256(`${pepper}:${otpUser.id}:${code}`);

    await admin.from("phone_verifications").insert({
      user_id: otpUser.id,
      phone: otpPhone,
      code_hash: codeHash,
      max_attempts: 2,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });

    const wrong = await admin.rpc("verify_phone_code", { p_user_id: otpUser.id, p_code_hash: sha256(`${pepper}:${otpUser.id}:000000`) });
    check("a wrong OTP is rejected", wrong.data === "invalid", String(wrong.data));
    const right = await admin.rpc("verify_phone_code", { p_user_id: otpUser.id, p_code_hash: codeHash });
    check("the correct OTP verifies the account", right.data === "verified", String(right.data));

    const profile = await admin.from("profiles").select("phone_verified").eq("id", otpUser.id).single();
    check("verifying flipped phone_verified", profile.data?.phone_verified === true);

    const replay = await admin.rpc("verify_phone_code", { p_user_id: otpUser.id, p_code_hash: codeHash });
    check("a consumed OTP cannot be replayed", replay.data === "missing", String(replay.data));
  } else {
    check("OTP checks skipped: BANK_ENCRYPTION_KEY is not set", true);
  }
}

async function cleanup() {
  // audit_log.admin_id is ON DELETE RESTRICT, and the test admin writes audit
  // rows, so those rows block the profile delete forever. The previous version
  // ignored the resulting error, which leaked a live admin account into the
  // project on every run. Clear the audit rows first, then delete the users.
  for (const userId of cleanupUserIds) {
    await admin.from("audit_log").delete().eq("admin_id", userId);
  }

  for (const productId of cleanupProductIds) {
    await admin.from("orders").delete().eq("product_id", productId);
    await admin.from("products").delete().eq("id", productId);
  }

  for (const userId of cleanupUserIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.log(`WARN  cleanup could not delete ${userId}: ${error.message}`);
    }
  }
}

try {
  await main();
} catch (error) {
  check("suite completed", false, error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
