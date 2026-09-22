import type { OrderStatus } from "@/lib/types";
import { ORDER_STATUS_LABELS } from "@/lib/format";

/**
 * Status chip in the user panel's own palette.
 *
 * Deliberately separate from the admin Badge: the console reads cool and dense,
 * this reads warm, and mixing the two sets of tones in one screen is what makes
 * an app look assembled from parts.
 */
const TONES: Record<OrderStatus, string> = {
  claimed: "bg-paper-200 text-ink-700 ring-ink-900/10 dark:bg-white/10 dark:text-paper-100 dark:ring-white/10",
  order_submitted:
    "bg-signal-50 text-signal-700 ring-signal-500/25 dark:bg-signal-500/10 dark:text-signal-500 dark:ring-signal-500/25",
  order_confirmed: "bg-done-50 text-done-700 ring-done-500/25 dark:bg-done-500/10 dark:text-done-500 dark:ring-done-500/25",
  review_pending:
    "bg-signal-50 text-signal-700 ring-signal-500/25 dark:bg-signal-500/10 dark:text-signal-500 dark:ring-signal-500/25",
  review_submitted:
    "bg-signal-50 text-signal-700 ring-signal-500/25 dark:bg-signal-500/10 dark:text-signal-500 dark:ring-signal-500/25",
  approved: "bg-done-50 text-done-700 ring-done-500/25 dark:bg-done-500/10 dark:text-done-500 dark:ring-done-500/25",
  paid: "bg-done-500 text-white ring-done-600/40",
  rejected:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25",
};

export function OrderStatusChip({ status }: { status: OrderStatus }) {
  return (
    <span className={`u-chip ${TONES[status]}`}>{ORDER_STATUS_LABELS[status]}</span>
  );
}
