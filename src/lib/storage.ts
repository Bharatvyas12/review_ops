import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";

export const SCREENSHOT_BUCKET = "screenshots";
export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<AllowedImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export type ImageValidationResult =
  | { ok: true; mimeType: AllowedImageMimeType; extension: string; bytes: Uint8Array }
  | { ok: false; status: number; error: string };

/**
 * Sniffs the real file signature. A client can claim any Content-Type it likes,
 * so the bytes have the final say and a declared/actual mismatch is rejected.
 */
export function detectImageMimeType(bytes: Uint8Array): AllowedImageMimeType | null {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);

  if (bytes.length >= 8 && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytes.length >= 3 && startsWith([0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    startsWith([0x52, 0x49, 0x46, 0x46]) &&
    startsWith([0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  // ISO Base Media File Format: "ftyp" box with an HEIF/HEIC brand.
  if (bytes.length >= 12 && startsWith([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(
      bytes[8] as number,
      bytes[9] as number,
      bytes[10] as number,
      bytes[11] as number,
    ).toLowerCase();
    const heifBrands = ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"];
    if (heifBrands.includes(brand)) {
      return brand.startsWith("hei") ? "image/heic" : "image/heif";
    }
  }
  return null;
}

export async function validateImageUpload(file: File): Promise<ImageValidationResult> {
  if (!file || typeof file.arrayBuffer !== "function") {
    return { ok: false, status: 400, error: "A file must be attached as `file`." };
  }
  if (file.size === 0) {
    return { ok: false, status: 400, error: "The file is empty." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Files must be 5 MB or smaller (received ${(file.size / 1024 / 1024).toFixed(1)} MB).`,
    };
  }

  const declaredType = (file.type || "").toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(declaredType as AllowedImageMimeType)) {
    return {
      ok: false,
      status: 415,
      error: "Only PNG, JPEG, WebP or HEIC images are accepted.",
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: "Files must be 5 MB or smaller." };
  }

  const actualType = detectImageMimeType(bytes);
  if (!actualType) {
    return { ok: false, status: 415, error: "That file is not a readable image." };
  }

  const declaredGroup = declaredType === "image/heif" ? "image/heic" : declaredType;
  const actualGroup = actualType === "image/heif" ? "image/heic" : actualType;
  if (declaredGroup !== actualGroup) {
    return {
      ok: false,
      status: 415,
      error: "The file contents do not match its declared type.",
    };
  }

  return { ok: true, mimeType: actualType, extension: EXTENSION_BY_MIME[actualType], bytes };
}

/** Randomised, namespaced object path  never derived from the client filename. */
export function buildStoragePath(prefix: string, extension: string): string {
  const safePrefix = prefix
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, "-"))
    .join("/");
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${safePrefix}/${Date.now()}-${id}.${extension}`;
}

export function isAbsoluteUrl(value: string | null | undefined): boolean {
  return Boolean(value && /^https?:\/\//i.test(value));
}

export type StorageAdminClient = SupabaseClient;

export async function createSignedImageUrl(
  client: StorageAdminClient,
  bucket: string,
  path: string,
  expiresInSeconds: number,
): Promise<string | null> {
  if (!path) return null;
  if (isAbsoluteUrl(path)) return path;

  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Batched signing for list views: one round trip for a whole queue.
 * Absolute URLs (e.g. an externally hosted product image) pass straight through.
 */
export async function createSignedImageUrls(
  client: StorageAdminClient,
  bucket: string,
  paths: (string | null | undefined)[],
  expiresInSeconds: number,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const toSign: string[] = [];

  for (const path of paths) {
    if (!path) continue;
    if (isAbsoluteUrl(path)) resolved.set(path, path);
    else if (!toSign.includes(path)) toSign.push(path);
  }

  if (toSign.length === 0) return resolved;

  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrls(toSign, expiresInSeconds);

  if (error || !data) return resolved;

  for (const entry of data) {
    if (entry.path && entry.signedUrl) resolved.set(entry.path, entry.signedUrl);
  }
  return resolved;
}

export function screenshotTtlSeconds(): number {
  return serverEnv.signedUrlTtlScreenshot;
}

export function shareTtlSeconds(): number {
  return serverEnv.signedUrlTtlShare;
}
