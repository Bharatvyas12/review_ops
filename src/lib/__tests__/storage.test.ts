import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  buildStoragePath,
  detectImageMimeType,
  validateImageUpload,
} from "@/lib/storage";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]);
const HEIC_BYTES = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0,
]);

function fileOf(bytes: Uint8Array, type: string, name = "shot.png"): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

describe("detectImageMimeType", () => {
  it("sniffs real file signatures", () => {
    expect(detectImageMimeType(PNG_BYTES)).toBe("image/png");
    expect(detectImageMimeType(JPEG_BYTES)).toBe("image/jpeg");
    expect(detectImageMimeType(WEBP_BYTES)).toBe("image/webp");
    expect(detectImageMimeType(HEIC_BYTES)).toBe("image/heic");
  });

  it("returns null for things that are not images", () => {
    expect(detectImageMimeType(GIF_BYTES)).toBeNull();
    expect(detectImageMimeType(new TextEncoder().encode("hello world"))).toBeNull();
  });
});

describe("validateImageUpload", () => {
  it("accepts a real PNG", async () => {
    const result = await validateImageUpload(fileOf(PNG_BYTES, "image/png"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mimeType).toBe("image/png");
      expect(result.extension).toBe("png");
    }
  });

  it("rejects a non-image MIME type", async () => {
    const result = await validateImageUpload(fileOf(PNG_BYTES, "application/pdf"));
    expect(result).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects a GIF even though it is a valid image", async () => {
    const result = await validateImageUpload(fileOf(GIF_BYTES, "image/gif"));
    expect(result).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects contents that disagree with the declared type", async () => {
    const result = await validateImageUpload(fileOf(PNG_BYTES, "image/jpeg", "lie.jpg"));
    expect(result).toMatchObject({ ok: false, status: 415 });
    if (!result.ok) expect(result.error).toMatch(/do not match/);
  });

  it("rejects files larger than 5 MB", async () => {
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    oversized.set(PNG_BYTES.subarray(0, 8));
    const result = await validateImageUpload(fileOf(oversized, "image/png"));
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects an empty file", async () => {
    const result = await validateImageUpload(fileOf(new Uint8Array(0), "image/png"));
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe("buildStoragePath", () => {
  it("sanitises the prefix and never uses a client filename", () => {
    const path = buildStoragePath("admin/../../etc passwd", "png");
    expect(path.startsWith("admin/etc-passwd/")).toBe(true);
    expect(path.endsWith(".png")).toBe(true);
    expect(path.split("/")).toHaveLength(3);
    expect(path).not.toContain("..");
  });
});
