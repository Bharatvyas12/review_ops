import type { Metadata } from "next";
import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth";
import { OrderStatusChip } from "@/components/app/OrderStatusChip";
import { OrdersRealtime } from "@/components/app/OrdersRealtime";
import { IconCheck, IconChevronRight } from "@/components/ui/icons";
import { formatCurrency, formatRelative } from "@/lib/format";
import { nextAction, trackerState } from "@/lib/user-orders";
import type { OrderStatus, ProductRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your orders" };

type OrderListRow = {
  id: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  review_submitted_at: string | null;
  rejection_reason: string | null;
  product: Pick<ProductRow, "id" | "name" | "brand" | "cashback_amount"> | null;
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ withdrawn?: string }>;
}) {
  const session = await requireUserOrRedirect("/app/orders");
  const { withdrawn } = await searchParams;

  // Ownership is filtered explicitly here as well as by RLS.
  const { data, error } = await session.supabase
    .from("orders")
    .select(
      "id, status, created_at, updated_at, review_submitted_at, rejection_reason, product:products(id, name, brand, cashback_amount)",
    )
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const orders = (data ?? []) as unknown as OrderListRow[];

  return (
    <div>
      <OrdersRealtime />

      <header>
        <p className="u-data text-[11px] uppercase tracking-[0.18em] text-ink-500 dark:text-paper-200/50">
          {orders.length} {orders.length === 1 ? "order" : "orders"}
        </p>
        <h1 className="mt-1 font-display text-[24px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          Your orders
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
          Status updates here as soon as the team acts on them.
        </p>
      </header>

      {withdrawn === "1" ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-done-500/25 bg-done-50 px-3.5 py-3 text-done-700">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-body text-[13px] leading-relaxed">
            Claim withdrawn. The slot went straight back to the pool, so you can pick it up again
            from the offers page.
          </p>
        </div>
      ) : null}

      {orders.length === 0 ? (
        <div className="u-card mt-5 px-6 py-14 text-center">
          <p className="font-display text-[15px] font-semibold text-ink-900 dark:text-paper-50">
            No orders yet
          </p>
          <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
            Claim a slot from the feed to get started.
          </p>
          <Link href="/app" className="u-btn-primary mt-5">
            Browse offers
          </Link>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {orders.map((order, index) => {
            const tracker = trackerState({
              status: order.status,
              review_submitted_at: order.review_submitted_at,
            });
            const action = nextAction(order);
            const needsUser = action.kind === "order_proof" || action.kind === "review_proof";
            const doneCount = tracker.stages.filter((stage) => stage.done).length;

            return (
              <li
                key={order.id}
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                className="animate-[slide-up_0.4s_cubic-bezier(0.22,1,0.36,1)_both]"
              >
                <Link
                  href={`/app/orders/${order.id}`}
                  className={`u-card block p-4 transition hover:border-ink-900/20 dark:hover:border-white/20 ${
                    needsUser ? "ring-1 ring-inset ring-signal-500/30" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-[15px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                        {order.product?.name ?? "Product removed"}
                      </h2>
                      {order.product?.brand ? (
                        <p className="mt-0.5 truncate font-data text-[11px] uppercase tracking-[0.14em] text-ink-500 dark:text-paper-200/50">
                          {order.product.brand}
                        </p>
                      ) : null}
                    </div>
                    <OrderStatusChip status={order.status} />
                  </div>

                  <div className="mt-3 flex items-center gap-1">
                    {tracker.stages.map((stage, stageIndex) => (
                      <span
                        key={stage.key}
                        className={`h-1 flex-1 rounded-full ${
                          stage.done
                            ? "bg-done-500"
                            : stage.active
                              ? "bg-signal-500"
                              : "bg-paper-200 dark:bg-white/10"
                        }`}
                        style={{ transitionDelay: `${stageIndex * 40}ms` }}
                      />
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <span className="u-data text-[12px] font-semibold text-ink-700 dark:text-paper-100">
                      {doneCount}/{tracker.stages.length} steps
                    </span>
                    {order.product?.cashback_amount !== null &&
                    order.product?.cashback_amount !== undefined ? (
                      <span className="u-data text-[12px] text-ink-600 dark:text-paper-200/70">
                        {formatCurrency(Number(order.product.cashback_amount))} cashback
                      </span>
                    ) : null}
                    <span className="font-body text-[12px] text-ink-500 dark:text-paper-200/50">
                      {formatRelative(order.updated_at)}
                    </span>
                    <IconChevronRight className="ml-auto h-4 w-4 shrink-0 text-ink-500 dark:text-paper-200/50" />
                  </div>

                  {needsUser ? (
                    <p className="mt-3 rounded-xl bg-signal-50 px-3 py-2 font-body text-[12.5px] font-semibold text-signal-700 dark:bg-signal-500/10 dark:text-signal-500">
                      {action.title}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
