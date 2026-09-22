import { describe, expect, it } from "vitest";
import {
  ORDER_STAGES,
  isSoldOut,
  nextAction,
  slotsLeft,
  trackerState,
} from "@/lib/user-orders";
import type { OrderStatus } from "@/lib/types";

const ALL_STATUSES: OrderStatus[] = [
  "claimed",
  "order_submitted",
  "order_confirmed",
  "review_pending",
  "review_submitted",
  "approved",
  "paid",
  "rejected",
];

describe("ORDER_STAGES", () => {
  it("describes exactly the six stages a reviewer walks through", () => {
    expect(ORDER_STAGES.map((stage) => stage.key)).toEqual([
      "claimed",
      "order_submitted",
      "review_pending",
      "review_submitted",
      "approved",
      "paid",
    ]);
  });

  it("no longer shows an order-approval step", () => {
    expect(ORDER_STAGES.map((stage) => stage.label)).not.toContain("Order confirmed");
  });

  it("gives every stage a label and a hint", () => {
    for (const stage of ORDER_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("trackerState", () => {
  it("has a defined state for every status", () => {
    for (const status of ALL_STATUSES) {
      const tracker = trackerState({ status, review_submitted_at: null });
      expect(tracker.stages).toHaveLength(6);
      expect(tracker.progress).toBeGreaterThanOrEqual(0);
      expect(tracker.progress).toBeLessThanOrEqual(1);
    }
  });

  it("marks claimed as the first stage, with nothing behind it", () => {
    const tracker = trackerState({ status: "claimed", review_submitted_at: null });
    expect(tracker.stages[0]?.active).toBe(true);
    expect(tracker.stages.filter((stage) => stage.done)).toHaveLength(0);
  });

  it("never shows more than one active stage", () => {
    for (const status of ALL_STATUSES) {
      const tracker = trackerState({ status, review_submitted_at: null });
      expect(tracker.stages.filter((stage) => stage.active).length).toBeLessThanOrEqual(1);
    }
  });

  it("fills the stages behind the current one as the order advances", () => {
    const submitted = trackerState({ status: "order_submitted", review_submitted_at: null });
    expect(submitted.stages[0]?.done).toBe(true);
    expect(submitted.stages[1]?.active).toBe(true);
    expect(submitted.stages[2]?.done).toBe(false);
  });

  it("points a submitted order straight at the review stage, with nothing in between", () => {
    const pending = trackerState({ status: "review_pending", review_submitted_at: null });
    expect(pending.stages[2]?.active).toBe(true);
    expect(pending.stages[1]?.done).toBe(true);
  });

  it("still renders a legacy order_confirmed row at the review stage", () => {
    const confirmed = trackerState({ status: "order_confirmed", review_submitted_at: null });
    expect(confirmed.stages[2]?.active).toBe(true);
    expect(confirmed.stages[1]?.done).toBe(true);
  });

  it("progress only ever moves forward as work is done", () => {
    const order: OrderStatus[] = [
      "claimed",
      "order_submitted",
      "order_confirmed",
      "review_submitted",
      "approved",
      "paid",
    ];
    const progress = order.map(
      (status) => trackerState({ status, review_submitted_at: null }).progress,
    );
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index]!).toBeGreaterThan(progress[index - 1]!);
    }
  });

  it("shows a paid order as fully complete", () => {
    const tracker = trackerState({ status: "paid", review_submitted_at: null });
    expect(tracker.stages.every((stage) => stage.done)).toBe(true);
    expect(tracker.stages.some((stage) => stage.active)).toBe(false);
    expect(tracker.progress).toBe(1);
  });

  it("reports rejection without marking anything as the active stage", () => {
    const tracker = trackerState({ status: "rejected", review_submitted_at: null });
    expect(tracker.rejected).toBe(true);
    expect(tracker.stages.some((stage) => stage.active)).toBe(false);
  });

  it("infers that a rejected order with a review submission got to the review stage", () => {
    const withReview = trackerState({
      status: "rejected",
      review_submitted_at: "2026-01-01T00:00:00.000Z",
    });
    expect(withReview.rejectedAt).toBe("review_submitted");

    const withoutReview = trackerState({ status: "rejected", review_submitted_at: null });
    expect(withoutReview.rejectedAt).toBe("review_pending");
  });
});

describe("nextAction", () => {
  it("asks for the order screenshot while a claim is unproven", () => {
    expect(nextAction({ status: "claimed", rejection_reason: null }).kind).toBe("order_proof");
  });

  it("asks for review proof once the order is confirmed", () => {
    expect(nextAction({ status: "order_confirmed", rejection_reason: null }).kind).toBe(
      "review_proof",
    );
    expect(nextAction({ status: "review_pending", rejection_reason: null }).kind).toBe(
      "review_proof",
    );
  });

  it("puts the reviewer in a waiting state while the team checks", () => {
    expect(nextAction({ status: "order_submitted", rejection_reason: null }).kind).toBe("waiting");
    expect(nextAction({ status: "review_submitted", rejection_reason: null }).kind).toBe("waiting");
  });

  it("says the order is done once paid", () => {
    expect(nextAction({ status: "paid", rejection_reason: null }).kind).toBe("none");
  });

  it("surfaces the admin's reason on a rejection", () => {
    const action = nextAction({ status: "rejected", rejection_reason: "Blurry screenshot" });
    expect(action.kind).toBe("rejected");
    expect(action.body).toBe("Blurry screenshot");
  });

  it("does not leave a rejected order without an explanation", () => {
    expect(nextAction({ status: "rejected", rejection_reason: null }).body.length).toBeGreaterThan(0);
  });

  it("never asks for proof of a stage that is already past", () => {
    for (const status of ["order_submitted", "review_submitted", "approved", "paid"] as OrderStatus[]) {
      const action = nextAction({ status, rejection_reason: null });
      expect(action.kind === "order_proof" || action.kind === "review_proof").toBe(false);
    }
  });
});

describe("slotsLeft / isSoldOut", () => {
  it("counts the remaining slots of a fully released product", () => {
    expect(slotsLeft({ slots_filled: 3, released_slots: 10 })).toBe(7);
  });

  it("counts against the released batch, not the campaign total", () => {
    expect(slotsLeft({ slots_filled: 2, released_slots: 5 })).toBe(3);
    expect(isSoldOut({ slots_filled: 5, released_slots: 5 })).toBe(true);
    expect(isSoldOut({ slots_filled: 2, released_slots: 5 })).toBe(false);
  });

  it("never reports a negative number, even if the row is inconsistent", () => {
    expect(slotsLeft({ slots_filled: 12, released_slots: 10 })).toBe(0);
  });

  it("treats a full product as sold out", () => {
    expect(isSoldOut({ slots_filled: 10, released_slots: 10 })).toBe(true);
    expect(isSoldOut({ slots_filled: 9, released_slots: 10 })).toBe(false);
  });
});
