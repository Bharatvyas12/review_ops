import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OTP_LENGTH,
  buildOtpMessage,
  generateOtpCode,
  hashOtpCode,
  maskPhone,
  normalizeOtpCode,
  otpExpiryFromNow,
} from "@/lib/otp";

// The pepper falls back to a derivation of BANK_ENCRYPTION_KEY, so hashing only
// works with a key present - exactly like production.
const KEY = Buffer.alloc(32, 3).toString("base64");

beforeAll(() => {
  vi.stubEnv("BANK_ENCRYPTION_KEY", KEY);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("generateOtpCode", () => {
  it("always returns exactly six digits", () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      expect(generateOtpCode()).toMatch(/^[0-9]{6}$/);
    }
  });

  it("pads short values instead of dropping digits", () => {
    expect(generateOtpCode()).toHaveLength(OTP_LENGTH);
  });

  it("does not repeat itself across many draws", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateOtpCode()));
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe("normalizeOtpCode", () => {
  it("accepts a clean six digit string", () => {
    expect(normalizeOtpCode("123456")).toBe("123456");
  });

  it("strips spacing that a paste or an SMS app may introduce", () => {
    expect(normalizeOtpCode(" 123 456 ")).toBe("123456");
  });

  it("rejects anything that is not six digits", () => {
    expect(normalizeOtpCode("12345")).toBeNull();
    expect(normalizeOtpCode("1234567")).toBeNull();
    expect(normalizeOtpCode("abcdef")).toBeNull();
    expect(normalizeOtpCode("")).toBeNull();
    expect(normalizeOtpCode(null)).toBeNull();
    expect(normalizeOtpCode(123456)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("keeps only the last four digits", () => {
    expect(maskPhone("+919876543210")).toBe("+91 *****3210");
  });

  it("renders Indian mobile numbers the way the UI shows them", () => {
    const masked = maskPhone("+919876543210");
    expect(masked).not.toContain("98765");
    expect(masked.endsWith("3210")).toBe(true);
  });

  it("degrades safely for missing or too-short numbers", () => {
    expect(maskPhone(null)).toBe("your number");
    expect(maskPhone("12")).toBe("your number");
  });
});

describe("buildOtpMessage", () => {
  it("contains the code and the expiry, and warns against sharing", () => {
    const message = buildOtpMessage("123456", 300);
    expect(message).toContain("123456");
    expect(message).toContain("5 minutes");
    expect(message.toLowerCase()).toContain("never share");
  });

  it("never claims a sub-minute expiry", () => {
    expect(buildOtpMessage("123456", 20)).toContain("1 minute");
  });
});

describe("hashOtpCode", () => {
  it("is a 64 character hex digest, not the code itself", async () => {
    const hash = await hashOtpCode("user-1", "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
  });

  it("is deterministic for the same user and code", async () => {
    await expect(hashOtpCode("user-1", "123456")).resolves.toBe(await hashOtpCode("user-1", "123456"));
  });

  it("separates users, so a hash cannot be replayed across accounts", async () => {
    expect(await hashOtpCode("user-1", "123456")).not.toBe(await hashOtpCode("user-2", "123456"));
  });

  it("separates codes for the same user", async () => {
    expect(await hashOtpCode("user-1", "123456")).not.toBe(await hashOtpCode("user-1", "654321"));
  });

  it("uses OTP_HASH_PEPPER when one is configured", async () => {
    const derived = await hashOtpCode("user-1", "123456");
    vi.stubEnv("OTP_HASH_PEPPER", "a-different-pepper");
    const peppered = await hashOtpCode("user-1", "123456");
    vi.unstubAllEnvs();
    vi.stubEnv("BANK_ENCRYPTION_KEY", KEY);

    expect(peppered).not.toBe(derived);
    expect(peppered).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("otpExpiryFromNow", () => {
  it("lands the given number of seconds in the future", () => {
    const before = Date.now();
    const expiry = otpExpiryFromNow(300);
    const delta = expiry.getTime() - before;
    expect(delta).toBeGreaterThan(299_000);
    expect(delta).toBeLessThan(301_000);
  });
});
