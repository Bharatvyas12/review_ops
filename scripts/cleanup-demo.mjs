#!/usr/bin/env node
/**
 * Safely removes seeded demo data before going live.
 *
 *   npm run demo:cleanup
 *
 * Scoped strictly to:
 *   - Users with email pattern demo+*@example.com
 *   - Demo products created by seed script (created_by IS NULL and matching demo names)
 *
 * Real admin-created data (brands, campaigns, products created through admin UI)
 * will NOT be touched.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Put them in .env.local and run again.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PRODUCT_NAMES = [
  "boAt Airdopes 141",
  "Noise ColorFit Pro 4",
  "Milton Thermosteel Flask",
];

async function main() {
  console.log("\nStarting demo data cleanup...\n");

  // 1. Find demo auth users
  const { data: userData, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw new Error(`listUsers error: ${listError.message}`);

  const demoUsers = (userData?.users ?? []).filter((u) =>
    /^demo\+.*@example\.com$/i.test(u.email ?? ""),
  );
  const demoIds = demoUsers.map((u) => u.id);

  console.log(`Found ${demoUsers.length} demo user account(s):`);
  for (const u of demoUsers) {
    console.log(`  - ${u.email} (${u.id})`);
  }

  // 2. Find demo products (created_by IS NULL and matching DEMO_PRODUCT_NAMES)
  const { data: demoProducts, error: prodError } = await admin
    .from("products")
    .select("id, name, created_by")
    .in("name", DEMO_PRODUCT_NAMES)
    .is("created_by", null);

  if (prodError) throw new Error(`find demo products error: ${prodError.message}`);

  const demoProdIds = (demoProducts ?? []).map((p) => p.id);

  // 3. Delete dependent demo user data in order
  let deletedOrdersCount = 0;
  let deletedNotificationsCount = 0;
  let deletedBankDetailsCount = 0;
  let deletedAuditLogCount = 0;

  if (demoIds.length > 0) {
    const { count: ordCount } = await admin
      .from("orders")
      .delete({ count: "exact" })
      .in("user_id", demoIds);
    deletedOrdersCount = ordCount ?? 0;

    const { count: notifCount } = await admin
      .from("notifications")
      .delete({ count: "exact" })
      .in("user_id", demoIds);
    deletedNotificationsCount = notifCount ?? 0;

    const { count: bankCount } = await admin
      .from("bank_details")
      .delete({ count: "exact" })
      .in("user_id", demoIds);
    deletedBankDetailsCount = bankCount ?? 0;

    const { count: auditCount } = await admin
      .from("audit_log")
      .delete({ count: "exact" })
      .in("admin_id", demoIds);
    deletedAuditLogCount = auditCount ?? 0;
  }

  // 4. Check demo products safety before deletion
  let deletedProductsCount = 0;
  let skippedProducts = [];

  if (demoProdIds.length > 0) {
    // Check if any remaining (non-demo) orders reference these demo products
    const { data: nonDemoOrders } = await admin
      .from("orders")
      .select("product_id")
      .in("product_id", demoProdIds);

    const referencedProductIds = new Set((nonDemoOrders ?? []).map((o) => o.product_id));

    const safeToDeleteProdIds = demoProdIds.filter((id) => !referencedProductIds.has(id));
    skippedProducts = (demoProducts ?? []).filter((p) => referencedProductIds.has(p.id));

    if (safeToDeleteProdIds.length > 0) {
      const { count: prodCount } = await admin
        .from("products")
        .delete({ count: "exact" })
        .in("id", safeToDeleteProdIds);
      deletedProductsCount = prodCount ?? 0;
    }
  }

  // 5. Delete profiles & auth users
  let deletedProfilesCount = 0;
  if (demoIds.length > 0) {
    const { count: profCount } = await admin
      .from("profiles")
      .delete({ count: "exact" })
      .in("id", demoIds);
    deletedProfilesCount = profCount ?? 0;

    for (const id of demoIds) {
      const { error: delUserErr } = await admin.auth.admin.deleteUser(id);
      if (delUserErr) console.warn(`Warning: failed to delete auth user ${id}: ${delUserErr.message}`);
    }
  }

  // 6. Verification
  const { data: verifyAuth } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const remainingDemo = (verifyAuth?.users ?? []).filter((u) =>
    /^demo\+.*@example\.com$/i.test(u.email ?? ""),
  );

  console.log("\n================ CLEANUP SUMMARY ================");
  console.log(`Demo Auth Users Deleted : ${demoIds.length}`);
  console.log(`Profiles Deleted        : ${deletedProfilesCount}`);
  console.log(`Demo User Orders Deleted: ${deletedOrdersCount}`);
  console.log(`Notifications Deleted   : ${deletedNotificationsCount}`);
  console.log(`Bank Details Deleted    : ${deletedBankDetailsCount}`);
  console.log(`Audit Log Rows Deleted  : ${deletedAuditLogCount}`);
  console.log(`Demo Products Deleted   : ${deletedProductsCount}`);
  if (skippedProducts.length > 0) {
    console.log(`Demo Products Kept (referenced by real user orders):`);
    for (const sp of skippedProducts) {
      console.log(`  - ${sp.name} (${sp.id})`);
    }
  }
  console.log(`Remaining Demo Users    : ${remainingDemo.length}`);
  console.log("=================================================\n");

  if (remainingDemo.length === 0) {
    console.log("SUCCESS: All demo user accounts and demo data were safely cleaned up!");
  } else {
    console.warn("WARNING: Some demo users could not be deleted.");
  }
}

main().catch((err) => {
  console.error(`\nCleanup failed: ${err.message}\n`);
  process.exit(1);
});
