import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ApiError, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";
import { loginSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Same generic message for a wrong password and an unknown address. */
const GENERIC_FAILURE = "Invalid email or password.";

async function hashIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request): Promise<Response> {
  try {
    await enforceRateLimit(request, {
      bucket: "userlogin:ip",
      limit: 10,
      windowMs: 60_000,
      redis: serverEnv.rateLimitRedis,
    });

    const { email, password } = await parseJson(request, loginSchema);

    // Second window per account, so rotating addresses does not help.
    await enforceRateLimit(request, {
      bucket: "userlogin:account",
      limit: 8,
      windowMs: 15 * 60_000,
      identifier: await hashIdentifier(email),
      redis: serverEnv.rateLimitRedis,
    });

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      throw new ApiError(401, GENERIC_FAILURE, "invalid_credentials");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, phone_verified")
      .eq("id", data.user.id)
      .maybeSingle();

    const isAdmin = profile?.role === "admin";

    // Staff land in the console; a user who has not verified their phone goes
    // straight back to the code step rather than into a half-usable app.
    return jsonOk({
      ok: true,
      redirectTo: isAdmin ? "/admin" : profile?.phone_verified ? "/app" : "/app/verify",
      phoneVerified: isAdmin ? true : Boolean(profile?.phone_verified),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
