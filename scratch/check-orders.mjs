import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, serviceKey);

const { data: demoUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const demoIds = (demoUsers?.users ?? []).filter((u) => /^demo\+.*@example\.com$/i.test(u.email ?? "")).map((u) => u.id);

const DEMO_PRODUCT_NAMES = ["boAt Airdopes 141", "Noise ColorFit Pro 4", "Milton Thermosteel Flask"];
const { data: demoProducts } = await admin.from("products").select("id, name").in("name", DEMO_PRODUCT_NAMES).is("created_by", null);
const demoProdIds = (demoProducts ?? []).map((p) => p.id);

let query = admin.from("orders").select("id, user_id, product_id, created_at, profiles(full_name, role)");
if (demoIds.length > 0) {
  query = query.not("user_id", "in", `(${demoIds.join(",")})`);
}
const { data: orders } = await query.in("product_id", demoProdIds);

console.log("Non-demo orders referencing demo products:");
console.log(JSON.stringify(orders, null, 2));
