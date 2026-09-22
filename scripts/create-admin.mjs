#!/usr/bin/env node
/**
 * Creates (or promotes) an admin account using the Supabase service role key.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
 *     node scripts/create-admin.mjs admin@example.com "Admin Name" "strong-password"
 *
 * The password is passed straight to Supabase Auth (which does the hashing) and
 * is never written to disk, never logged, and never stored by this script.
 */
import { createClient } from "@supabase/supabase-js";

const [email, fullName, password] = process.argv.slice(2);

if (!email || !password) {
  console.error(
    "Usage: node scripts/create-admin.mjs <email> <fullName> <password>\n" +
      "Password must be at least 12 characters.",
  );
  process.exit(1);
}

if (password.length < 12) {
  console.error("Refusing to create an admin with a password shorter than 12 characters.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
      "Never run this script with keys from a client-accessible environment.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
const match = existing?.users?.find((user) => user.email?.toLowerCase() === email.toLowerCase());

let userId = match?.id;

if (!userId) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? email.split("@")[0] },
  });
  if (error) {
    console.error(`Failed to create auth user: ${error.message}`);
    process.exit(1);
  }
  userId = data.user?.id;
  console.log(`Created auth user ${email}`);
} else {
  console.log(`Auth user ${email} already exists, reusing it.`);
}

if (!userId) {
  console.error("Supabase did not return a user id.");
  process.exit(1);
}

const { error: profileError } = await supabase
  .from("profiles")
  .upsert(
    { id: userId, full_name: fullName ?? email.split("@")[0], role: "admin" },
    { onConflict: "id" },
  );

if (profileError) {
  console.error(`Failed to promote profile to admin: ${profileError.message}`);
  process.exit(1);
}

console.log(`Done. ${email} now has profiles.role = 'admin'.`);
