"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProofUploader, type UploadedProof } from "@/components/app/ProofUploader";
import { ApiClientError, apiRequest } from "@/lib/api-client";

/**
 * Step 4 of an order: review proof.
 *
 * Either a screenshot of the published review or a link to it - one of the two
 * is required, and the server enforces the same rule. A link is checked to be a
 * real https URL on both sides before it is stored.
 */
export function ReviewProofForm({
  orderId,
  productName,
}: {
  orderId: string;
  productName: string | null;
}) {
  const router = useRouter();
  const [proof, setProof] = useState<UploadedProof | null>(null);
  const [reviewLink, setReviewLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const linkLooksValid = reviewLink.trim() === "" || /^https?:\/\/[^\s]+$/i.test(reviewLink.trim());
  const canSubmit = Boolean(proof || reviewLink.trim()) && linkLooksValid;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await apiRequest(`/api/user/orders/${orderId}/review-proof`, {
        body: {
          screenshotPath: proof?.path ?? null,
          reviewLink: reviewLink.trim() || null,
        },
      });
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Could not submit that. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="u-card p-4 sm:p-5">
      <h2 className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
        Submit your review
      </h2>
      <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
        {productName ? `Publish your review for ${productName}, then ` : "Publish your review, then "}
        send us a screenshot or the link. Either one works.
      </p>

      <div className="mt-4">
        <ProofUploader
          purpose="review-proof"
          value={proof}
          onChange={setProof}
          hint="Screenshot of the published review, up to 5 MB"
        />
      </div>

      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-paper-300 dark:bg-white/10" />
        <span className="font-body text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:text-paper-200/50">
          or
        </span>
        <span className="h-px flex-1 bg-paper-300 dark:bg-white/10" />
      </div>

      <div>
        <label htmlFor="reviewLink" className="u-label">
          Link to the review
        </label>
        <input
          id="reviewLink"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          value={reviewLink}
          onChange={(event) => setReviewLink(event.target.value)}
          disabled={pending}
          className="u-input u-data !text-[13px]"
          placeholder="https://www.amazon.in/gp/customer-reviews/..."
        />
        {!linkLooksValid ? (
          <p className="mt-1.5 font-body text-[12px] font-medium text-signal-700 dark:text-signal-500">
            Enter a full link starting with https://
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-signal-500/30 bg-signal-50 px-3.5 py-3 text-[13px] font-medium text-signal-700"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !canSubmit}
        className="u-btn-primary mt-5 w-full sm:w-auto sm:px-6"
      >
        {pending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Submitting
          </>
        ) : (
          "Send review for approval"
        )}
      </button>
    </form>
  );
}
