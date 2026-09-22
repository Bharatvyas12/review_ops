import type { OrderRow, OrderStatus } from "@/lib/types";

/**
 * The six stages a claim moves through, in the order a reviewer experiences
 * them. `status` is the database status that marks the stage complete
 * ("review_pending" is the review-writing window, which no single write sets).
 *
 * There is no "order confirmed" stage: an admin used to verify the purchase
 * screenshot first, and that gate is gone, so submitting the proof now lands
 * straight on the review step.
 */
export const ORDER_STAGES = [
  { key: "claimed", label: "Claimed", hint: "Slot reserved for you" },
  { key: "order_submitted", label: "Order submitted", hint: "Screenshot sent" },
  { key: "review_pending", label: "Review pending", hint: "Your turn: write the review" },
  { key: "review_submitted", label: "Review submitted", hint: "Review proof sent" },
  { key: "approved", label: "Approved", hint: "Review accepted" },
  { key: "paid", label: "Paid", hint: "Cashback sent" },
] as const;

export type StageKey = (typeof ORDER_STAGES)[number]["key"];

/**
 * Which stage is the active one for a given status.
 *
 * Two of these are legacy values that nothing writes any more, but rows created
 * before the approval step was removed still carry them and have to render
 * sensibly:
 *   * order_confirmed - the old "an admin vetted the screenshot" state, which
 *     now means the same as review_pending: the reviewer owes a review;
 *   * order_submitted - kept on its own waiting stage, because a row sitting in
 *     the retired stage is still waiting and should not be shown as if the
 *     reviewer had been asked to write their review.
 */
const ACTIVE_INDEX: Record<OrderStatus, number> = {
  claimed: 0,
  order_submitted: 1,
  order_confirmed: 2,
  review_pending: 2,
  review_submitted: 3,
  approved: 4,
  paid: 5,
  rejected: 2,
};

export type StageState = {
  key: StageKey;
  label: string;
  hint: string;
  done: boolean;
  active: boolean;
};

export type TrackerState = {
  stages: StageState[];
  /** 0..1, for the fill bar. */
  progress: number;
  /** True when the order stopped early and the admin gave a reason. */
  rejected: boolean;
  /** The stage the order was rejected at, when that can be inferred. */
  rejectedAt: StageKey | null;
};

export function trackerState(order: {
  status: OrderStatus;
  review_submitted_at?: string | null;
}): TrackerState {
  const rejected = order.status === "rejected";

  // On rejection the timestamps tell us how far the order actually got: a
  // rejected order with a review submission was refused at the review stage,
  // otherwise it was refused for the review it never delivered.
  const activeIndex = rejected
    ? order.review_submitted_at
      ? 3
      : 2
    : ACTIVE_INDEX[order.status];

  // A paid order is finished: nothing more is expected, so no stage should be
  // left pulsing as "active" once the last one is behind it.
  const fullyComplete = !rejected && order.status === "paid";

  const stages = ORDER_STAGES.map((stage, index) => ({
    key: stage.key,
    label: stage.label,
    hint: stage.hint,
    done: index < activeIndex || fullyComplete,
    active: !fullyComplete && !rejected && index === activeIndex,
  }));

  return {
    stages,
    progress: rejected ? (activeIndex + 1) / ORDER_STAGES.length : (activeIndex + (order.status === "paid" ? 1 : 0.5)) / ORDER_STAGES.length,
    rejected,
    rejectedAt: rejected ? (ORDER_STAGES[activeIndex]?.key ?? null) : null,
  };
}

/** What the reviewer has to do next, if anything. */
export type NextAction =
  | { kind: "none"; title: string; body: string }
  | { kind: "order_proof"; title: string; body: string }
  | { kind: "review_proof"; title: string; body: string }
  | { kind: "waiting"; title: string; body: string }
  | { kind: "rejected"; title: string; body: string };

export function nextAction(order: Pick<OrderRow, "status" | "rejection_reason">): NextAction {
  switch (order.status) {
    case "claimed":
      return {
        kind: "order_proof",
        title: "Upload your order screenshot",
        body: "We read the details off the screenshot so you do not have to type them. Check them before you send.",
      };
    case "order_submitted":
      return {
        kind: "waiting",
        title: "Waiting for order confirmation",
        body: "Our team is checking the screenshot. This usually takes a few hours.",
      };
    case "order_confirmed":
    case "review_pending":
      return {
        kind: "review_proof",
        title: "Submit your review",
        body: "Write the review on the product page, then paste the link or upload a screenshot of it.",
      };
    case "review_submitted":
      return {
        kind: "waiting",
        title: "Waiting for review approval",
        body: "Your review is being checked. You will be notified when it is approved.",
      };
    case "approved":
      return {
        kind: "waiting",
        title: "Approved, payment queued",
        body: "Add your payout details so the cashback can be sent.",
      };
    case "paid":
      return {
        kind: "none",
        title: "Paid",
        body: "This one is complete. The payment reference is in your history.",
      };
    case "rejected":
      return {
        kind: "rejected",
        title: "This order was rejected",
        body: order.rejection_reason ?? "No reason was given.",
      };
  }
}

/**
 * Slots left, never negative.
 *
 * Measured against released_slots, not total_slots: when a product is released
 * a little at a time, only the batch that has been opened is claimable, so that
 * is the only honest answer to "how many are left". For a product with no
 * daily release limit released_slots equals total_slots.
 */
export function slotsLeft(product: { slots_filled: number; released_slots: number }): number {
  return Math.max(0, product.released_slots - product.slots_filled);
}

export function isSoldOut(product: { slots_filled: number; released_slots: number }): boolean {
  return slotsLeft(product) <= 0;
}
