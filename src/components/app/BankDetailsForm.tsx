"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { IconCheck, IconShield } from "@/components/ui/icons";

export type MaskedBankDetails = {
  account_holder_name: string | null;
  account_number_last4: string | null;
  ifsc_code: string | null;
  upi_id: string | null;
};

/**
 * Payout details.
 *
 * The account number goes up once and never comes back: the server encrypts it
 * and the only thing this screen ever shows afterwards is the last four digits.
 * Blank means "keep what is already stored", so saving a change to the UPI id
 * does not wipe the bank account.
 */
export function BankDetailsForm({ initial }: { initial: MaskedBankDetails | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState<MaskedBankDetails | null>(initial);
  const [form, setForm] = useState({
    accountHolderName: initial?.account_holder_name ?? "",
    accountNumber: "",
    ifscCode: initial?.ifsc_code ?? "",
    upiId: initial?.upi_id ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const update = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    setJustSaved(false);

    try {
      const result = await apiRequest<{ bankDetails: MaskedBankDetails | null }>(
        "/api/user/bank-details",
        {
          body: {
            accountHolderName: form.accountHolderName || null,
            accountNumber: form.accountNumber || null,
            ifscCode: form.ifscCode || null,
            upiId: form.upiId || null,
          },
        },
      );

      setSaved(result.bankDetails);
      // Clearing the number field is the point: the plaintext is gone from the
      // browser the moment it has been sent.
      setForm((current) => ({ ...current, accountNumber: "" }));
      setJustSaved(true);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Could not save that. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      {saved?.account_number_last4 || saved?.upi_id ? (
        <div className="u-card overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-paper-300/70 bg-paper-100/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
            <IconShield className="h-4 w-4 text-done-600" />
            <p className="font-body text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-600 dark:text-paper-200/70">
              On file
            </p>
          </div>
          <dl className="divide-y divide-paper-300/60 px-4 py-2 dark:divide-white/10">
            {saved.account_number_last4 ? (
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="font-body text-[12px] uppercase tracking-[0.12em] text-ink-500 dark:text-paper-200/50">
                  Bank account
                </dt>
                <dd className="u-data text-[14px] font-semibold text-ink-900 dark:text-paper-50">
                  •••• {saved.account_number_last4}
                </dd>
              </div>
            ) : null}
            {saved.ifsc_code ? (
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="font-body text-[12px] uppercase tracking-[0.12em] text-ink-500 dark:text-paper-200/50">
                  IFSC
                </dt>
                <dd className="u-data text-[13px] font-medium text-ink-800 dark:text-paper-100">
                  {saved.ifsc_code}
                </dd>
              </div>
            ) : null}
            {saved.upi_id ? (
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="font-body text-[12px] uppercase tracking-[0.12em] text-ink-500 dark:text-paper-200/50">
                  UPI
                </dt>
                <dd className="u-data text-[13px] font-medium text-ink-800 dark:text-paper-100">
                  {saved.upi_id}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="u-card p-4 sm:p-5">
        <h2 className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          {saved?.account_number_last4 || saved?.upi_id ? "Change payout details" : "Add payout details"}
        </h2>
        <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
          Cashback is sent here once a review is approved. A bank account or a UPI id is enough.
        </p>

        {justSaved ? (
          <p
            role="status"
            className="mt-4 flex items-center gap-2 rounded-xl border border-done-500/25 bg-done-50 px-3.5 py-3 text-[13px] font-medium text-done-700"
          >
            <IconCheck className="h-4 w-4" />
            Saved. The change is recorded against your account.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-signal-500/30 bg-signal-50 px-3.5 py-3 text-[13px] font-medium text-signal-700"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="accountHolderName" className="u-label">
              Account holder name
            </label>
            <input
              id="accountHolderName"
              autoComplete="name"
              value={form.accountHolderName}
              onChange={(event) => update("accountHolderName")(event.target.value)}
              disabled={pending}
              maxLength={120}
              className="u-input"
              placeholder="As printed on the bank account"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="accountNumber" className="u-label">
              Account number
            </label>
            <input
              id="accountNumber"
              inputMode="numeric"
              autoComplete="off"
              value={form.accountNumber}
              onChange={(event) => update("accountNumber")(event.target.value.replace(/[^0-9]/g, ""))}
              disabled={pending}
              maxLength={34}
              className="u-input u-data"
              placeholder={
                saved?.account_number_last4
                  ? `Stored: •••• ${saved.account_number_last4} - leave blank to keep`
                  : "6 to 34 digits"
              }
            />
          </div>

          <div>
            <label htmlFor="ifscCode" className="u-label">
              IFSC
            </label>
            <input
              id="ifscCode"
              value={form.ifscCode}
              onChange={(event) => update("ifscCode")(event.target.value.toUpperCase())}
              disabled={pending}
              maxLength={20}
              className="u-input u-data"
              placeholder="HDFC0001234"
            />
          </div>

          <div>
            <label htmlFor="upiId" className="u-label">
              UPI id
            </label>
            <input
              id="upiId"
              value={form.upiId}
              onChange={(event) => update("upiId")(event.target.value)}
              disabled={pending}
              maxLength={256}
              className="u-input u-data !text-[13px]"
              placeholder="name@bank"
            />
          </div>
        </div>

        <p className="mt-4 flex gap-2.5 rounded-xl bg-paper-100/80 p-3 font-body text-[12px] leading-relaxed text-ink-600 dark:bg-white/5 dark:text-paper-200/70">
          <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-done-600" />
          <span>
            Your account number is encrypted before it is stored and is never shown back to you or
            to anyone else in this app. Only the payment operator can reveal it to make a transfer,
            and every reveal is recorded in the audit log.
          </span>
        </p>

        <button type="submit" disabled={pending} className="u-btn-primary mt-5 w-full sm:w-auto sm:px-6">
          {pending ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Saving
            </>
          ) : (
            "Save payout details"
          )}
        </button>
      </form>
    </div>
  );
}
