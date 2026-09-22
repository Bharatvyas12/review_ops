"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { IconClock, IconExternal, IconShield } from "@/components/ui/icons";
import { apiRequest } from "@/lib/api-client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { formatCurrency, formatDateTime, formatRelative, initials } from "@/lib/format";

export type QueueItem = {
  id: string;
  userName: string;
  userPhone: string | null;
  productName: string | null;
  productBrand: string | null;
  cashbackAmount: number | null;
  createdAt: string;
  updatedAt: string;
  screenshotUrl: string | null;
  reviewLink: string | null;
  extracted: {
    name: string | null;
    orderId: string | null;
    phone: string | null;
    productName: string | null;
  } | null;
  userConfirmed: boolean;
};

type Kind = "review";

/** Which timestamp the queue can be ordered by. */
const SORT_FIELDS = [
  { key: "updatedAt" as const, label: "Submitted" },
  { key: "createdAt" as const, label: "Claimed" },
];

const DIRECTIONS = [
  { key: "asc" as const, label: "Oldest first" },
  { key: "desc" as const, label: "Newest first" },
];

const COPY: Record<Kind, { queue: string; empty: string; approve: string; reject: string; proof: string }> = {
  review: {
    queue: "review approval",
    empty: "No reviews are waiting for approval.",
    approve: "Approve review",
    reject: "Reject review",
    proof: "Review screenshot",
  },
};

