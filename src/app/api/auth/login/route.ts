import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseJson, errorResponse, jsonOk, ApiError } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Neither the email nor the password ever reaches a log line. */
const GENERIC_FAILURE = "Invalid email or password.";

function redisConfig(): { url: string; token: string } | undefined {
  const url = serverEnv.upstashUrl;
  const token = serverEnv.upstashToken;
  return url && token ? { url, token } : undefined;
}

async function hashIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Two windows: one per source address (credential stuffing) and one per
    // account (targeted brute force, even from rotating addresses).
    await enforceRateLimit(request, {
      bucket: "login:ip",
      limit: 10,
      windowMs: 60_000,
      redis: redisConfig(),
    });

    const { email, password } = await parseJson(request, loginSchema);

    await enforceRateLimit(request, {
      bucket: "login:account",
      limit: 8,
      windowMs: 15 * 60_000,
      identifier: await hashIdentifier(email),
      redis: redisConfig(),
    });

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      throw new ApiError(401, GENERIC_FAILURE, "invalid_credentials");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    // A valid non-admin login is treated exactly like a wrong password, so this
    // page cannot be used to discover which accounts exist.
    if (profile?.role !== "admin") {
      await supabase.auth.signOut();
      throw new ApiError(401, GENERIC_FAILURE, "invalid_credentials");
    }

    return jsonOk({ ok: true, redirectTo: "/admin" });
  } catch (error) {
    return errorResponse(error);
  }
}
