import { requireVerifiedUserSession } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ApiError, badRequest, errorResponse, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { extractOrderFromScreenshot, type ExtractionResult } from "@/lib/ai/extract-order";
import {
  MAX_UPLOAD_BYTES,
  SCREENSHOT_BUCKET,
  buildStoragePath,
  createSignedImageUrl,
  screenshotTtlSeconds,
  validateImageUpload,
} from "@/lib/storage";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * User proof upload.
 *
 * Same server-side validation as the admin upload route (real bytes decide the
 * type, 5 MB cap, private bucket, signed URL only). Two differences:
 *   * the object path is namespaced under the caller's own uid, which is what
 *     the storage policy in 0004 expects, so the file is theirs alone;
 *   * an order proof is sent to Claude for extraction, and only that one image
 *     travels in the request.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireVerifiedUserSession();

    await enforceRateLimit(request, {
      bucket: "upload:user",
      limit: 20,
      windowMs: 60_000,
      identifier: session.userId,
      redis: serverEnv.rateLimitRedis,
    });

    // Cheap rejection before the body is buffered.
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new ApiError(413, "Files must be 5 MB or smaller.", "payload_too_large");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw badRequest("Expected a multipart/form-data upload containing `file`.");
    }

    const purpose = form.get("purpose") === "review-proof" ? "review-proof" : "order-proof";

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw badRequest("A file must be attached as `file`.");
    }

    const validation = await validateImageUpload(file);
    if (!validation.ok) {
      throw new ApiError(validation.status, validation.error, "invalid_upload");
    }

    const admin = createAdminSupabaseClient();
    const path = buildStoragePath(`${session.userId}/${purpose}`, validation.extension);
    const expiresIn = screenshotTtlSeconds();

    const { error: uploadError } = await admin.storage
      .from(SCREENSHOT_BUCKET)
      .upload(path, validation.bytes, {
        contentType: validation.mimeType,
        cacheControl: "private, max-age=0, no-store",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const signedUrl = await createSignedImageUrl(admin, SCREENSHOT_BUCKET, path, expiresIn);
    if (!signedUrl) {
      throw new ApiError(500, "Uploaded, but the preview could not be created.", "sign_failed");
    }

    // Extraction is best-effort: a missing key or a model hiccup must not cost
    // the user their upload. The confirm screen simply starts blank.
    let extraction: ExtractionResult | null = null;
    if (purpose === "order-proof" && serverEnv.hasAnthropicKey) {
      try {
        extraction = await extractOrderFromScreenshot({
          bytes: validation.bytes,
          mimeType: validation.mimeType,
        });
      } catch {
        extraction = null;
      }
    }

    return jsonOk(
      {
        bucket: SCREENSHOT_BUCKET,
        path,
        signedUrl,
        mimeType: validation.mimeType,
        sizeBytes: validation.bytes.byteLength,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        extraction,
        extractionAvailable: serverEnv.hasAnthropicKey,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
