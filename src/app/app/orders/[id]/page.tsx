import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { OrdersRealtime } from "@/components/app/OrdersRealtime";
import { OrderStatusChip } from "@/components/app/OrderStatusChip";
import { StatusTracker } from "@/components/app/StatusTracker";
import { OrderProofForm } from "@/components/app/OrderProofForm";
import { WithdrawClaimButton } from "@/components/app/WithdrawClaimButton";
import { ReviewProofForm } from "@/components/app/ReviewProofForm";
import { IconAlert, IconCheck, IconChevronRight, IconExternal } from "@/components/ui/icons";
import { SCREENSHOT_BUCKET, createSignedImageUrl, screenshotTtlSeconds } from "@/lib/storage";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { nextAction } from "@/lib/user-orders";
import type { OrderRow, ProductRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Order" };

type DetailOrder = OrderRow & {
  product: Pick<ProductRow, "id" | "name" | "brand" | "cashback_amount"> | null;
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 font-body text-[12px] uppercase tracking-[0.12em] text-ink-500 dark:text-paper-200/50">
        {label}
      </dt>
      <dd className="min-w-0 truncate font-body text-[13px] font-medium text-ink-800 dark:text-paper-100">
        {value}
      </dd>
    </div>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireUserOrRedirect();
  const { id } = await params;

  // The id comes from the URL, so ownership is asserted in the query itself.
  // RLS would also deny a foreign row, but this route never relies on that
  // alone - guessing somebody else's id must fail here too.
  const { data, error } = await session.supabase
    .from("orders")
    .select("*, product:products(id, name, brand, cashback_amount)")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) notFound();

  const order = data as unknown as DetailOrder;

  const admin = createAdminSupabaseClient();
  const ttl = screenshotTtlSeconds();
  const [orderShot, reviewShot] = await Promise.all([
    createSignedImageUrl(admin, SCREENSHOT_BUCKET, order.order_screenshot_url ?? "", ttl),
    createSignedImageUrl(admin, SCREENSHOT_BUCKET, order.review_screenshot_url ?? "", ttl),
  ]);

  const action = nextAction(order);

  return (
    <div>
      <OrdersRealtime />

      <Link
        href="/app/orders"
        className="inline-flex items-center gap-1 font-body text-[13px] font-medium text-ink-500 transition hover:text-ink-800 dark:text-paper-200/60 dark:hover:text-paper-50"
      >
        <IconChevronRight className="h-3.5 w-3.5 rotate-180" />
        All orders
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink-900 dark:text-paper-50">
            {order.product?.name ?? "Product removed"}
          </h1>
          {order.product?.brand ? (
            <p className="mt-0.5 font-data text-[11px] uppercase tracking-[0.14em] text-ink-500 dark:text-paper-200/50">
              {order.product.brand}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {order.product?.cashback_amount !== null && order.product?.cashback_amount !== undefined ? (
            <span className="u-data text-[15px] font-semibold text-ink-900 dark:text-paper-50">
              {formatCurrency(Number(order.product.cashback_amount))}
            </span>
          ) : null}
          <OrderStatusChip status={order.status} />
        </div>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <StatusTracker
            status={order.status}
            rejectionReason={order.rejection_reason}
            reviewSubmittedAt={order.review_submitted_at}
          />

          {action.kind === "waiting" ? (
            <div className="u-card flex gap-3 p-4">
              <IconCheck className="mt-0.5 h-5 w-5 shrink-0 text-done-500" />
              <div>
                <p className="font-body text-[14px] font-semibold text-ink-900 dark:text-paper-50">
                  {action.title}
                </p>
                <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
                  {action.body}
                </p>
              </div>
            </div>
          ) : null}

          {order.status === "approved" ? (
            <Link
              href="/app/settings"
              className="u-card flex items-center gap-3 p-4 transition hover:border-ink-900/20 dark:hover:border-white/20"
            >
              <IconAlert className="h-5 w-5 shrink-0 text-signal-600" />
              <div className="min-w-0">
                <p className="font-body text-[14px] font-semibold text-ink-900 dark:text-paper-50">
                  Add your payout details
                </p>
                <p className="mt-0.5 font-body text-[13px] text-ink-500 dark:text-paper-200/60">
                  Cashback can only be sent once a bank account or UPI id is on file.
                </p>
              </div>
              <IconChevronRight className="ml-auto h-4 w-4 shrink-0 text-ink-500" />
            </Link>
          ) : null}

          {order.status === "paid" ? (
            <div className="u-card overflow-hidden">
              <div className="flex items-center gap-2.5 border-b border-paper-300/70 bg-done-50 px-4 py-3 dark:border-white/10 dark:bg-done-500/10">
                <IconCheck className="h-4 w-4 text-done-600" />
                <p className="font-body text-[14px] font-semibold text-done-700">Cashback sent</p>
              </div>
              <dl className="divide-y divide-paper-300/60 px-4 py-2 dark:divide-white/10">
                <Field label="Reference" value={order.payment_reference} />
                <Field label="Paid on" value={formatDateTime(order.paid_at)} />
              </dl>
            </div>
          ) : null}

          {/* Only a claim that has not been sent to the team can be released.
              Once the screenshot is in, the row belongs to the admin queue. */}
          {order.status === "claimed" ? (
            <div className="u-card p-1.5">
              <WithdrawClaimButton
                orderId={order.id}
                productName={order.product?.name ?? null}
              />
            </div>
          ) : null}

          <div className="u-card">
            <h2 className="border-b border-paper-300/70 px-4 py-3 font-body text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:border-white/10 dark:text-paper-200/50">
              What we have on file
            </h2>
            <dl className="divide-y divide-paper-300/60 px-4 py-1 dark:divide-white/10">
              <Field label="Order id" value={order.extracted_order_id} />
              <Field label="Name" value={order.extracted_name} />
              <Field label="Phone" value={order.extracted_phone} />
              <Field label="Product" value={order.extracted_product_name} />
              <Field label="Claimed on" value={formatDateTime(order.created_at)} />
              {order.review_link ? (
                <div className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="shrink-0 font-body text-[12px] uppercase tracking-[0.12em] text-ink-500 dark:text-paper-200/50">
                    Review
                  </dt>
                  <dd className="min-w-0">
                    <a
                      href={order.review_link}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1.5 font-body text-[13px] font-medium text-signal-600 hover:underline"
                    >
                      Open review
                      <IconExternal className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>

        <div className="space-y-5">
          {action.kind === "order_proof" ? (
            <OrderProofForm
              orderId={order.id}
              defaultName={order.extracted_name ?? session.profile.full_name}
              defaultPhone={order.extracted_phone ?? session.profile.phone}
            />
          ) : null}

          {action.kind === "review_proof" ? (
            <ReviewProofForm orderId={order.id} productName={order.product?.name ?? null} />
          ) : null}

          {orderShot ? (
            <figure className="u-card overflow-hidden">
              <figcaption className="border-b border-paper-300/70 px-4 py-2.5 font-body text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:border-white/10 dark:text-paper-200/50">
                Order screenshot
              </figcaption>
              <img
                src={orderShot}
                alt="Order screenshot you submitted"
                className="w-full object-contain"
              />
            </figure>
          ) : null}

          {reviewShot || order.review_link ? (
            <figure className="u-card overflow-hidden">
              <figcaption className="border-b border-paper-300/70 px-4 py-2.5 font-body text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:border-white/10 dark:text-paper-200/50">
                Review proof
              </figcaption>
              {reviewShot ? (
                <img
                  src={reviewShot}
                  alt="Review screenshot you submitted"
                  className="w-full object-contain"
                />
              ) : (
                <p className="truncate px-4 py-3">
                  <a
                    href={order.review_link ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="font-body text-[13px] font-medium text-signal-600 hover:underline"
                  >
                    {order.review_link}
                  </a>
                </p>
              )}
            </figure>
          ) : null}
        </div>
      </div>
    </div>
  );
}
