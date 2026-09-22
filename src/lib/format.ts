import type { OrderStatus } from "@/lib/types";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return inrFormatter.format(Number(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return formatDate(value);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  claimed: "Claimed",
  order_submitted: "Order submitted",
  order_confirmed: "Order confirmed",
  review_pending: "Review pending",
  review_submitted: "Review submitted",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
};

export const ORDER_STATUS_TONES: Record<
  OrderStatus,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  claimed: "neutral",
  order_submitted: "warning",
  order_confirmed: "info",
  review_pending: "warning",
  review_submitted: "warning",
  approved: "info",
  paid: "success",
  rejected: "danger",
};

/**
 * Claimed against the slots released so far, e.g. "3 / 10". Released never
 * drops below filled, and equals total_slots when the product has no daily
 * release limit.
 */
export function productSlotLabel(product: {
  slots_filled: number;
  released_slots: number;
}): string {
  return `${product.slots_filled} / ${product.released_slots}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
