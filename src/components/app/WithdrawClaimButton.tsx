"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { IconAlert } from "@/components/ui/icons";

/**
 * "Give this slot back" for a claim that has not been submitted yet.
 *
 * Deliberately two taps: the first opens a confirmation that spells out what
 * happens to the slot, and only the second calls the server. Withdrawing is
 * cheap to undo (claim again) but easy to tap by accident, and the consequence
 * - losing the slot to somebody else - is not obvious from the button alone.
 */
export function WithdrawClaimButton({
  orderId,
  productName,
}: {
  orderId: string;
  productName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, pending]);

  async function withdraw() {
    setError(null);
    setPending(true);

    try {
      await apiRequest(`/api/user/orders/${orderId}/withdraw`, { body: {} });
      // The order row is gone, so send them back to the list rather than
      // leaving them on a detail page that no longer resolves.
      router.push("/app/orders?withdrawn=1");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Could not withdraw that claim. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-btn-ghost w-full !justify-start !px-3 !text-[13px] text-ink-500 hover:!bg-signal-50 hover:!text-signal-700 dark:hover:!bg-signal-500/10"
      >
        Withdraw this claim
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center">
          <button
            type="button"
            aria-label="Close"
            onClick={() => (pending ? undefined : setOpen(false))}
            className="fixed inset-0 cursor-default bg-ink-900/50 backdrop-blur-sm"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Withdraw this claim"
            className="relative z-10 my-8 w-full max-w-md overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 shadow-2xl dark:border-white/10 dark:bg-ink-900"
          >
            <div className="flex gap-3 border-b border-paper-300/70 p-5 dark:border-white/10">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal-50 text-signal-600">
                <IconAlert className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
                  Give the slot back?
                </h2>
                <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
                  {productName ? `Your claim on ${productName} is dropped. ` : "Your claim is dropped. "}
                  The slot returns to the pool straight away and anybody else can take it.
                </p>
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="font-body text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
                Nothing has been sent to the team yet, so there is nothing to cancel. You can claim
                this product again later if slots are still free.
              </p>

              {error ? (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-signal-500/30 bg-signal-50 px-3.5 py-3 text-[13px] font-medium text-signal-700"
                >
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-paper-300/70 bg-paper-100/60 p-4 sm:flex-row sm:justify-end dark:border-white/10 dark:bg-white/5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="u-btn-secondary !py-2.5 !text-[14px]"
              >
                Keep my claim
              </button>
              <button
                type="button"
                onClick={withdraw}
                disabled={pending}
                className="u-btn !bg-signal-600 !py-2.5 !text-[14px] !text-white hover:!bg-signal-700"
              >
                {pending ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Withdrawing
                  </>
                ) : (
                  "Yes, withdraw"
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}