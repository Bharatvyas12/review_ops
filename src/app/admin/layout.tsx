import { redirect } from "next/navigation";
import { getSessionUser, isAdminProfile } from "@/lib/auth";
import { AdminShell, type NavCounts } from "@/components/layout/AdminShell";
import type { ServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Layer 2 of the admin protection. Middleware already redirected anonymous
// visitors, but this re-checks on every render so no /admin page can be
// streamed to a non-admin even if the matcher is ever misconfigured.
async function loadCounts(supabase: ServerSupabaseClient): Promise<NavCounts> {
  const reviews = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "review_submitted");

  return { reviews: reviews.count ?? 0 };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser();

  if (!session) redirect("/login");
  if (!isAdminProfile(session.profile)) redirect("/login?denied=1");

  const counts = await loadCounts(session.supabase);

  return (
    <AdminShell
      name={session.profile?.full_name ?? "Admin"}
      email={session.email}
      counts={counts}
    >
      {children}
    </AdminShell>
  );
}
