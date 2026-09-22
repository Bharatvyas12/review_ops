import { requireAdminSession } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { badRequest, errorResponse, jsonOk, parseJson, notFound } from "@/lib/http";
import { signedUrlSchema } from "@/lib/validation";
import {
  PRODUCT_IMAGE_BUCKET,
  SCREENSHOT_BUCKET,
  createSignedImageUrl,
  isAbsoluteUrl,
  screenshotTtlSeconds,
  shareTtlSeconds,
} from "@/lib/storage";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdminSession();

    const input = await parseJson(request, signedUrlSchema);

    if (isAbsoluteUrl(input.path)) {
      return jsonOk({ signedUrl: input.path, expiresAt: null });
    }

    // Reject traversal and anything that is not a plain object path.
    if (input.path.includes("..") || !/^[A-Za-z0-9_\-./]+$/.test(input.path)) {
      throw badRequest("Invalid storage path.");
    }

    const bucket = input.bucket === "product-images" ? PRODUCT_IMAGE_BUCKET : SCREENSHOT_BUCKET;
    const expiresIn = input.scope === "share" ? shareTtlSeconds() : screenshotTtlSeconds();

    const admin = createAdminSupabaseClient();
    const signedUrl = await createSignedImageUrl(admin, bucket, input.path, expiresIn);
    if (!signedUrl) throw notFound("That object does not exist.");

    return jsonOk({
      signedUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
