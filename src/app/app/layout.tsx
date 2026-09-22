import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { getSessionUser, isPhoneVerified } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Frame for the user panel.
 *
 * Access control is not decided here: the middleware gates /app/* and every
 * page calls requireUserOrRedirect() itself. This layout only decides whether a
 * session is present, so /app/login and /app/register can render bare.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSessionUser();

  if (!session?.profile) return <>{children}</>;

  const { count } = await session.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.userId)
    .eq("is_read", false);

  return (
    <AppShell
      name={session.profile.full_name}
      email={session.email}
      phoneVerified={isPhoneVerified(session.profile)}
      unreadCount={count ?? 0}
    >
      {children}
    </AppShell>
  );
}
