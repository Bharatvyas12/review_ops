import { requireUserSession } from "@/lib/auth";
import { ApiError, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { otpVerifySchema } from "@/lib/validation";
import { verifyPhoneOtp, type OtpVerificationStatus } from "@/lib/otp-service";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Maps the database's verdict to a response. The code itself is never echoed,
 * and no branch reveals whether a code existed for a different account.
 */
function failureFor(status: OtpVerificationStatus): ApiError {
  switch (status) {
    case "expired":
      return new ApiError(400, "That code has expired. Request a new one.", "otp_expired");
    case "too_many_attempts":
      return new ApiError(429, "Too many attempts. Request a new code.", "otp_attempts_exceeded");
    case "missing":
      return new ApiError(400, "Request a new code to continue.", "otp_missing");
    case "no_phone":
      return new ApiError(400, "Add a mobile number to your account first.", "phone_missing");
    default:
      return new ApiError(400, "That code is not correct.", "otp_invalid");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireUserSession();

    await enforceRateLimit(request, {
      bucket: "otp-verify:user",
      limit: 10,
      windowMs: 15 * 60_000,
      identifier: session.userId,
      redis: serverEnv.rateLimitRedis,
    });

    const input = await parseJson(request, otpVerifySchema);
    const status = await verifyPhoneOtp(session.userId, input.code);

    if (status !== "verified") throw failureFor(status);

    return jsonOk({ ok: true, phoneVerified: true, redirectTo: "/app" });
  } catch (error) {
    return errorResponse(error);
  }
}
