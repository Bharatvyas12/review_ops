import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import {
  createServerSupabaseClient,
  getVerifiedClaims,
  type ServerSupabaseClient,
} from "@/lib/supabase/server";
import { ApiError, forbidden, unauthorized } from "@/lib/http";
import type { ProfileRow } from "@/lib/types";

export type AdminSession = {
  userId: string;
  email: string | null;
  profile: ProfileRow;
  /** Request-scoped, anon-key client: still fully subject to RLS. */
  supabase: ServerSupabaseClient;
};

/**
 * Resolves the caller from their auth cookies.
 *
 * Identity comes from getVerifiedClaims(), which checks the JWT signature
 * against the project's signing keys. It replaces an auth.getUser() call that
 * cost roughly 420 ms on this project, against roughly 5 ms for the local
 * signature check - and it was being paid twice per navigation, once by the
 * middleware and once by the page.
 *
 * The profile read that follows is what supplies role and phone_verified, which
 * is why authorization still cannot be faked from the client: role is read from
 * the database, and the database re-checks it inside every SECURITY DEFINER
 * function as well.
 *
 * Wrapped in React's cache() so a layout and its page share one resolution
 * instead of each paying for it separately.
 */
export const getSessionUser = cache(async (): Promise<{
  userId: string;
  email: string | null;
  profile: ProfileRow | null;
  supabase: ServerSupabaseClient;
} | null> => {
  const supabase = await createServerSupabaseClient();

  const claims = await getVerifiedClaims(supabase);
  if (!claims) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, phone_verified, role, created_at")
    .eq("id", claims.userId)
    .maybeSingle();

  return {
    userId: claims.userId,
    email: claims.email,
    profile: (profile as ProfileRow | null) ?? null,
    supabase,
  };
});

export function isAdminProfile(profile: ProfileRow | null | undefined): boolean {
  return profile?.role === "admin";
}

/**
 * The only accepted way for server code to act as an admin.
 *
 * Middleware also guards /admin/*, but middleware is a redirect layer, not an
 * authorization boundary: every mutation re-checks here, and the database
 * re-checks a third time inside the SECURITY DEFINER functions.
 */
export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getSessionUser();

  if (!session) throw unauthorized();

  if (!isAdminProfile(session.profile)) {
    // Signed in but not an admin: same generic denial either way.
    throw forbidden();
  }

  return {
    userId: session.userId,
    email: session.email,
    profile: session.profile as ProfileRow,
    supabase: session.supabase,
  };
}

/**
 * Server-component counterpart of requireAdminSession: pages redirect instead
 * of throwing. Used by every /admin page as well as the layout, so a page can
 * never rely on the layout alone for its access decision.
 */
export async function requireAdminOrRedirect(): Promise<AdminSession> {
  const session = await getSessionUser();

  if (!session) redirect("/login");
  if (!isAdminProfile(session.profile)) redirect("/login?denied=1");

  return {
    userId: session.userId,
    email: session.email,
    profile: session.profile as ProfileRow,
    supabase: session.supabase,
  };
}

// -----------------------------------------------------------------------------
// User panel.
//
// Same shape and the same rule as the admin side: this resolves the caller from
// verified cookies, and every route that mutates user data calls it *before*
// touching the database - RLS alone is not treated as an authorization check.
// -----------------------------------------------------------------------------

export type UserSession = {
  userId: string;
  email: string | null;
  profile: ProfileRow;
  /** Request-scoped, anon-key client: still fully subject to RLS. */
  supabase: ServerSupabaseClient;
};

function toUserSession(session: {
  userId: string;
  email: string | null;
  profile: ProfileRow | null;
  supabase: ServerSupabaseClient;
}): UserSession | null {
  if (!session.profile) return null;
  return {
    userId: session.userId,
    email: session.email,
    profile: session.profile,
    supabase: session.supabase,
  };
}

export function isPhoneVerified(profile: ProfileRow | null | undefined): boolean {
  return profile?.phone_verified === true;
}

export async function requireUserSession(): Promise<UserSession> {
  const session = await getSessionUser();

  if (!session) throw unauthorized();

  const user = toUserSession(session);
  // A signed-in account with no profile row is a half-finished signup; treat it
  // as unauthenticated rather than guessing at their identity.
  if (!user) throw unauthorized("Finish setting up your account to continue.");

  return user;
}

/**
 * The verified-only variant. Claiming and submitting additionally require a
 * verified phone number, and the database re-checks the same condition inside
 * assert_verified_user(). Both layers exist on purpose: this one produces a
 * friendly API error, that one makes the rule impossible to bypass.
 */
export async function requireVerifiedUserSession(): Promise<UserSession> {
  const session = await requireUserSession();

  if (!isPhoneVerified(session.profile)) {
    throw new ApiError(403, "Verify your phone number to continue.", "phone_unverified");
  }

  return session;
}

/** Server-component counterpart: pages redirect instead of throwing. */
export async function requireUserOrRedirect(nextPath?: string): Promise<UserSession> {
  const session = await getSessionUser();

  if (!session?.profile) {
    const target = nextPath ? `/app/login?next=${encodeURIComponent(nextPath)}` : "/app/login";
    redirect(target);
  }

  return {
    userId: session.userId,
    email: session.email,
    profile: session.profile,
    supabase: session.supabase,
  };
}

/** For pages that only make sense once the phone is verified. */
export async function requireVerifiedUserOrRedirect(nextPath?: string): Promise<UserSession> {
  const session = await requireUserOrRedirect(nextPath);
  if (!isPhoneVerified(session.profile)) redirect("/app/verify");
  return session;
}
