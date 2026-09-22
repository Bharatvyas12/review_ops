import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminOrRedirect } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/StatusBadge";
import { IconInstagram, IconYoutube } from "@/components/ui/icons";
import { formatDate, initials } from "@/lib/format";
import type { OrderRow, ProfileRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const { supabase } = await requireAdminOrRedirect();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, phone_verified, role, created_at, instagram_username, youtube_username")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  const profiles = (data ?? []) as ProfileRow[];
  const userIds = profiles.map((profile) => profile.id);

  // Emails live in auth.users, which only the service role can read. The admin
  // role was verified above; this is a read-only enrichment for the console.
  const emailById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: authUsers } = await createAdminSupabaseClient().auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const user of authUsers?.users ?? []) {
      if (user.email) emailById.set(user.id, user.email);
    }
  }

  const { data: orderRows } = userIds.length
    ? await supabase.from("orders").select("id, user_id, status").in("user_id", userIds)
    : { data: [] as Pick<OrderRow, "id" | "user_id" | "status">[] };

  const stats = new Map<string, { total: number; paid: number; active: number }>();
  for (const order of (orderRows ?? []) as Pick<OrderRow, "id" | "user_id" | "status">[]) {
    const entry = stats.get(order.user_id) ?? { total: 0, paid: 0, active: 0 };
    entry.total += 1;
    if (order.status === "paid") entry.paid += 1;
    if (order.status !== "paid" && order.status !== "rejected") entry.active += 1;
    stats.set(order.user_id, entry);
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Registered accounts. Open a user to see their full order history."
      />

      <div className="card overflow-hidden">
        {profiles.length === 0 ? (
          <EmptyState
            title="No users yet"
            description="Accounts created through the user panel will appear here."
            icon="◍"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Orders</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3 text-right font-semibold">History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {profiles.map((profile) => {
                  const userStats = stats.get(profile.id) ?? { total: 0, paid: 0, active: 0 };
                  return (
                    <tr
                      key={profile.id}
                      className="transition hover:bg-slate-50/70 dark:hover:bg-white/5"
                    >
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                            {initials(profile.full_name)}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate font-medium text-slate-900 dark:text-white">
                                {profile.full_name}
                              </p>
                              {profile.instagram_username && (
                                <a
                                  href={`https://instagram.com/${profile.instagram_username}`}
                                  target="_blank"
                                  rel="noopener noreferrer nofollow"
                                  title={`Instagram: @${profile.instagram_username}`}
                                  className="text-pink-600 hover:text-pink-700 dark:text-pink-400"
                                >
                                  <IconInstagram className="h-4 w-4" />
                                </a>
                              )}
                              {profile.youtube_username && (
                                <a
                                  href={`https://youtube.com/@${profile.youtube_username}`}
                                  target="_blank"
                                  rel="noopener noreferrer nofollow"
                                  title={`YouTube: @${profile.youtube_username}`}
                                  className="text-red-600 hover:text-red-700 dark:text-red-400"
                                >
                                  <IconYoutube className="h-4 w-4" />
                                </a>
                              )}
                            </div>
                            <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {profile.id.slice(0, 8)}…
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className="text-slate-600 dark:text-slate-300">
                          {emailById.get(profile.id) ?? "—"}
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900 dark:text-white">
                            {userStats.total}
                          </span>
                          {userStats.active > 0 ? <Badge tone="info">{userStats.active} active</Badge> : null}
                          {userStats.paid > 0 ? <Badge tone="success">{userStats.paid} paid</Badge> : null}
                        </div>
                      </td>
                      <td className="table-cell">
                        {profile.phone ? (
                          <span className="inline-flex items-center gap-2">
                            {profile.phone}
                            {profile.phone_verified ? (
                              <Badge tone="success">Verified</Badge>
                            ) : (
                              <Badge tone="neutral">Unverified</Badge>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">Not provided</span>
                        )}
                      </td>
                      <td className="table-cell text-slate-500 dark:text-slate-400">
                        {formatDate(profile.created_at)}
                      </td>
                      <td className="table-cell text-right">
                        <Link href={`/admin/users/${profile.id}`} className="btn-secondary btn-sm">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
