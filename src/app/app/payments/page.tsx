import type { Metadata } from "next";
import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth";
import { IconWallet } from "@/components/ui/icons";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { OrderStatus, ProductRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payment history" };

type PaidRow = {
  id: string;
  status: OrderStatus;
  payment_reference: string | null;
  paid_at: string | null;
  product: Pick<ProductRow, "id" | "name" | "brand" | "cashback_amount"> | null;
};

const MONTH_KEY = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

function monthKey(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : MONTH_KEY.format(date);
}

export default async function PaymentsPage() {
  const session = await requireUserOrRedirect("/app/payments");

  const { data, error } = await session.supabase
    .from("orders")
    .select("id, status, payment_reference, paid_at, product:products(id, name, brand, cashback_amount)")
    .eq("user_id", session.userId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const rows = (data ?? []) as unknown as PaidRow[];

  const now = new Date();
  const thisMonth = rows.filter((row) => {
    if (!row.paid_at) return false;
    const date = new Date(row.paid_at);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });

  const thisMonthTotal = thisMonth.reduce(
    (total, row) => total + Number(row.product?.cashback_amount ?? 0),
    0,
  );

  // Grouped into calendar months, so a long history reads like a statement
  // rather than one flat list.
  const groups = new Map<string, { rows: PaidRow[]; total: number }>();
  for (const row of rows) {
    const key = monthKey(row.paid_at ?? "");
    const bucket = groups.get(key) ?? { rows: [], total: 0 };
    bucket.rows.push(row);
    bucket.total += Number(row.product?.cashback_amount ?? 0);
    groups.set(key, bucket);
  }

  return (
    <div>
      <header>
        <p className="u-data text-[11px] uppercase tracking-[0.18em] text-ink-500 dark:text-paper-200/50">
          {rows.length} {rows.length === 1 ? "payment" : "payments"}
        </p>
        <h1 className="mt-1 font-display text-[24px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          Payment history
        </h1>
      </header>

      <div className="u-card mt-5 flex items-end justify-between gap-4 p-4">
        <div>
          <p className="font-body text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:text-paper-200/50">
            Paid this month
          </p>
          <p className="u-data mt-2 text-[28px] font-semibold leading-none text-ink-900 dark:text-paper-50">
            {formatCurrency(thisMonthTotal)}
          </p>
        </div>
        <p className="u-data text-[12px] text-ink-500 dark:text-paper-200/50">
          {thisMonth.length} {thisMonth.length === 1 ? "payment" : "payments"}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="u-card mt-5 px-6 py-14 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-paper-100 text-ink-500 dark:bg-white/5 dark:text-paper-200/60">
            <IconWallet className="h-5 w-5" />
          </span>
          <p className="mt-3 font-display text-[15px] font-semibold text-ink-900 dark:text-paper-50">
            No payments yet
          </p>
          <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
            Approved reviews are paid out with a reference you can check against your bank.
          </p>
          <Link href="/app" className="u-btn-primary mt-5">
            Browse offers
          </Link>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {[...groups.entries()].map(([month, group]) => (
            <section key={month}>
              <div className="flex items-baseline justify-between gap-3 pb-2">
                <h2 className="font-body text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:text-paper-200/50">
                  {month}
                </h2>
                <p className="u-data text-[12px] font-semibold text-ink-700 dark:text-paper-100">
                  {formatCurrency(group.total)}
                </p>
              </div>

              <ul className="u-card divide-y divide-paper-300/60 overflow-hidden dark:divide-white/10">
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/app/orders/${row.id}`}
                      className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-paper-100/70 dark:hover:bg-white/5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body text-[14px] font-medium text-ink-900 dark:text-paper-50">
                          {row.product?.name ?? "Product removed"}
                        </p>
                        <p className="mt-0.5 truncate font-data text-[11px] text-ink-500 dark:text-paper-200/50">
                          {row.payment_reference ?? "No reference recorded"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="u-data text-[14px] font-semibold text-done-600">
                          {formatCurrency(Number(row.product?.cashback_amount ?? 0))}
                        </p>
                        <p className="mt-0.5 font-data text-[10px] uppercase tracking-[0.1em] text-ink-500/70 dark:text-paper-200/35">
                          {formatDateTime(row.paid_at)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
