import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, publicEnv } from "@/lib/env/public";
import { getVerifiedClaims } from "@/lib/supabase/server";

/**
 * Layer 1 of the two-level admin protection: keeps unauthenticated and
 * non-admin users away from /admin/*, and refreshes the Supabase session cookie.
 *
 * This is a UX gate only. Every route handler and every database function
 * re-checks admin rights independently  see src/lib/auth.ts.
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const isUserArea = pathname === "/app" || pathname.startsWith("/app/");
  const isUserAuthPage = pathname === "/app/login" || pathname === "/app/register";

  if (!isSupabaseConfigured) {
    if (isAdminArea) {
      return NextResponse.redirect(new URL("/login?setup=1", request.url));
    }
    if (isUserArea) {
      return NextResponse.redirect(new URL("/app/login?setup=1", request.url));
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  let sessionCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];

  const withCookies = (target: NextResponse) => {
    for (const cookie of sessionCookies) {
      target.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return target;
  };

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        sessionCookies = cookiesToSet.map(({ name, value, options }) => ({
          name,
          value,
          options: options as Record<string, unknown> | undefined,
        }));
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        withCookies(response);
      },
    },
  });

  // Identity is verified against the project's signing keys locally rather than
  // by calling the Auth server on every request. getSession() inside the helper
  // still runs first, which is what refreshes an expiring session and pushes the
  // new cookies onto the response below.
  const claims = await getVerifiedClaims(supabase);
  const user = claims ? { id: claims.userId } : null;

  if (isAdminArea) {
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return withCookies(NextResponse.redirect(loginUrl));
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.role !== "admin") {
      return withCookies(NextResponse.redirect(new URL("/login?denied=1", request.url)));
    }
  }

  if (pathname === "/login" && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.role === "admin") {
      return withCookies(NextResponse.redirect(new URL("/admin", request.url)));
    }
  }

  // The user panel. Same idea as the admin gate: this keeps people out of the
  // wrong area and refreshes the session cookie, while every route handler and
  // every SECURITY DEFINER function re-checks authorization independently.
  if (isUserArea) {
    if (!user && !isUserAuthPage) {
      const loginUrl = new URL("/app/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return withCookies(NextResponse.redirect(loginUrl));
    }

    if (user && isUserAuthPage) {
      return withCookies(NextResponse.redirect(new URL("/app", request.url)));
    }
  }

  return withCookies(response);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
