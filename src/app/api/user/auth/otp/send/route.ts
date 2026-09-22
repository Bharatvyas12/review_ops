import { requireUserSession } from "@/lib/auth";
import { ApiError, errorResponse, jsonOk } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { issuePhoneOtp } from "@/lib/otp-service";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Sends (or re-sends) the phone code for the signed-in user. */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireUserSession();

    await enforceRateLimit(request, {
      bucket: "otp-send:ip",
      limit: 10,
      windowMs: 15 * 60_000,
      redis: serverEnv.rateLimitRedis,
    });

    // Per account, so one user cannot be used as an SMS pump.
    await enforceRateLimit(request, {
      bucket: "otp-send:user",
      limit: 3,
      windowMs: 15 * 60_000,
      identifier: session.userId,
      redis: serverEnv.rateLimitRedis,
    });

    const phone = session.profile.phone;
    if (!phone) {
      throw new ApiError(400, "Add a mobile number to your account first.", "phone_missing");
    }

    const result = await issuePhoneOtp(session.userId, phone);

    // In production an unconfigured provider is a hard error: refusing loudly
    // here is what stops a missing credential from silently disabling the
    // verification requirement.
    if (!result.issued) {
      throw new ApiError(
        503,
        "Phone verification is temporarily unavailable. Please try again later.",
        "sms_not_configured",
      );
    }

    return jsonOk({
      ok: true,
      delivered: result.delivered,
      smsConfigured: result.smsConfigured,
      maskedPhone: result.maskedPhone,
      expiresAt: result.expiresAt,
      // Development only: this flag (never the code) lets the UI explain where
      // to look. It is absent in production.
      devNotice: !result.smsConfigured && !serverEnv.isProduction ? "sms_not_configured_dev" : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
