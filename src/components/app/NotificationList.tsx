"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { formatRelative } from "@/lib/format";
import { IconBell } from "@/components/ui/icons";
import type { NotificationRow } from "@/lib/types";

/**
 * The notification feed.
 *
 * Realtime keeps it current while it is open, and marking something read is
 * optimistic so the list responds to the tap immediately. The server re-filters
 * by user_id anyway, so a forged id can only ever affect the caller's own row.
 */
export function NotificationList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);

  useRealtimeRefresh("notifications");

  const isRead = (item: NotificationRow) => read[item.id] ?? item.is_read;
  const unreadCount = items.filter((item) => !isRead(item)).length;

  async function markAll() {
    setPending(true);
    setRead(Object.fromEntries(items.map((item) => [item.id, true])));
    try {
      await apiRequest("/api/user/notifications/read", { body: { all: true } });
      router.refresh();
    } catch {
      // Put the optimistic state back if the write did not land.
      setRead({});
    } finally {
      setPending(false);
    }
  }

  async function markOne(id: string) {
    setRead((current) => ({ ...current, [id]: true }));
    try {
      await apiRequest("/api/user/notifications/read", { body: { id } });
      router.refresh();
    } catch {
      setRead((current) => ({ ...current, [id]: false }));
    }
  }

  if (items.length === 0) {
    return (
      <div className="u-card px-6 py-14 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-paper-100 text-ink-500 dark:bg-white/5 dark:text-paper-200/60">
          <IconBell className="h-5 w-5" />
        </span>
        <p className="mt-3 font-display text-[15px] font-semibold text-ink-900 dark:text-paper-50">
          Nothing to report
        </p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-ink-500 dark:text-paper-200/60">
          Status changes on your orders land here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {unreadCount > 0 ? (
        <div className="flex items-center justify-between gap-3 pb-3">
          <p className="font-body text-[13px] text-ink-500 dark:text-paper-200/60">
            {unreadCount} unread
          </p>
          <button type="button" onClick={markAll} disabled={pending} className="u-btn-ghost !text-[13px]">
            Mark all as read
          </button>
        </div>
      ) : null}

      <ul className="u-card divide-y divide-paper-300/60 overflow-hidden dark:divide-white/10">
        {items.map((item) => {
          const itemRead = isRead(item);
          const body = (
            <>
              <span
                aria-hidden="true"
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  itemRead ? "bg-transparent" : "bg-signal-500"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`font-body text-[13.5px] leading-relaxed ${
                    itemRead
                      ? "text-ink-500 dark:text-paper-200/50"
                      : "font-medium text-ink-800 dark:text-paper-100"
                  }`}
                >
                  {item.message}
                </p>
                <p className="mt-1 font-data text-[11px] uppercase tracking-[0.1em] text-ink-500/70 dark:text-paper-200/35">
                  {formatRelative(item.created_at)}
                </p>
              </div>
            </>
          );

          return (
            <li key={item.id} className="flex">
              {item.related_order_id ? (
                <Link
                  href={`/app/orders/${item.related_order_id}`}
                  onClick={() => void markOne(item.id)}
                  className="flex w-full gap-3 px-4 py-3.5 transition hover:bg-paper-100/70 dark:hover:bg-white/5"
                >
                  {body}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => void markOne(item.id)}
                  className="flex w-full gap-3 px-4 py-3.5 text-left transition hover:bg-paper-100/70 dark:hover:bg-white/5"
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
