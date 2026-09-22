import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminOrRedirect } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconInstagram, IconYoutube } from "@/components/ui/icons";
import { maskAccountNumber } from "@/lib/crypto";
import { formatCurrency, formatDate, formatDateTime, initials } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import type { BankDetailsMasked, OrderWithRelations, ProfileRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "User detail" };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdminOrRedirect();

  const { id } = await params;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, phone, phone_verified, role, created_at, instagram_username, youtube_username")
    .eq("id", parsedId.data)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profileData) notFound();

  const profile = profileData as ProfileRow;

  const [ordersResult, bankResult, authUser] = await Promise.all([
    supabase
      .from("orders")
      .select("*, product:products(id, name, brand, cashback_amount)")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("bank_details")
      .select("user_id, account_holder_name, account_number_last4, ifsc_code, upi_id, updated_at")
      .eq("user_id", profile.id)
      .maybeSingle(),
    createAdminSupabaseClient().auth.admin.getUserById(profile.id),
  ]);

  const orders = (ordersResult.data ?? []) as unknown as OrderWithRelations[];
  const bank = (bankResult.data ?? null) as BankDetailsMasked | null;
  const email = authUser.data.user?.email ?? null;

  const lifetimePaid = orders
    .filter((order) => order.status === "paid")
    .reduce((total, order) => total + Number(order.product?.cashback_amount ?? 0), 0);

  return (
    <>
      <Link
        href="/admin/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
      >
        ← All users
      </Link>

      <PageHeader
        title={profile.full_name}
        description={email ?? `User ${profile.id.slice(0, 8)}…`}
        action={
          <div className="flex flex-wrap gap-2">
            <Badge tone={profile.phone_verified ? "success" : "neutral"}>
              {profile.phone_verified ? "Phone verified" : "Phone unverified"}
            </Badge>
            <Badge tone="info">{orders.length} orders</Badge>
            <Badge tone="success">{formatCurrency(lifetimePaid)} paid</Badge>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="card overflow-hidden">
          <div className="border-b border-slate-100 p-5 dark:border-white/10">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Order history</h2>
          </div>

          {orders.length === 0 ? (
            <EmptyState
              title="No orders yet"
              description="This user has not claimed a product."
              icon="□"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] border-collapse text-left">
                <thead className="table-head">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Cashback</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className="transition hover:bg-slate-50/70 dark:hover:bg-white/5"
                    >
                      <td className="table-cell">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {order.product?.name ?? "Unknown product"}
                        </p>
                        {order.product?.brand ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {order.product.brand}
                          </p>
                        ) : null}
                      </td>
                      <td className="table-cell">
                        <OrderStatusBadge status={order.status} />
                        {order.rejection_reason ? (
                          <p className="mt-1 max-w-xs text-xs text-rose-600 dark:text-rose-400">
                            {order.rejection_reason}
                          </p>
                        ) : null}
                      </td>
                      <td className="table-cell">
                        {formatCurrency(order.product?.cashback_amount ?? null)}
                      </td>
                      <td className="table-cell text-slate-500 dark:text-slate-400">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="table-cell text-slate-500 dark:text-slate-400">
                        {order.paid_at ? formatDateTime(order.paid_at) : "—"}
                        {order.payment_reference ? (
                          <span className="block font-mono text-[11px]">
                            {order.payment_reference}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="card p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                {initials(profile.full_name)}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
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
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  Joined {formatDate(profile.created_at)}
                </p>
              </div>
            </div>

            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Email
                </dt>
                <dd className="mt-0.5 break-all text-slate-800 dark:text-slate-200">
                  {email ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Phone
                </dt>
                <dd className="mt-0.5 text-slate-800 dark:text-slate-200">
                  {profile.phone ?? "Not provided"}
                </dd>
              </div>
              {(profile.instagram_username || profile.youtube_username) && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Social Handles
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-2 text-xs">
                    {profile.instagram_username && (
                      <a
                        href={`https://instagram.com/${profile.instagram_username}`}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 font-medium text-pink-600 hover:underline dark:text-pink-400"
                      >
                        <IconInstagram className="h-3.5 w-3.5" />
                        @{profile.instagram_username}
                      </a>
                    )}
                    {profile.youtube_username && (
                      <a
                        href={`https://youtube.com/@${profile.youtube_username}`}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 font-medium text-red-600 hover:underline dark:text-red-400"
                      >
                        <IconYoutube className="h-3.5 w-3.5" />
                        @{profile.youtube_username}
                      </a>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Bank details</h2>
            {bank ? (
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Holder
                  </dt>
                  <dd className="mt-0.5 text-slate-800 dark:text-slate-200">
                    {bank.account_holder_name ?? "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Account
                  </dt>
                  <dd className="mt-0.5 font-mono text-slate-800 dark:text-slate-200">
                    {maskAccountNumber(bank.account_number_last4)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    IFSC / UPI
                  </dt>
                  <dd className="mt-0.5 text-slate-800 dark:text-slate-200">
                    {bank.ifsc_code ?? "—"} · {bank.upi_id ?? "—"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                This user has not saved payout details yet.
              </p>
            )}
            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">
              Only the last four digits are readable here. The full number is decrypted exclusively
              in the audited reveal action on the payments console.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
