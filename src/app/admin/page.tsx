import Link from "next/link";
import { requireAdminOrRedirect } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/StatusBadge";
import { IconBox, IconShield, IconStar, IconWallet } from "@/components/ui/icons";
import { formatCurrency, formatDateTime, formatRelative } from "@/lib/format";
import type { AuditLogRow, OrderRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export default async function DashboardPage() {
  const { supabase } = await requireAdminOrRedirect();
  const monthStart = startOfMonthIso();

  const [activeProducts, pendingReviews, paidThisMonth, auditEntries] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "review_submitted"),
    supabase
      .from("orders")
      .select("id, product_id, paid_at")
      .eq("status", "paid")
      .gte("paid_at", monthStart),
    supabase
      .from("audit_log")
      .select("id, action, target_table, target_id, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const paidOrders = (paidThisMonth.data ?? []) as Pick<OrderRow, "id" | "product_id">[];
  const productIds = [...new Set(paidOrders.map((order) => order.product_id))];

  // Live sum, not a cached counter: the cashback amount lives on the product,
  // so payouts this month are derived from the paid orders themselves.
  const { data: payoutProducts } = productIds.length
    ? await supabase.from("products").select("id, cashback_amount").in("id", productIds)
    : { data: [] as { id: string; cashback_amount: number | null }[] };

  const cashbackByProduct = new Map(
    (payoutProducts ?? []).map((product) => [product.id, Number(product.cashback_amount ?? 0)]),
  );
  const paidTotal = paidOrders.reduce(
    (total, order) => total + (cashbackByProduct.get(order.product_id) ?? 0),
    0,
  );

  const activity = (auditEntries.data ?? []) as unknown as AuditLogRow[];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live counts pulled straight from the database on every load."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Active products"
          value={activeProducts.count ?? 0}
          hint="Products currently open for claims"
          icon={<IconBox className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          label="Pending review approvals"
          value={pendingReviews.count ?? 0}
          hint="Reviews waiting for approval"
          icon={<IconStar className="h-5 w-5" />}
          tone="sky"
        />
        <StatCard
          label="Paid out this month"
          value={formatCurrency(paidTotal)}
          hint={`${paidOrders.length} order${paidOrders.length === 1 ? "" : "s"} paid since ${formatDateTime(monthStart)}`}
          icon={<IconWallet className="h-5 w-5" />}
          tone="emerald"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-white/10">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Queues</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Jump straight into what needs a decision.
              </p>
            </div>
            <IconShield className="h-5 w-5 text-slate-400" />
          </div>
          <div className="grid gap-3 p-5">
            <Link
              href="/admin/reviews"
              className="rounded-xl border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50/50 dark:border-white/10 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/10"
            >
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Review approvals
              </p>
              <p className="mt-1 text-2xl font-semibold text-brand-600 dark:text-brand-300">
                {pendingReviews.count ?? 0}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Approve submitted reviews
              </p>
            </Link>
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-white/10">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Recent admin activity
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Every state change is written to the audit log.
              </p>
            </div>
            <Badge tone="success">
              <IconShield className="h-3 w-3" /> Append only
            </Badge>
          </div>

          {activity.length === 0 ? (
            <EmptyState
              title="No admin actions recorded yet"
              description="Approve, reject or edit something and it will show up here."
              icon="✓"
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {entry.action.replace(/_/g, " ")}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {entry.target_table} · {entry.target_id.slice(0, 8)}…
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {formatRelative(entry.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
