import { requireAdminSession } from "@/lib/auth";
import { ApiError, badRequest, errorResponse, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { MAX_UPLOAD_BYTES, validateImageUpload } from "@/lib/storage";
import { extractOrderFromScreenshot } from "@/lib/ai/extract-order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Server-side Claude extraction. Phase 2's user panel reuses this endpoint; the
 * admin-only guard here is intentional for now.
 *
 * One request = one screenshot. No other user data is attached to the payload.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireAdminSession();

    await enforceRateLimit(request, {
      bucket: "extract:admin",
      limit: 20,
      windowMs: 60_000,
      identifier: session.userId,
      redis:
        serverEnv.upstashUrl && serverEnv.upstashToken
          ? { url: serverEnv.upstashUrl, token: serverEnv.upstashToken }
          : undefined,
    });

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

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw badRequest("A file must be attached as `file`.");
    }

    const validation = await validateImageUpload(file);
    if (!validation.ok) {
      throw new ApiError(validation.status, validation.error, "invalid_upload");
    }

    const extraction = await extractOrderFromScreenshot({
      bytes: validation.bytes,
      mimeType: validation.mimeType,
    });

    return jsonOk({ extraction });
  } catch (error) {
    return errorResponse(error);
  }
}
