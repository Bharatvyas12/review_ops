import { requireAdminSession } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ApiError, badRequest, errorResponse, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import {
  MAX_UPLOAD_BYTES,
  PRODUCT_IMAGE_BUCKET,
  SCREENSHOT_BUCKET,
  buildStoragePath,
  createSignedImageUrl,
  screenshotTtlSeconds,
  shareTtlSeconds,
  validateImageUpload,
} from "@/lib/storage";
import { uploadPurposeSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireAdminSession();

    await enforceRateLimit(request, {
      bucket: "upload:admin",
      limit: 30,
      windowMs: 60_000,
      identifier: session.userId,
      redis:
        serverEnv.upstashUrl && serverEnv.upstashToken
          ? { url: serverEnv.upstashUrl, token: serverEnv.upstashToken }
          : undefined,
    });

    // Cheap rejection before buffering the body.
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

    const purposeResult = uploadPurposeSchema.safeParse(form.get("purpose") ?? "screenshot");
    const purpose = purposeResult.success ? purposeResult.data : "screenshot";

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw badRequest("A file must be attached as `file`.");
    }

    // Server-side type + size validation. The browser's accept/size hints are
    // treated as a convenience only.
    const validation = await validateImageUpload(file);
    if (!validation.ok) {
      throw new ApiError(validation.status, validation.error, "invalid_upload");
    }

    const isProductImage = purpose === "product-image";
    const bucket = isProductImage ? PRODUCT_IMAGE_BUCKET : SCREENSHOT_BUCKET;
    const prefix = isProductImage ? "products" : `admin/${session.userId}`;
    const path = buildStoragePath(prefix, validation.extension);
    const expiresIn = purpose === "share" ? shareTtlSeconds() : screenshotTtlSeconds();

    const admin = createAdminSupabaseClient();
    const { error: uploadError } = await admin.storage
      .from(bucket)
      .upload(path, validation.bytes, {
        contentType: validation.mimeType,
        cacheControl: "private, max-age=0, no-store",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const signedUrl = await createSignedImageUrl(admin, bucket, path, expiresIn);
    if (!signedUrl) {
      throw new ApiError(500, "Uploaded, but the share link could not be created.", "sign_failed");
    }

    return jsonOk(
      {
        bucket,
        path,
        signedUrl,
        mimeType: validation.mimeType,
        sizeBytes: validation.bytes.byteLength,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
