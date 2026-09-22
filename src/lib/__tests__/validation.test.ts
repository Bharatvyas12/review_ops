import { describe, expect, it } from "vitest";
import {
  loginSchema,
  orderActionSchema,
  paymentActionSchema,
  productCreateSchema,
  productUpdateSchema,
  signedUrlSchema,
  uuidSchema,
} from "@/lib/validation";

describe("loginSchema", () => {
  it("lowercases and trims the email", () => {
    const result = loginSchema.parse({ email: "  Admin@Example.COM ", password: "hunter2hunter2" });
    expect(result.email).toBe("admin@example.com");
  });

  it("never trims or transforms the password", () => {
    const result = loginSchema.parse({ email: "a@b.com", password: "  spaced  " });
    expect(result.password).toBe("  spaced  ");
  });

  it("rejects a malformed email or an empty password", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("productCreateSchema", () => {
  it("coerces form strings into the right types", () => {
    const result = productCreateSchema.parse({
      name: "  Boat Airdopes ",
      totalSlots: "25",
      cashbackAmount: "250.5",
    });
    expect(result.name).toBe("Boat Airdopes");
    expect(result.totalSlots).toBe(25);
    expect(result.cashbackAmount).toBe(250.5);
  });

  it("treats a blank cashback as null rather than zero", () => {
    expect(productCreateSchema.parse({ name: "X", totalSlots: "1", cashbackAmount: "" }).cashbackAmount).toBeNull();
  });

  it("treats a blank daily release limit as no limit", () => {
    expect(
      productCreateSchema.parse({ name: "X", totalSlots: "10", dailyReleaseLimit: "" })
        .dailyReleaseLimit,
    ).toBeNull();
    expect(
      productCreateSchema.parse({ name: "X", totalSlots: "10", dailyReleaseLimit: "5" })
        .dailyReleaseLimit,
    ).toBe(5);
    expect(
      productCreateSchema.safeParse({ name: "X", totalSlots: "10", dailyReleaseLimit: "-1" })
        .success,
    ).toBe(false);
    expect(
      productCreateSchema.safeParse({ name: "X", totalSlots: "10", dailyReleaseLimit: "1.5" })
        .success,
    ).toBe(false);
  });

  it("rejects zero slots, negative cashback and an empty name", () => {
    expect(productCreateSchema.safeParse({ name: "X", totalSlots: "0" }).success).toBe(false);
    expect(productCreateSchema.safeParse({ name: "X", totalSlots: "1", cashbackAmount: "-5" }).success).toBe(false);
    expect(productCreateSchema.safeParse({ name: "   ", totalSlots: "1" }).success).toBe(false);
  });

  it("rejects an absurd slot count", () => {
    expect(productCreateSchema.safeParse({ name: "X", totalSlots: "500000" }).success).toBe(false);
  });
});

describe("productUpdateSchema", () => {
  it("accepts a partial patch", () => {
    expect(productUpdateSchema.parse({ status: "closed" })).toEqual({ status: "closed" });
  });

  it("only sends a daily release limit when the form includes one", () => {
    // The close/reopen action patches `status` alone, which must leave the
    // stored limit untouched - hence undefined rather than 0.
    expect(productUpdateSchema.parse({ status: "closed" }).dailyReleaseLimit).toBeUndefined();
    expect(productUpdateSchema.parse({ dailyReleaseLimit: "0" }).dailyReleaseLimit).toBe(0);
    expect(productUpdateSchema.parse({ dailyReleaseLimit: "" }).dailyReleaseLimit).toBeNull();
  });

  it("rejects an unknown status", () => {
    expect(productUpdateSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});

describe("order and payment actions", () => {
  it("requires a reason when rejecting", () => {
    expect(orderActionSchema.safeParse({ action: "reject" }).success).toBe(false);
    expect(orderActionSchema.safeParse({ action: "reject", reason: "no" }).success).toBe(false);
    expect(orderActionSchema.safeParse({ action: "reject", reason: "Blurry screenshot" }).success).toBe(true);
  });

  it("accepts a bare approve", () => {
    expect(orderActionSchema.parse({ action: "approve" })).toEqual({ action: "approve" });
  });

  it("requires a payment reference", () => {
    expect(paymentActionSchema.safeParse({ action: "mark_paid" }).success).toBe(false);
    expect(paymentActionSchema.safeParse({ action: "mark_paid", paymentReference: "UTR99" }).success).toBe(true);
    expect(paymentActionSchema.safeParse({ action: "reveal" }).success).toBe(true);
  });
});

describe("signedUrlSchema and uuidSchema", () => {
  it("restricts signing to the two known buckets", () => {
    expect(signedUrlSchema.safeParse({ bucket: "secrets", path: "a/b.png" }).success).toBe(false);
    expect(signedUrlSchema.parse({ bucket: "screenshots", path: "a/b.png" }).scope).toBe("screenshot");
  });

  it("validates uuids", () => {
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(uuidSchema.safeParse("2f0a3a4c-1d5b-4f6e-9a1b-0c2d3e4f5a6b").success).toBe(true);
  });
});
