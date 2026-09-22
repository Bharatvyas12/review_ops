#!/usr/bin/env node
/**
 * Setup doctor. Checks that a Supabase project is ready for this app and says
 * exactly what is missing.
 *
 *   npm run doctor
 *
 * Reads .env.local. Read-only apart from nothing at all - it creates no rows.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bankKey = process.env.BANK_ENCRYPTION_KEY;

const rows = [];

function report(name, ok, detail = "", fix = "") {
  rows.push({ name, ok, detail, fix });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok && fix) console.log(`      -> ${fix}`);
}

function decodeKeyLength(value) {
  if (!value) return 0;
  try {
    return Buffer.from(value.trim(), /^[0-9a-fA-F]{64}$/.test(value.trim()) ? "hex" : "base64").length;
  } catch {
    return 0;
  }
}

function isNetworkError(error) {
  return Boolean(
    error &&
      /fetch failed|network error|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(error.message ?? ""),
  );
}

// Reports a function probe. A transport failure is never treated as "the
// function exists" - that produced false PASS rows while Supabase was
// unreachable. healthyCodes lists the Postgres error codes that prove the
// function exists and rejected the probe on purpose.
function reportRpc(name, error, { healthyCodes = [], fix = "" } = {}) {
  if (isNetworkError(error)) {
    report(name, false, `could not reach Supabase: ${error.message}`, "Check your connection, then re-run npm run doctor");
    return;
  }
  const ok = !error || Boolean(error.code && healthyCodes.includes(error.code));
  report(name, ok, error ? error.message : "answers as expected", fix);
}

console.log("\nSetup doctor\n------------\n");

report("NEXT_PUBLIC_SUPABASE_URL is set", Boolean(url));
report("NEXT_PUBLIC_SUPABASE_ANON_KEY is set", Boolean(anonKey));
report("SUPABASE_SERVICE_ROLE_KEY is set", Boolean(serviceKey));
report(
  "BANK_ENCRYPTION_KEY is a 32-byte key",
  decodeKeyLength(bankKey) === 32,
  decodeKeyLength(bankKey) ? `${decodeKeyLength(bankKey)} bytes` : "empty",
  "npm run key:generate, then paste it into .env.local",
);

if (!url || !serviceKey) {
  console.log("\nCannot inspect the database without a URL and service role key.\n");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// ---- schema ---------------------------------------------------------------
// A probe column per table, and a REAL GET rather than a HEAD request.
//
// This used to select("*", { head: true }), which PostgREST answers with a 200
// and a null count even when the table does not exist - so a missing table
// reported PASS. Reading one row is what actually proves the table is there,
// and the column is named explicitly so bank_details never pulls ciphertext.
const TABLES = [
  { name: "profiles", probe: "id" },
  { name: "bank_details", probe: "user_id" },
  { name: "products", probe: "id" },
  { name: "orders", probe: "id" },
  { name: "notifications", probe: "id" },
  { name: "audit_log", probe: "id" },
];
const missingTables = [];
let tableNetworkError = null;

for (const { name, probe } of TABLES) {
  const { error } = await admin.from(name).select(probe).limit(1);
  if (isNetworkError(error)) {
    tableNetworkError = error;
    break;
  }
  const missing = Boolean(error && (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)));
  if (missing) missingTables.push(name);
}

if (tableNetworkError) {
  report(
    "all six tables exist",
    false,
    `could not reach Supabase: ${tableNetworkError.message}`,
    "Check your connection, then re-run npm run doctor",
  );
} else {
  report(
    "all six tables exist",
    missingTables.length === 0,
    missingTables.length ? `missing: ${missingTables.join(", ")}` : TABLES.map((t) => t.name).join(", "),
    "Run supabase/migrations/0001_init_schema.sql in the SQL editor",
  );
}

// ---- policies / functions -------------------------------------------------
// Every admin RPC opens with assert_admin(), which raises 42501 when the
// caller carries no JWT. The doctor probes with the service role, so 42501 is
// the healthy answer: it proves the function exists and guards itself.
const { error: isAdminError } = await admin.rpc("is_admin", {});
reportRpc("RLS helper is_admin() exists", isAdminError, {
  fix: "Run supabase/migrations/0002_rls_and_policies.sql",
});

const { error: promoteError } = await admin.rpc("promote_admin", { p_email: "nobody@example.com" });
reportRpc("promote_admin() exists", promoteError, {
  healthyCodes: ["P0002"],
  fix: "Run supabase/migrations/0005_bootstrap_admin.sql",
});

const { error: claimError } = await admin.rpc("claim_product_slot", {
  p_product_id: "00000000-0000-0000-0000-000000000000",
});
reportRpc("atomic claim_product_slot() exists", claimError, {
  healthyCodes: ["42501"],
  fix: "Run supabase/migrations/0003_functions_triggers.sql",
});

// ---- admin mutations ------------------------------------------------------
const { error: transitionError } = await admin.rpc("admin_transition_order", {
  p_order_id: "00000000-0000-0000-0000-000000000000",
  p_new_status: "order_confirmed",
  p_action: "approve_order",
});
reportRpc("audited admin_transition_order() exists", transitionError, {
  healthyCodes: ["42501", "P0002"],
  fix: "Run supabase/migrations/0003_functions_triggers.sql",
});

// ---- storage --------------------------------------------------------------
const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
const ids = (buckets ?? []).map((bucket) => bucket.id);
const hasBoth = ids.includes("screenshots") && ids.includes("product-images");
const allPrivate = (buckets ?? []).every((bucket) => bucket.public === false);
if (isNetworkError(bucketError)) {
  report(
    "private storage buckets exist",
    false,
    `could not reach Supabase: ${bucketError.message}`,
    "Check your connection, then re-run npm run doctor",
  );
} else {
  report(
    "private storage buckets exist",
    !bucketError && hasBoth && allPrivate,
    bucketError?.message ?? (ids.join(", ") || "none"),
    "Run supabase/migrations/0004_storage.sql",
  );
}

// ---- user panel objects (migration 0006) ----------------------------------
const PANEL_TABLES = [
  { name: "phone_verifications", probe: "id" },
  { name: "rate_limits", probe: "key" },
];
const missingPanelTables = [];

for (const { name, probe } of PANEL_TABLES) {
  const { error } = await admin.from(name).select(probe).limit(1);
  const missing = Boolean(
    error && (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)),
  );
  if (missing) missingPanelTables.push(name);
}

report(
  "phone verification and rate limit tables exist",
  missingPanelTables.length === 0,
  missingPanelTables.length ? `missing: ${missingPanelTables.join(", ")}` : PANEL_TABLES.map((t) => t.name).join(", "),
  "Run supabase/migrations/0006_user_panel.sql (or paste supabase/setup.sql) in the SQL editor",
);

// Every one of these opens by resolving the caller (assert_verified_user or an
// explicit auth.uid() check), so a service-role probe with no user context is
// answered with a denial. That denial IS the healthy result: it proves the
// function exists and guards itself before doing anything.
const { error: claimForUserError } = await admin.rpc("claim_product_for_user", {
  p_product_id: "00000000-0000-0000-0000-000000000000",
});
reportRpc("verified-only claim_product_for_user() exists", claimForUserError, {
  healthyCodes: ["42501"],
  fix: "Run supabase/migrations/0006_user_panel.sql",
});

const { error: orderProofError } = await admin.rpc("submit_order_proof", {
  p_order_id: "00000000-0000-0000-0000-000000000000",
  p_screenshot_path: "00000000-0000-0000-0000-000000000000/order/x.png",
  p_order_ref: "REF",
});
reportRpc("submit_order_proof() exists", orderProofError, {
  healthyCodes: ["42501"],
  fix: "Run supabase/migrations/0006_user_panel.sql",
});

const { error: reviewProofError } = await admin.rpc("submit_review_proof", {
  p_order_id: "00000000-0000-0000-0000-000000000000",
  p_review_link: "https://www.amazon.in/gp/customer-reviews/doctor",
});
reportRpc("submit_review_proof() exists", reviewProofError, {
  healthyCodes: ["42501"],
  fix: "Run supabase/migrations/0006_user_panel.sql",
});

const { error: bankSaveError } = await admin.rpc("user_save_bank_details", {
  p_account_holder_name: "doctor",
  p_upi_id: "doctor@example",
});
reportRpc("user_save_bank_details() exists", bankSaveError, {
  healthyCodes: ["42501"],
  fix: "Run supabase/migrations/0006_user_panel.sql",
});

// Reads no rows and writes nothing: an unknown user has no number on file.
const { data: otpProbe, error: otpError } = await admin.rpc("verify_phone_code", {
  p_user_id: "00000000-0000-0000-0000-000000000000",
  p_code_hash: "0".repeat(64),
});
report(
  "verify_phone_code() exists and reports an unknown account",
  !otpError && otpProbe === "no_phone",
  otpError?.message ?? String(otpProbe),
  "Run supabase/migrations/0006_user_panel.sql",
);

// Deliberately invalid arguments, so the function raises before it touches the
// rate limit table - this probe must not create a row.
const { error: rateLimitError } = await admin.rpc("consume_rate_limit", {
  p_key: "doctor-probe",
  p_limit: 0,
  p_window_ms: 0,
});
reportRpc("consume_rate_limit() exists", rateLimitError, {
  healthyCodes: ["P0001"],
  fix: "Run supabase/migrations/0006_user_panel.sql",
});

// With the correct grants this is refused before any row is written. The probe
// uses valid arguments on purpose: an invalid-argument error would be raised by
// the function body as well, which would hide a missing REVOKE.
if (anonKey && missingPanelTables.length === 0) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: anonRateLimitError } = await anon.rpc("consume_rate_limit", {
    p_key: "doctor:anon-permission-probe",
    p_limit: 1,
    p_window_ms: 60_000,
  });
  report(
    "the anon key cannot execute the server-only rate limiter",
    anonRateLimitError?.code === "42501",
    anonRateLimitError ? `${anonRateLimitError.code ?? "?"}: ${anonRateLimitError.message}` : "the call succeeded - the REVOKE is missing",
    "Re-run supabase/migrations/0006_user_panel.sql; it revokes EXECUTE from anon and authenticated",
  );
}
// ---- admin account --------------------------------------------------------
if (missingTables.length === 0) {
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (isNetworkError(error)) {
    report(
      "at least one admin account exists",
      false,
      `could not reach Supabase: ${error.message}`,
      "Check your connection, then re-run npm run doctor",
    );
  } else {
    report(
      "at least one admin account exists",
      !error && (count ?? 0) > 0,
      error?.message ?? `${count ?? 0} admin(s)`,
      'npm run admin:create -- you@example.com "Your Name" "a-long-password"',
    );
  }
}

const failed = rows.filter((row) => !row.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`);

if (failed.length === 0) {
  console.log("\nEverything is ready. Start the app with: npm.cmd run dev\n");
} else {
  console.log("\nFix the items marked FAIL above, then run npm run doctor again.\n");
}

process.exit(failed.length === 0 ? 0 : 1);
