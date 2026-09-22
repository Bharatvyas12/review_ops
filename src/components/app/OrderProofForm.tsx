"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProofUploader, type UploadedProof } from "@/components/app/ProofUploader";
import { IconAlert, IconCheck } from "@/components/ui/icons";
import { ApiClientError, apiRequest } from "@/lib/api-client";

/**
 * Step 2 of an order: the screenshot, then a confirm screen.
 *
 * The machine reads the fields so the user does not have to type them, but the
 * user is the one who confirms them - the wording says so explicitly, every
 * field stays editable, and `user_confirmed` is only set by the server when
 * this form is actually submitted.
 */
export function OrderProofForm({
  orderId,
  defaultName,
  defaultPhone,
}: {
  orderId: string;
  defaultName: string;
  defaultPhone: string | null;
}) {
  const router = useRouter();
  const [proof, setProof] = useState<UploadedProof | null>(null);
  const [fields, setFields] = useState({
    name: defaultName,
    orderRef: "",
    phone: defaultPhone ?? "",
    productName: "",
  });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Prefill from the extraction, but never overwrite something the user has
  // already typed themselves.
  useEffect(() => {
    const extraction = proof?.extraction;
    if (!extraction || touched) return;
    setFields((current) => ({
      name: extraction.name ?? current.name,
      orderRef: extraction.order_id ?? current.orderRef,
      phone: extraction.phone ?? current.phone,
      productName: extraction.product_name ?? current.productName,
    }));
  }, [proof, touched]);

  const update = (key: keyof typeof fields) => (value: string) => {
    setTouched(true);
    setFields((current) => ({ ...current, [key]: value }));
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof) return;

    setError(null);
    setPending(true);

    try {
      await apiRequest(`/api/user/orders/${orderId}/order-proof`, {
        body: {
          screenshotPath: proof.path,
          name: fields.name,
          orderRef: fields.orderRef,
          phone: fields.phone,
          productName: fields.productName,
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

  const read = proof?.extraction ?? null;

  return (
    <div className="u-card p-4 sm:p-5">
      <h2 className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
        1. Upload your order screenshot
      </h2>
      <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
        One image only - the order details page from your Amazon account. We send just that image to
        be read.
      </p>

      <div className="mt-4">
        <ProofUploader purpose="order-proof" value={proof} onChange={setProof} />
      </div>

      {proof ? (
        <form onSubmit={onSubmit} className="mt-6 border-t border-paper-300/70 pt-5 dark:border-white/10">
          <h2 className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
            2. Check what we read
          </h2>

          <div
            className={`mt-2 flex gap-2.5 rounded-xl border p-3 text-[13px] leading-relaxed ${
              read
                ? "border-done-500/25 bg-done-50 text-done-700"
                : "border-paper-300 bg-paper-100/70 text-ink-600 dark:border-white/10 dark:bg-white/5 dark:text-paper-200/70"
            }`}
          >
            {read ? <IconCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <p>
              {read ? (
                <>
                  This is what we read off the screenshot
                  {read.confidence !== "high" ? ` (confidence: ${read.confidence})` : ""}.{" "}
                  <span className="font-semibold">Correct anything that is wrong</span> before you
                  send it.
                </>
              ) : (
                <>
                  We could not read this one automatically. Type the details in yourself - the order
                  id is the part our team needs.
                </>
              )}
            </p>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <label htmlFor="orderRef" className="u-label">
                Order id <span className="text-signal-600">*</span>
              </label>
              <input
                id="orderRef"
                value={fields.orderRef}
                onChange={(event) => update("orderRef")(event.target.value)}
                required
                minLength={3}
                maxLength={200}
                disabled={pending}
                className="u-input u-data"
                placeholder="405-1234567-1234567"
              />
            </div>

            <div>
              <label htmlFor="name" className="u-label">
                Name on the order
              </label>
              <input
                id="name"
                value={fields.name}
                onChange={(event) => update("name")(event.target.value)}
                maxLength={200}
                disabled={pending}
                className="u-input"
                placeholder="Asha Verma"
              />
            </div>

            <div>
              <label htmlFor="phone" className="u-label">
                Phone on the order
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                value={fields.phone}
                onChange={(event) => update("phone")(event.target.value)}
                maxLength={40}
                disabled={pending}
                className="u-input u-data"
                placeholder="98765 43210"
              />
            </div>

            <div>
              <label htmlFor="productName" className="u-label">
                Product
              </label>
              <input
                id="productName"
                value={fields.productName}
                onChange={(event) => update("productName")(event.target.value)}
                maxLength={300}
                disabled={pending}
                className="u-input"
                placeholder="As shown on the order"
              />
            </div>
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
            disabled={pending || fields.orderRef.trim().length < 3}
            className="u-btn-primary mt-5 w-full sm:w-auto sm:px-6"
          >
            {pending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Submitting
              </>
            ) : (
              "Confirm and send for checking"
            )}
          </button>
        </form>
      ) : null}
    </div>
  );
}
