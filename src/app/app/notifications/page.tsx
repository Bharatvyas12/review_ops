import type { Metadata } from "next";
import { requireUserOrRedirect } from "@/lib/auth";
import { NotificationList } from "@/components/app/NotificationList";
import type { NotificationRow } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const session = await requireUserOrRedirect("/app/notifications");

  const { data, error } = await session.supabase
    .from("notifications")
    .select("*")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const items = (data ?? []) as NotificationRow[];

  return (
    <div>
      <header className="pb-5">
        <p className="u-data text-[11px] uppercase tracking-[0.18em] text-ink-500 dark:text-paper-200/50">
          Activity
        </p>
        <h1 className="mt-1 font-display text-[24px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          Notifications
        </h1>
      </header>

      <NotificationList items={items} />
    </div>
  );
}
