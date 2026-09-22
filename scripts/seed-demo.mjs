#!/usr/bin/env node
/**
 * Seeds a throwaway demo data set so every screen has something to show:
 * three demo users, three products, orders spread across every queue
 * (review pending, review approvals, payments) plus paid and rejected history.
 *
 *   npm run seed:demo
 *
 * Reads credentials from .env.local (see --env-file-if-exists in package.json).
 * It only creates rows. Demo users are prefixed with `demo+` so they are easy to
 * find and delete afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bankKey = process.env.BANK_ENCRYPTION_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Put them in .env.local (copy .env.example) and run again.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Mirrors src/lib/crypto.ts: `v1.<base64url iv>.<base64url ciphertext||tag>`. */
function encryptAccountNumber(plaintext) {
  if (!bankKey) return null;
  const raw = /^[0-9a-fA-F]{64}$/.test(bankKey.trim())
    ? Buffer.from(bankKey.trim(), "hex")
    : Buffer.from(bankKey.trim(), "base64");

  if (raw.length !== 32) {
    throw new Error("BANK_ENCRYPTION_KEY must decode to 32 bytes (npm run key:generate).");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", raw, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64url = (buffer) => buffer.toString("base64url");

  return `v1.${b64url(iv)}.${b64url(Buffer.concat([ciphertext, tag]))}`;
}

const DEMO_PASSWORD = `Demo-${randomUUID().slice(0, 8)}-pass`;

const DEMO_PRODUCTS = [
  { name: "boAt Airdopes 141", brand: "boAt", description: "TWS earbuds, 42h playback.", total_slots: 12, cashback_amount: 250, status: "open" },
  { name: "Noise ColorFit Pro 4", brand: "Noise", description: "Smart watch with SpO2 tracking.", total_slots: 8, cashback_amount: 400, status: "open" },
  { name: "Milton Thermosteel Flask", brand: "Milton", description: "1 litre insulated flask.", total_slots: 5, cashback_amount: 150, status: "open" },
];

async function createDemoUser(fullName, phone) {
  const email = `demo+${fullName.split(" ")[0].toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });

  if (error) throw new Error(`createUser(${email}): ${error.message}`);

  // The handle_new_auth_user trigger already inserted the profile.
  await admin.from("profiles").update({ phone, phone_verified: true }).eq("id", data.user.id);

  return { id: data.user.id, email };
}

// Re-running the seed used to stack duplicate demo rows on top of the previous
// run. Clear whatever an earlier run created first so this is idempotent.
// Scoped tightly: only demo+...@example.com accounts, and only the three
// products this script creates (created_by is null, matching name).
async function clearPreviousDemoData() {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);

  const demoUsers = (data?.users ?? []).filter((user) => /^demo\+.*@example\.com$/i.test(user.email ?? ""));
  const demoIds = demoUsers.map((user) => user.id);
  const productNames = DEMO_PRODUCTS.map((product) => product.name);

  const { count: productCount } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .in("name", productNames)
    .is("created_by", null);

  if (demoIds.length === 0 && !productCount) return;

  // Orders reference both users and products, so they go first.
  if (demoIds.length > 0) {
    await admin.from("notifications").delete().in("user_id", demoIds);
    await admin.from("orders").delete().in("user_id", demoIds);
    await admin.from("bank_details").delete().in("user_id", demoIds);
    await admin.from("audit_log").delete().in("admin_id", demoIds);
  }

  await admin.from("products").delete().in("name", productNames).is("created_by", null);

  if (demoIds.length > 0) {
    await admin.from("profiles").delete().in("id", demoIds);
    for (const id of demoIds) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(id);
      if (deleteError) throw new Error(`deleteUser(${id}): ${deleteError.message}`);
    }
  }

  console.log(`Cleared previous demo data: ${demoIds.length} user(s), ${productCount ?? 0} product(s).`);
}

async function main() {
  await clearPreviousDemoData();

  const [asha, rohit, meera] = [
    await createDemoUser("Asha Rao", "9876543210"),
    await createDemoUser("Rohit Verma", "9812345678"),
    await createDemoUser("Meera Iyer", "9900112233"),
  ];

  const { data: products, error: productError } = await admin
    .from("products")
    .insert(DEMO_PRODUCTS)
    .select();

  if (productError) throw new Error(`insert products: ${productError.message}`);
  const [air, watch, flask] = products;

  const { error: orderError } = await admin.from("orders").insert([
    {
      user_id: asha.id,
      product_id: air.id,
      status: "claimed",
      user_confirmed: false,
    },
    {
      user_id: rohit.id,
      product_id: air.id,
      status: "review_pending",
      order_screenshot_url: null,
      extracted_name: "Rohit Verma",
      extracted_order_id: "402-7781234-9982110",
      extracted_phone: "9812345678",
      extracted_product_name: "boAt Airdopes 141",
      user_confirmed: true,
    },
    {
      user_id: meera.id,
      product_id: air.id,
      status: "review_submitted",
      extracted_name: "Meera Iyer",
      extracted_order_id: "402-9911200-5510233",
      extracted_phone: "9900112233",
      extracted_product_name: "boAt Airdopes 141",
      user_confirmed: true,
      order_confirmed_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      review_submitted_at: new Date(Date.now() - 86_400_000).toISOString(),
      review_link: "https://www.amazon.in/review/R2EXAMPLE",
    },
    {
      user_id: rohit.id,
      product_id: watch.id,
      status: "approved",
      extracted_name: "Rohit Verma",
      extracted_order_id: "402-3311992-7712004",
      extracted_phone: "9812345678",
      extracted_product_name: "Noise ColorFit Pro 4",
      user_confirmed: true,
      order_confirmed_at: new Date(Date.now() - 9 * 86_400_000).toISOString(),
      review_submitted_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      approved_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    },
    {
      user_id: meera.id,
      product_id: watch.id,
      status: "paid",
      extracted_name: "Meera Iyer",
      extracted_order_id: "402-5511009-2233881",
      extracted_phone: "9900112233",
      extracted_product_name: "Noise ColorFit Pro 4",
      user_confirmed: true,
      order_confirmed_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
      review_submitted_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
      approved_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      paid_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      payment_reference: "UTR-8820019345",
    },
    {
      user_id: asha.id,
      product_id: watch.id,
      status: "rejected",
      extracted_name: "Asha Rao",
      extracted_order_id: "402-0000000-0000000",
      user_confirmed: true,
      rejection_reason: "The order id on the screenshot does not match the account.",
    },
    {
      user_id: rohit.id,
      product_id: flask.id,
      status: "review_pending",
      extracted_name: "Rohit Verma",
      extracted_order_id: "402-6612003-4471902",
      extracted_phone: "9812345678",
      extracted_product_name: "Milton Thermosteel Flask",
      user_confirmed: false,
    },
  ]);

  if (orderError) throw new Error(`insert orders: ${orderError.message}`);

  if (bankKey) {
    const { error: bankError } = await admin.from("bank_details").insert([
      {
        user_id: rohit.id,
        account_holder_name: "Rohit Verma",
        account_number_encrypted: encryptAccountNumber("50100234567890"),
        account_number_last4: "7890",
        ifsc_code: "HDFC0001234",
        upi_id: "rohit@okhdfcbank",
      },
      {
        user_id: meera.id,
        account_holder_name: "Meera Iyer",
        account_number_encrypted: encryptAccountNumber("91827364550011"),
        account_number_last4: "0011",
        ifsc_code: "ICIC0004567",
        upi_id: "meera@okicici",
      },
    ]);
    if (bankError) throw new Error(`insert bank details: ${bankError.message}`);
  } else {
    console.warn("BANK_ENCRYPTION_KEY is missing, so payout details were skipped.");
  }

  await admin.from("notifications").insert([
    { user_id: meera.id, type: "payment_sent", message: "Payment sent. Reference: UTR-8820019345" },
    { user_id: rohit.id, type: "review_approved", message: "Your review was approved. Payment is being processed." },
  ]);

  console.log("\nDemo data seeded.\n");
  console.log("Demo users (password is the same for all three):");
  for (const user of [asha, rohit, meera]) {
    console.log(`  ${user.email}`);
  }
  console.log(`  password: ${DEMO_PASSWORD}\n`);
  console.log("Products: 3 · Orders: 7 (2 review pending, 1 review approval, 1 payment, 1 paid, 1 rejected)");
  console.log("Sign in with your own admin account and open /admin to see it.\n");
}

await main().catch((error) => {
  console.error(`\nSeeding failed: ${error.message}\n`);
  process.exit(1);
});
