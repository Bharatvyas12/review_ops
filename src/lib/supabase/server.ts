import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env/public";

/**
 * Request-scoped Supabase client for React Server Components, route handlers
 * and middleware. It carries the *anon* key plus the caller's auth cookies, so
 * every query it makes is filtered by RLS. It is never given the service role.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies are read-only.
          // Session refresh is handled by middleware instead.
        }
      },
    },
  });
}

export type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * Verifies the caller's identity from the session cookie.
 *
 * This project signs tokens with an asymmetric key (ES256), so getClaims() can
 * check the JWT signature locally against the project's JWKS instead of asking
 * the Auth server. That is the difference between a ~5 ms check and a ~420 ms
 * network round trip on every single page load, which is what made the app feel
 * slow.
 *
 * It is a real verification, not a decode: a token whose payload has been edited
 * is rejected with "Invalid JWT signature", and an expired token is rejected
 * too. Supabase's own guidance is to establish identity with getClaims() or a
 * JWT verification library rather than trusting the stored user object.
 *
 * getSession() still runs first, for two reasons: it returns null immediately
 * when there is no cookie at all, and it is what triggers a refresh of an
 * expired session, which the middleware then persists into the response
 * cookies.
 */
export async function getVerifiedClaims(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<{ userId: string; email: string | null } | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return null;

  // The token is passed explicitly: with no argument getClaims() would fall
  // back to the anon key's own claims, which represent nobody.
  const { data, error } = await supabase.auth.getClaims(accessToken);
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string" || sub.length === 0) return null;

  const email = (data?.claims as { email?: unknown }).email;
  return { userId: sub, email: typeof email === "string" ? email : null };
}