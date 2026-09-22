"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  IconAlert,
  IconBell,
  IconClipboard,
  IconHome,
  IconSettings,
  IconWallet,
} from "@/components/ui/icons";
import { UserSignOutButton } from "@/components/app/UserSignOutButton";
import { initials } from "@/lib/format";

const NAV = [
  { href: "/app", label: "Feed", icon: IconHome },
  { href: "/app/orders", label: "Orders", icon: IconClipboard },
  { href: "/app/payments", label: "Paid", icon: IconWallet },
  { href: "/app/notifications", label: "Alerts", icon: IconBell, badge: true },
  { href: "/app/settings", label: "You", icon: IconSettings },
] as const;

/**
 * The reviewer's frame: thumb-reachable bottom tabs on a phone, a single
 * horizontal strip once there is room. Deliberately not a copy of the admin
 * rail - different audience, different posture.
 */
export function AppShell({
  name,
  email,
  phoneVerified,
  unreadCount,
  children,
}: {
  name: string;
  email: string | null;
  phoneVerified: boolean;
  unreadCount: number;
  children: ReactNode;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-paper-50 font-body text-ink-800 dark:bg-ink-900 dark:text-paper-100">
      <header className="sticky top-0 z-30 border-b border-paper-300/70 bg-paper-50/90 backdrop-blur-md dark:border-white/10 dark:bg-ink-900/90">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <Link href="/app" className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-900 font-data text-[13px] font-semibold text-paper-50 dark:bg-paper-100 dark:text-ink-900"
            >
              R
            </span>
            <span className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
              Review Ops
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`rounded-lg px-3 py-2 font-body text-sm font-medium transition ${
                  isActive(item.href)
                    ? "bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-ink-900"
                    : "text-ink-600 hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-white/5"
                }`}
              >
                {item.label}
                {"badge" in item && item.badge && unreadCount > 0 ? (
                  <span className="ml-1.5 rounded-full bg-signal-500 px-1.5 py-0.5 font-data text-[10px] font-semibold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/app/notifications"
              aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
              className="relative rounded-lg p-2 text-ink-600 transition hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-white/5 lg:hidden"
            >
              <IconBell className="h-5 w-5" />
              {unreadCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-signal-500 ring-2 ring-paper-50 dark:ring-ink-900" />
              ) : null}
            </Link>
            <Link
              href="/app/settings"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-200 font-body text-[12px] font-semibold text-ink-700 transition hover:bg-paper-300 dark:bg-white/10 dark:text-paper-100"
              title={email ?? name}
            >
              {initials(name)}
            </Link>
          </div>
        </div>
      </header>

      {!phoneVerified ? (
        <div className="border-b border-signal-100 bg-signal-50 dark:border-signal-500/20 dark:bg-signal-500/10">
          <div className="mx-auto flex w-full max-w-3xl items-start gap-2.5 px-4 py-2.5">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-signal-600 dark:text-signal-500" />
            <p className="font-body text-[13px] leading-snug text-signal-700 dark:text-signal-100">
              Verify your mobile number to claim products.{" "}
              <Link href="/app/verify" className="font-semibold underline underline-offset-2">
                Send the code
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 lg:pb-14">{children}</main>

      <div className="mx-auto hidden w-full max-w-3xl items-center justify-between px-4 pb-10 lg:flex">
        <p className="font-body text-xs text-ink-500 dark:text-paper-200/60">
          {name}
          {email ? ` · ${email}` : ""}
        </p>
        <UserSignOutButton />
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-paper-300/70 bg-paper-50/95 backdrop-blur-md dark:border-white/10 dark:bg-ink-900/95 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-stretch">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 font-body text-[11px] font-medium transition ${
                  active ? "text-signal-600 dark:text-signal-500" : "text-ink-500 dark:text-paper-200/60"
                }`}
              >
                <span className="relative">
                  <item.icon className="h-5 w-5" />
                  {"badge" in item && item.badge && unreadCount > 0 ? (
                    <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-signal-500" />
                  ) : null}
                </span>
                {item.label}
                {active ? (
                  <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-signal-500" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
