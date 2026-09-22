import { describe, expect, it } from "vitest";
import {
  CIPHER_VERSION,
  decryptAccountNumber,
  encryptAccountNumber,
  isEncryptedAccountNumber,
  isValidAccountNumber,
  last4,
  maskAccountNumber,
  normalizeAccountNumber,
  parseEncryptionKey,
} from "@/lib/crypto";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");
const ACCOUNT = "123456789012";

describe("encryptAccountNumber / decryptAccountNumber", () => {
  it("round-trips an account number", async () => {
    const payload = await encryptAccountNumber(ACCOUNT, KEY_A);
    await expect(decryptAccountNumber(payload, { primary: KEY_A })).resolves.toBe(ACCOUNT);
  });

  it("produces a versioned, non-reversible envelope", async () => {
    const payload = await encryptAccountNumber(ACCOUNT, KEY_A);
    expect(payload.startsWith(`${CIPHER_VERSION}.`)).toBe(true);
    expect(payload).not.toContain(ACCOUNT);
    expect(payload.split(".")).toHaveLength(3);
    expect(isEncryptedAccountNumber(payload)).toBe(true);
  });

  it("uses a fresh IV so the same input never repeats a ciphertext", async () => {
    const first = await encryptAccountNumber(ACCOUNT, KEY_A);
    const second = await encryptAccountNumber(ACCOUNT, KEY_A);
    expect(first).not.toBe(second);
  });

  it("normalises spacing and dashes before encrypting", async () => {
    const payload = await encryptAccountNumber("1234 5678-9012", KEY_A);
    await expect(decryptAccountNumber(payload, { primary: KEY_A })).resolves.toBe(ACCOUNT);
  });

  it("rejects a wrong key and a tampered ciphertext", async () => {
    const payload = await encryptAccountNumber(ACCOUNT, KEY_A);
    await expect(decryptAccountNumber(payload, { primary: KEY_B })).rejects.toThrow();

    const [version, iv, cipher] = payload.split(".");
    const tamperedByte = (cipher ?? "").slice(0, -2) + "AA";
    await expect(
      decryptAccountNumber(`${version}.${iv}.${tamperedByte}`, { primary: KEY_A }),
    ).rejects.toThrow();
  });

  it("falls back to the previous key during rotation", async () => {
    const payload = await encryptAccountNumber(ACCOUNT, KEY_A);
    await expect(
      decryptAccountNumber(payload, { primary: KEY_B, previous: KEY_A }),
    ).resolves.toBe(ACCOUNT);
  });

  it("refuses to decrypt values that are not v1 ciphertext", async () => {
    await expect(decryptAccountNumber(ACCOUNT, { primary: KEY_A })).rejects.toThrow(
      /not a v1 ciphertext/,
    );
  });

  it("refuses to encrypt something that is not an account number", async () => {
    await expect(encryptAccountNumber("abc", KEY_A)).rejects.toThrow();
    await expect(encryptAccountNumber("12345", KEY_A)).rejects.toThrow();
  });
});

describe("parseEncryptionKey", () => {
  it("accepts base64, base64url and hex", () => {
    const hex = Buffer.alloc(32, 3).toString("hex");
    expect(parseEncryptionKey(KEY_A)).toHaveLength(32);
    expect(parseEncryptionKey(hex)).toHaveLength(32);
    expect(parseEncryptionKey(KEY_A.replace(/=+$/, ""))).toHaveLength(32);
  });

  it("rejects short or empty keys instead of deriving a weak one", () => {
    expect(() => parseEncryptionKey("")).toThrow(/empty/);
    expect(() => parseEncryptionKey(Buffer.alloc(16, 1).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("helpers", () => {
  it("validates and normalises account numbers", () => {
    expect(isValidAccountNumber("1234 5678 9012")).toBe(true);
    expect(isValidAccountNumber("12345")).toBe(false);
    expect(isValidAccountNumber("12345678901234567890123456789012345678")).toBe(false);
    expect(normalizeAccountNumber("1234-5678 90")).toBe("1234567890");
  });

  it("only ever exposes the last four digits", () => {
    expect(last4("1234 5678 9012")).toBe("9012");
    expect(maskAccountNumber("9012")).toBe("•••• •••• 9012");
    expect(maskAccountNumber(null)).toBe("Not provided");
    expect(maskAccountNumber("12")).toBe("Not provided");
  });
});
