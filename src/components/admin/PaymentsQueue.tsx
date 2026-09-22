"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/StatusBadge";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { IconEye, IconShield } from "@/components/ui/icons";
import { apiRequest } from "@/lib/api-client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { formatCurrency, formatDateTime, formatRelative, initials } from "@/lib/format";

export type PaymentRow = {
  orderId: string;
  userName: string;
  userPhone: string | null;
  productName: string | null;
  productBrand: string | null;
  cashbackAmount: number | null;
  approvedAt: string | null;
  bank: {
    accountHolderName: string | null;
    accountNumberLast4: string | null;
    ifscCode: string | null;
    upiId: string | null;
  } | null;
};

type RevealedDetails = {
  accountNumber: string;
  accountHolderName: string | null;
  accountNumberLast4: string | null;
  ifscCode: string | null;
  upiId: string | null;
  auditedAt: string;
};

export function PaymentsQueue({ rows }: { rows: PaymentRow[] }) {
  const router = useRouter();
  const toast = useToast();
  useRealtimeRefresh("orders");

  const [revealed, setRevealed] = useState<Record<string, RevealedDetails>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<PaymentRow | null>(null);
  const [payRow, setPayRow] = useState<PaymentRow | null>(null);
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  async function reveal(row: PaymentRow) {
    setRevealingId(row.orderId);
    try {
      const result = await apiRequest<RevealedDetails>(
        `/api/admin/payments/${row.orderId}`,
        { body: { action: "reveal" } },
      );
      setRevealed((current) => ({ ...current, [row.orderId]: result }));
      toast.toast("Bank account revealed", {
        description: "This access was recorded in the audit log.",
        tone: "info",
      });
    } catch (error) {
      toast.failure(
        "Could not reveal the account",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setRevealingId(null);
    }
  }

  async function markPaid() {
    if (!payRow) return;
    setSaving(true);
    try {
      await apiRequest(`/api/admin/payments/${payRow.orderId}`, {
        body: { action: "mark_paid", paymentReference: reference.trim() },
      });
      toast.success("Marked as paid", `${payRow.userName} was notified of the payment.`);
      setPayRow(null);
      setReference("");
      router.refresh();
    } catch (error) {
      toast.failure("Could not mark as paid", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No approved orders are waiting for payment"
          description="Approve reviews first; approved orders land here with the payout details."
          icon="₹"
        />
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] border-collapse text-left">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-4 py-3 font-semibold">Cashback</th>
                <th className="px-4 py-3 font-semibold">Approved</th>
                <th className="px-4 py-3 font-semibold">Payout details</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {rows.map((row) => {
                const details = revealed[row.orderId];
                const missingBank = !row.bank?.accountNumberLast4 && !row.bank?.upiId;
                return (
                  <tr key={row.orderId} className="transition hover:bg-slate-50/70 dark:hover:bg-white/5">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                          {initials(row.userName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900 dark:text-white">
                            {row.userName}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {row.userPhone ?? "No phone"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <p className="truncate font-medium text-slate-900 dark:text-white">
                        {row.productName ?? "Unknown product"}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {row.productBrand ?? "No brand"}
                      </p>
                    </td>
                    <td className="table-cell font-medium text-slate-900 dark:text-white">
                      {formatCurrency(row.cashbackAmount)}
                    </td>
                    <td className="table-cell whitespace-nowrap">
                      {formatRelative(row.approvedAt)}
                      <span className="block text-xs text-slate-400 dark:text-slate-500">
                        {row.approvedAt ? formatDateTime(row.approvedAt) : "—"}
                      </span>
                    </td>
                    <td className="table-cell">
                      {missingBank ? (
                        <span className="text-xs text-amber-700 dark:text-amber-300">
                          No bank details
                        </span>
                      ) : (
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm text-slate-700 dark:text-slate-300" style={{ maxWidth: "18rem" }}>
                            {[
                              row.bank?.accountHolderName,
                              row.bank?.accountNumberLast4
                                ? `•••• ${row.bank.accountNumberLast4}`
                                : null,
                              row.bank?.ifscCode ?? row.bank?.upiId,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <button
                            type="button"
                            title="View payout details"
                            onClick={() => setViewRow(row)}
                            className="btn-ghost shrink-0 rounded p-1 text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300"
                          >
                            <IconEye className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="table-cell">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setReference("");
                            setPayRow(row);
                          }}
                          className="btn-primary btn-sm whitespace-nowrap"
                        >
                          Mark as paid
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
        open={payRow !== null}
        onClose={() => setPayRow(null)}
        title="Mark as paid"
        description="The reference is stored on the order and shown to the user."
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setPayRow(null)} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={reference.trim().length < 3 || saving}
              onClick={() => void markPaid()}
              className="btn-primary"
            >
              {saving ? "Saving" : "Confirm payment"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Paying {formatCurrency(payRow?.cashbackAmount ?? null)} to {payRow?.userName}.
        </p>
        <div className="mt-4">
          <label htmlFor="payment-reference" className="label">
            Payment reference / UTR
          </label>
          <input
            id="payment-reference"
            value={reference}
            maxLength={120}
            onChange={(event) => setReference(event.target.value)}
            className="input font-mono"
            placeholder="UTR123456789"
          />
        </div>
      </Modal>

      {/* ── Payout details modal ───────────────────────────────────────── */}
      {(() => {
        const vr = viewRow;
        if (!vr) return null;
        const det = revealed[vr.orderId];
        const missingAcct = !vr.bank?.accountNumberLast4;
        return (
          <Modal
            open={viewRow !== null}
            onClose={() => setViewRow(null)}
            title="Payout details"
            description={`Bank / UPI details on file for ${vr.userName}`}
            size="sm"
            footer={
              <button type="button" onClick={() => setViewRow(null)} className="btn-secondary">
                Close
              </button>
            }
          >
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400">Holder</dt>
                <dd className="text-right font-medium text-slate-900 dark:text-slate-100">
                  {det?.accountHolderName ?? vr.bank?.accountHolderName ?? "Not provided"}
                </dd>
              </div>
              {!missingAcct && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Account</dt>
                  <dd className="text-right font-mono font-medium text-slate-900 dark:text-slate-100">
                    {det
                      ? det.accountNumber
                      : `•••• •••• ${vr.bank!.accountNumberLast4}`}
                  </dd>
                </div>
              )}
              {(vr.bank?.ifscCode || det?.ifscCode) && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">IFSC</dt>
                  <dd className="text-right font-mono font-medium text-slate-900 dark:text-slate-100">
                    {det?.ifscCode ?? vr.bank?.ifscCode}
                  </dd>
                </div>
              )}
              {vr.bank?.upiId && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">UPI</dt>
                  <dd className="text-right font-medium text-slate-900 dark:text-slate-100">
                    {vr.bank.upiId}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 dark:border-white/10">
              {det ? (
                <>
                  <CopyButton value={det.accountNumber} label="Copy account number" />
                  <Badge tone="info">
                    <IconShield className="h-3 w-3" /> Reveal logged
                  </Badge>
                </>
              ) : !missingAcct ? (
                <button
                  type="button"
                  disabled={revealingId === vr.orderId}
                  onClick={() => void reveal(vr)}
                  className="btn-secondary btn-sm"
                >
                  {revealingId === vr.orderId ? "Revealing…" : "Reveal full number"}
                </button>
              ) : null}
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
