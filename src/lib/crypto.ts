/**
 * Application-layer AES-256-GCM for bank account numbers.
 *
 * Storage format: `v1.<base64url iv>.<base64url ciphertext||tag>`
 * The key lives only in BANK_ENCRYPTION_KEY (server env). Decryption happens
 * exclusively inside the audited "reveal for payment" route.
 *
 * Web Crypto is used rather than node:crypto so the same code runs on the
 * Cloudflare Pages edge runtime.
 */

export const CIPHER_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class EncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionConfigError";
  }
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return binary;
}

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Accepts both standard base64 and base64url, with or without padding. */
export function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parses a 32-byte key supplied as base64, base64url or 64-char hex.
 * Throws rather than silently deriving a weak key from a short passphrase.
 */
export function parseEncryptionKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new EncryptionConfigError("BANK_ENCRYPTION_KEY is empty.");
  }

  let bytes: Uint8Array;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    bytes = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i += 1) {
      bytes[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
  } else {
    try {
      bytes = fromBase64(trimmed);
    } catch {
      throw new EncryptionConfigError(
        "BANK_ENCRYPTION_KEY must be base64, base64url or 64-character hex.",
      );
    }
  }

  if (bytes.length !== KEY_BYTES) {
    throw new EncryptionConfigError(
      `BANK_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${bytes.length}). ` +
        "Generate one with: npm run key:generate",
    );
  }
  return bytes;
}

/** Strips spaces/dashes so "1234 5678 9012" encrypts identically to "123456789012". */
export function normalizeAccountNumber(value: string): string {
  return value.replace(/[\s-]/g, "").trim();
}

export function isValidAccountNumber(value: string): boolean {
  const normalized = normalizeAccountNumber(value);
  return /^[0-9]{6,34}$/.test(normalized);
}

async function importKey(rawKey: string): Promise<CryptoKey> {
  const bytes = parseEncryptionKey(rawKey);
  return crypto.subtle.importKey("raw", asBufferSource(bytes), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptAccountNumber(
  plaintext: string,
  rawKey?: string,
): Promise<string> {
  const normalized = normalizeAccountNumber(plaintext);
  if (!isValidAccountNumber(normalized)) {
    throw new Error("Account number must be 6-34 digits.");
  }

  const keyMaterial =
    rawKey ?? (await resolvePrimaryKey());
  const key = await importKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(encoder.encode(normalized)),
  );

  return `${CIPHER_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export function isEncryptedAccountNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  return parts.length === 3 && parts[0] === CIPHER_VERSION;
}

async function decryptWithKey(payload: string, rawKey: string): Promise<string> {
  const [version, ivPart, cipherPart] = payload.split(".");
  if (version !== CIPHER_VERSION || !ivPart || !cipherPart) {
    throw new Error("Unsupported bank account ciphertext format.");
  }

  const key = await importKey(rawKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(fromBase64(ivPart)) },
    key,
    asBufferSource(fromBase64(cipherPart)),
  );
  return decoder.decode(plaintext);
}

async function resolvePrimaryKey(): Promise<string> {
  const { serverEnv } = await import("./env/server");
  return serverEnv.bankEncryptionKey;
}

/**
 * Decrypts with the primary key, falling back to BANK_ENCRYPTION_KEY_PREVIOUS
 * so keys can be rotated without a flag day. Server-side only.
 */
export async function decryptAccountNumber(
  payload: string,
  keys?: { primary: string; previous?: string | null },
): Promise<string> {
  if (!isEncryptedAccountNumber(payload)) {
    throw new Error("Refusing to decrypt: value is not a v1 ciphertext.");
  }

  const resolved =
    keys ??
    (await (async () => {
      const { serverEnv } = await import("./env/server");
      return {
        primary: serverEnv.bankEncryptionKey,
        previous: serverEnv.bankEncryptionKeyPrevious,
      };
    })());

  const candidates = [resolved.primary, resolved.previous].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await decryptWithKey(payload, candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to decrypt bank account number with the configured key(s). ${
      lastError instanceof Error ? lastError.message : ""
    }`.trim(),
  );
}

export function last4(accountNumber: string): string {
  return normalizeAccountNumber(accountNumber).slice(-4);
}

/** Display helper: never returns more than the last four digits. */
export function maskAccountNumber(last4Digits: string | null | undefined): string {
  if (!last4Digits || !/^[0-9]{4}$/.test(last4Digits)) {
    return "Not provided";
  }
  return `•••• •••• ${last4Digits}`;
}
