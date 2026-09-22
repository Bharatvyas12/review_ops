"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { SlotMeter } from "@/components/app/SlotMeter";
import { IconCheck, IconChevronRight, IconImage } from "@/components/ui/icons";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { useLiveSlots } from "@/lib/use-live-slots";
import { formatCurrency } from "@/lib/format";
import { isSoldOut, slotsLeft } from "@/lib/user-orders";

export type ProductFeedItem = {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  totalSlots: number;
  slotsFilled: number;
  releasedSlots: number;
  cashbackAmount: number | null;
};

type ClaimState = "idle" | "claiming" | "missed" | "done";

/**
 * The product feed.
 *
 * Deliberately not a grid of identical rounded cards. These are repeated,
 * scannable items with three things that matter - what it is, how much
 * cashback, how many slots are left - so it is laid out as a ledger: one row
 * per product, a colour rule down the left edge carrying the state, and the
 * numbers in tabular mono so a column of them can be read at a glance.
 *
 * Slot counts are wired to Realtime through useLiveSlots(), so a claim by
 * somebody else moves the number here without a refresh.
 */
export function ProductFeed({ products }: { products: ProductFeedItem[] }) {
  const router = useRouter();
  const [states, setStates] = useState<Record<string, ClaimState>>({});
  const [error, setError] = useState<string | null>(null);

  const { slots, changedId, applyClaim, markChanged } = useLiveSlots(
    Object.fromEntries(
      products.map((product) => [
        product.id,
        { slots_filled: product.slotsFilled, released_slots: product.releasedSlots },
      ]),
    ),
  );

  const claim = useCallback(
    async (product: ProductFeedItem) => {
      setError(null);
      setStates((current) => ({ ...current, [product.id]: "claiming" }));

      try {
        const result = await apiRequest<{ order: { id: string } }>(
          `/api/user/products/${product.id}/claim`,
          { body: {} },
        );
        applyClaim(product.id);
        setStates((current) => ({ ...current, [product.id]: "done" }));
        router.push(`/app/orders/${result.order.id}`);
      } catch (caught) {
        const code = caught instanceof ApiClientError ? caught.code : "error";

        if (code === "sold_out") {
          // The last slot went while the page was open. Show it as "just
          // missed it" and fill the meter, rather than surfacing a raw error.
          setStates((current) => ({ ...current, [product.id]: "missed" }));
          markChanged(product.id);
          return;
        }

        if (code === "phone_unverified") {
          router.push("/app/verify");
          return;
        }

        if (code === "unauthorized") {
          router.push("/app/login");
          return;
        }

        setStates((current) => ({ ...current, [product.id]: "idle" }));
        setError(caught instanceof Error ? caught.message : "Could not claim that. Try again.");
      }
    },
    [applyClaim, markChanged, router],
  );

  if (products.length === 0) {
    return (
      <div className="u-card px-6 py-14 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-paper-100 text-ink-500 dark:bg-white/5 dark:text-paper-200/60">
          <IconImage className="h-5 w-5" />
        </span>
        <p className="mt-3 font-display text-[15px] font-semibold text-ink-900 dark:text-paper-50">
          No products are open right now
        </p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
          New products appear here the moment they are published, and slots update live.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-xl border border-signal-500/30 bg-signal-50 px-3.5 py-3 text-[13px] font-medium text-signal-700"
        >
          {error}
        </p>
      ) : null}

      <ul className="border-t border-paper-300/60 dark:border-white/10">
        {products.map((product, index) => {
          const counts = slots[product.id] ?? {
            slots_filled: product.slotsFilled,
            released_slots: product.releasedSlots,
          };
          const soldOut = isSoldOut(counts);
          const left = slotsLeft(counts);
          // A staggered product whose batch is gone is not finished: more slots
          // open on the next daily release, and the copy should say so.
          const moreComing = soldOut && counts.released_slots < product.totalSlots;
          const state = states[product.id] ?? "idle";
          const missed = state === "missed";
          const claiming = state === "claiming";
          const done = state === "done";

          return (
            <li
              key={product.id}
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
              className="animate-[slide-up_0.4s_cubic-bezier(0.22,1,0.36,1)_both] relative border-b border-paper-300/60 pl-4 dark:border-white/10"
            >
              <span
                aria-hidden="true"
                className={`absolute bottom-4 left-0 top-4 w-[3px] rounded-full transition-colors ${
                  missed
                    ? "bg-ink-500/40"
                    : soldOut
                      ? "bg-paper-300 dark:bg-white/15"
                      : left <= 3
                        ? "bg-signal-500"
                        : "bg-done-500"
                }`}
              />

              <div className="flex gap-3.5 py-4">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-paper-100 ring-1 ring-inset ring-ink-900/5 dark:bg-white/5 dark:ring-white/10">
                  {product.imageUrl ? (
                    // Signed, short-lived URL from a private bucket.
                    <img
                      src={product.imageUrl}
                      alt=""
                      loading="lazy"
                      className={`h-full w-full object-cover transition duration-500 ${
                        soldOut ? "opacity-45 grayscale" : ""
                      }`}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-ink-500/50 dark:text-paper-200/30">
                      <IconImage className="h-5 w-5" />
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-[15px] font-semibold leading-snug tracking-tight text-ink-900 dark:text-paper-50">
                        {product.name}
                      </h3>
                      {product.brand ? (
                        <p className="mt-0.5 truncate font-data text-[11px] uppercase tracking-[0.14em] text-ink-500 dark:text-paper-200/50">
                          {product.brand}
                        </p>
                      ) : null}
                    </div>

                    {product.cashbackAmount !== null ? (
                      <p className="shrink-0 text-right">
                        <span className="u-data block text-[15px] font-semibold text-ink-900 dark:text-paper-50">
                          {formatCurrency(product.cashbackAmount)}
                        </span>
                        <span className="font-body text-[10px] uppercase tracking-[0.12em] text-ink-500 dark:text-paper-200/50">
                          cashback
                        </span>
                      </p>
                    ) : null}
                  </div>

                  {product.description ? (
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
                      {product.description}
                    </p>
                  ) : null}

                  <div className="mt-3">
                    <SlotMeter
                      filled={counts.slots_filled}
                      released={counts.released_slots}
                      changed={changedId === product.id}
                    />
                  </div>

                  <div className="mt-3.5">
                    {missed ? (
                      <div className="flex items-center gap-2 rounded-xl border border-ink-900/10 bg-paper-100 px-3.5 py-2.5 dark:border-white/10 dark:bg-white/5">
                        <span className="font-body text-[13px] font-semibold text-ink-700 dark:text-paper-100">
                          Just missed it
                        </span>
                        <span className="font-body text-[12px] text-ink-500 dark:text-paper-200/60">
                          the last slot went to someone else
                        </span>
                      </div>
                    ) : done ? (
                      <div className="flex items-center gap-2 rounded-xl border border-done-500/30 bg-done-50 px-3.5 py-2.5 text-done-700">
                        <IconCheck className="h-4 w-4" />
                        <span className="font-body text-[13px] font-semibold">
                          Slot claimed, opening your order
                        </span>
                        <IconChevronRight className="ml-auto h-4 w-4" />
                      </div>
                    ) : soldOut ? (
                      <div className="rounded-xl border border-paper-300 bg-paper-100/70 px-3.5 py-2.5 text-center font-body text-[13px] font-semibold text-ink-500 dark:border-white/10 dark:bg-white/5 dark:text-paper-200/50">
                        {moreComing ? "Today's slots are gone, more open tomorrow" : "All slots taken"}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => claim(product)}
                        disabled={claiming}
                        className="u-btn-primary w-full sm:w-auto sm:px-6"
                      >
                        {claiming ? (
                          <>
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                            Claiming
                          </>
                        ) : (
                          "Claim a slot"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
