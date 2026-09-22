import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ApiError, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { registerSchema } from "@/lib/validation";
import { issuePhoneOtp } from "@/lib/otp-service";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Creates the account, signs the new user in, and sends the first phone code.
 *
 * The Auth user is created with the service role (the anon key cannot confirm
 * an address without an email round trip), but nothing else here is privileged:
 * the profile row is written with public columns only, and the phone stays
 * unverified until the code is checked server-side.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await enforceRateLimit(request, {
      bucket: "register:ip",
      limit: 5,
      windowMs: 15 * 60_000,
      redis: serverEnv.rateLimitRedis,
    });

    const input = await parseJson(request, registerSchema);

    await enforceRateLimit(request, {
      bucket: "register:email",
      limit: 3,
      windowMs: 60 * 60_000,
      identifier: input.email,
      redis: serverEnv.rateLimitRedis,
    });

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName, phone: input.phone },
    });

    if (error) {
      if (/already|exists|registered/i.test(error.message)) {
        throw new ApiError(
          409,
          "That email is already registered. Sign in instead.",
          "email_taken",
        );
      }
      // The provider message can carry internal detail, so it is not echoed.
      throw new ApiError(500, "We could not create your account. Please try again.", "register_failed");
    }

    const userId = data.user?.id;
    if (!userId) {
      throw new ApiError(500, "We could not create your account. Please try again.", "register_failed");
    }

    // The on_auth_user_created trigger already inserts the profile; this makes
    // the name and phone explicit rather than depending on metadata plumbing.
    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        full_name: input.fullName,
        phone: input.phone,
        role: "user",
        phone_verified: false,
      },
      { onConflict: "id" },
    );

    if (profileError) throw profileError;

    // Sign in so the verification step has a session to attach the code to.
    const supabase = await createServerSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (signInError) {
      // The account exists and the password is correct, so this is recoverable
      // by signing in manually - never pretend it succeeded.
      return jsonOk(
        { ok: true, signedIn: false, redirectTo: "/app/login", otp: null },
        { status: 201 },
      );
    }

    const otp = await issuePhoneOtp(userId, input.phone);

    return jsonOk({ ok: true, signedIn: true, redirectTo: "/app/verify", otp }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
