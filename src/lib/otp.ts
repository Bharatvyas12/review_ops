import "server-only";
import { serverEnv } from "@/lib/env/server";

/**
 * One-time phone codes.
 *
 * A code is never stored, logged or returned in plaintext:
 *   * the database keeps a SHA-256 hash (public.phone_verifications.code_hash);
 *   * the API response never carries the code;
 *   * the only place it is ever rendered is the development SMS transport,
 *     which refuses to run when NODE_ENV is "production".
 */

export const OTP_LENGTH = 6;

/** Codes are compared as strings of exactly six digits. */
export function normalizeOtpCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === OTP_LENGTH ? digits : null;
}

/** Uniformly distributed 6-digit code. Uses the CSPRNG, not Math.random. */
export function generateOtpCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value =
    (((bytes[0] as number) << 24) |
      ((bytes[1] as number) << 16) |
      ((bytes[2] as number) << 8) |
      (bytes[3] as number)) >>>
    0;
  return String(value % 1_000_000).padStart(OTP_LENGTH, "0");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Resolves the pepper that makes an offline brute force of the six-digit space
 * useless even if the table leaked.
 *
 * OTP_HASH_PEPPER is used when set. Otherwise the existing 32-byte
 * BANK_ENCRYPTION_KEY is reused through a domain-separated derivation, so no
 * new secret is mandatory and the key is never used verbatim for a second job.
 */
async function resolvePepper(): Promise<string> {
  const explicit = serverEnv.otpHashPepper;
  if (explicit) return explicit;
  return sha256Hex(`reviewsys:otp:v1:${serverEnv.bankEncryptionKey}`);
}

export async function hashOtpCode(userId: string, code: string): Promise<string> {
  const pepper = await resolvePepper();
  return sha256Hex(`${pepper}:${userId}:${code}`);
}

export function otpExpiryFromNow(seconds = serverEnv.otpTtlSeconds): Date {
  return new Date(Date.now() + seconds * 1000);
}

/** +91 98765 43210 -> +91 ***** 43210. Safe to log and to show in the UI. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "your number";
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 4) return "your number";
  const last4 = digits.slice(-4);
  const country = phone.trim().startsWith("+") ? `+${digits.slice(0, 2)}` : "";
  return `${country ? `${country} ` : ""}*****${last4}`;
}

export function buildOtpMessage(code: string, ttlSeconds: number): string {
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));
  return `${code} is your Review Ops verification code. It expires in ${minutes} minute${
    minutes === 1 ? "" : "s"
  }. Never share this code.`;
}
