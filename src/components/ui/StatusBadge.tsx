import type { OrderStatus, ProductStatus } from "@/lib/types";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from "@/lib/format";

type Tone = "neutral" | "info" | "warning" | "success" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  neutral:
    "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  info: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25",
  warning:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  success:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  danger:
    "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return <span className={`badge ${TONE_CLASSES[tone]}`}>{children}</span>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge tone={status === "open" ? "success" : "neutral"}>
      {status === "open" ? "Open" : "Closed"}
    </Badge>
  );
}