export function SubmissionQueue({ kind, items }: { kind: Kind; items: QueueItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [rejecting, setRejecting] = useState<QueueItem | null>(null);
  const [reason, setReason] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<"updatedAt" | "createdAt">("updatedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  useRealtimeRefresh("orders");

  const copy = COPY[kind];
  const endpoint = "/api/admin/reviews";

  // Ordering is done here rather than in the query because the page already
  // ships the whole queue in one round trip: re-sorting costs nothing and the
  // admin can flip between "oldest first" (fair, first in first out) and
  // "newest first" without a server hop.
  const sorted = useMemo(() => {
    const factor = direction === "asc" ? 1 : -1;
    return [...items].sort((left, right) => {
      const a = new Date(left[sortField]).getTime();
      const b = new Date(right[sortField]).getTime();
      if (a === b) return left.userName.localeCompare(right.userName) * factor;
      return (a - b) * factor;
    });
  }, [items, sortField, direction]);

  async function submit(item: QueueItem, action: "approve" | "reject", rejectionReason?: string) {
    setPendingId(item.id);
    try {
      await apiRequest(`${endpoint}/${item.id}`, {
        body:
          action === "approve"
            ? { action: "approve" }
            : { action: "reject", reason: rejectionReason ?? "" },
      });
      toast.success(
        action === "approve" ? "Approved" : "Rejected",
        action === "approve"
          ? `${item.userName} was notified and the next step is unlocked.`
          : `${item.userName} was notified with your reason.`,
      );
      setSelected(null);
      setRejecting(null);
      setReason("");
      router.refresh();
    } catch (error) {
      toast.failure(
        "Could not save that decision",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="card">
        <EmptyState title={`Nothing in the ${copy.queue} queue`} description={copy.empty} icon="✓" />
      </div>
    );
  }

  const segment = (active: boolean) =>
    `cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition ${
      active
        ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
    }`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Sort by
          </span>
          <div
            role="group"
            aria-label="Sort by which date"
            className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-slate-900"
          >
            {SORT_FIELDS.map((field) => (
              <button
                key={field.key}
                type="button"
                aria-pressed={sortField === field.key}
                onClick={() => setSortField(field.key)}
                className={segment(sortField === field.key)}
              >
                {field.label}
              </button>
            ))}
          </div>
        </div>

        <div
          role="group"
          aria-label="Sort direction"
          className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-slate-900"
        >
          {DIRECTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={direction === option.key}
              onClick={() => setDirection(option.key)}
              className={segment(direction === option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {direction === "asc" ? "Longest waiting first" : "Most recent first"} ·{" "}
          {sortField === "updatedAt" ? "by submission time" : "by claim time"}
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] border-collapse text-left">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-4 py-3 font-semibold">Cashback</th>
                <th className="px-4 py-3 font-semibold">Confirmation</th>
                <th className="px-4 py-3 font-semibold">Claimed</th>
                <th className="px-4 py-3 font-semibold">Submitted</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {sorted.map((item) => {
                const busy = pendingId === item.id;
                return (
                  <tr key={item.id} className="transition hover:bg-slate-50/70 dark:hover:bg-white/5">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                          {initials(item.userName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900 dark:text-white">
                            {item.userName}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {item.userPhone ?? "No phone"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <p className="truncate font-medium text-slate-900 dark:text-white">
                        {item.productName ?? "Unknown product"}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {item.productBrand ?? "No brand"}
                      </p>
                    </td>
                    <td className="table-cell font-medium text-slate-900 dark:text-white">
                      {formatCurrency(item.cashbackAmount)}
                    </td>
                    <td className="table-cell">
                      {item.userConfirmed ? (
                        <Badge tone="info">
                          <IconShield className="h-3 w-3" /> User confirmed
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Awaiting user confirmation</Badge>
                      )}
                    </td>
                    <td className="table-cell whitespace-nowrap text-slate-500 dark:text-slate-400">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="table-cell whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <IconClock className="h-3.5 w-3.5 text-slate-400" />
                        {formatRelative(item.updatedAt)}
                      </span>
                      <span className="block text-xs text-slate-400 dark:text-slate-500">
                        {formatDateTime(item.updatedAt)}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(item)}
                          className="btn-secondary btn-sm"
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submit(item, "approve")}
                          className="btn-primary btn-sm"
                        >
                          {busy ? "Saving" : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setReason("");
                            setRejecting(item);
                          }}
                          className="btn-secondary btn-sm text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={`Review from ${selected?.userName ?? ""}`}
        description="Check the proof against the extracted details before deciding."
        size="lg"
        footer={
          selected ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setReason("");
                  setRejecting(selected);
                  setSelected(null);
                }}
                className="btn-secondary text-rose-600 dark:text-rose-300"
              >
                {COPY[kind].reject}
              </button>
              <button
                type="button"
                disabled={pendingId === selected.id}
                onClick={() => void submit(selected, "approve")}
                className="btn-primary"
              >
                {pendingId === selected.id ? "Saving" : COPY[kind].approve}
              </button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-5">
            {selected.reviewLink ? (
              <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Review link
                </p>
                <a
                  href={selected.reviewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-2 truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-300"
                >
                  <span className="truncate">{selected.reviewLink}</span>
                  <IconExternal className="h-3.5 w-3.5 shrink-0" />
                </a>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {copy.proof}
              </p>
              {selected.screenshotUrl ? (
                <a
                  href={selected.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950"
                >
                  <img
                    src={selected.screenshotUrl}
                    alt={copy.proof}
                    className="max-h-[26rem] w-full object-contain"
                  />
                </a>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No screenshot was attached.
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Served from a private bucket through a short-lived signed link.
              </p>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={COPY[kind].reject}
        description="The reason is stored on the order and shown to the user."
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setRejecting(null)} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={reason.trim().length < 3 || pendingId === rejecting?.id}
              onClick={() => rejecting && void submit(rejecting, "reject", reason.trim())}
              className="btn-danger"
            >
              {pendingId === rejecting?.id ? "Saving" : "Confirm rejection"}
            </button>
          </>
        }
      >
        <label htmlFor="rejection-reason" className="label">
          Reason
        </label>
        <textarea
          id="rejection-reason"
          rows={4}
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          className="input resize-none"
          placeholder="The order id on the screenshot does not match the account."
        />
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {reason.trim().length}/1000 · at least 3 characters
        </p>
      </Modal>
    </>
  );
}
