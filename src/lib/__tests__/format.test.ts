import { describe, expect, it } from "vitest";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  formatCurrency,
  formatDate,
  formatRelative,
  initials,
  productSlotLabel,
} from "@/lib/format";

describe("formatCurrency", () => {
  it("formats INR amounts", () => {
    expect(formatCurrency(250)).toContain("250");
    expect(formatCurrency(1234.5)).toContain("1,234.5");
  });

  it("renders a dash for missing values", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
  });
});

describe("dates", () => {
  it("formats and guards invalid input", () => {
    expect(formatDate("2026-01-15T10:00:00.000Z")).toMatch(/2026/);
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("renders relative time", () => {
    expect(formatRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(formatRelative(null)).toBe("—");
  });
});

describe("labels", () => {
  it("covers every order status", () => {
    const statuses = [
      "claimed",
      "order_submitted",
      "order_confirmed",
      "review_pending",
      "review_submitted",
      "approved",
      "paid",
      "rejected",
    ] as const;

    for (const status of statuses) {
      expect(ORDER_STATUS_LABELS[status]).toBeTruthy();
      expect(ORDER_STATUS_TONES[status]).toBeTruthy();
    }
  });

  it("builds slot labels and initials", () => {
    expect(productSlotLabel({ slots_filled: 3, released_slots: 10 })).toBe("3 / 10");
    expect(initials("Asha Rao")).toBe("AR");
    expect(initials(null)).toBe("?");
  });
});
