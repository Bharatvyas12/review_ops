"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SignOutButton } from "@/components/admin/SignOutButton";
import {
  IconBox,
  IconBuilding,
  IconClose,
  IconDashboard,
  IconMegaphone,
  IconMenu,
  IconStar,
  IconUsers,
  IconWallet,
} from "@/components/ui/icons";
import { initials } from "@/lib/format";

export type NavCounts = { reviews: number };

const NAV = [
  { href: "/admin", label: "Dashboard", icon: IconDashboard },
  { href: "/admin/products", label: "Products", icon: IconBox },
  { href: "/admin/brands", label: "Brands", icon: IconBuilding },
  { href: "/admin/campaigns", label: "Campaigns", icon: IconMegaphone },
  { href: "/admin/reviews", label: "Review approvals", icon: IconStar, countKey: "reviews" },
  { href: "/admin/payments", label: "Payments", icon: IconWallet },
  { href: "/admin/users", label: "Users", icon: IconUsers },
] as const;

export function AdminShell({
  name,
  email,
  counts,
  children,
}: {
  name: string;
  email: string | null;
  counts: NavCounts;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map((item) => {
        const active = isActive(item.href);
        const count = "countKey" in item ? counts[item.countKey] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`nav-link ${active ? "nav-link-active" : ""}`}
          >
            <item.icon className="h-4.5 w-4.5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {count > 0 ? (
              <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[11px] font-bold text-amber-950">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 px-3 py-1">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-xs font-bold text-white shadow-lg">
        RO
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">Review Ops</p>
        <p className="truncate text-[11px] text-slate-400">Admin console</p>
      </div>
    </div>
  );

  const footer = (
    <div className="mt-6 rounded-2xl bg-white/5 p-3 ring-1 ring-inset ring-white/10">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/25 text-xs font-semibold text-white">
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{name}</p>
          <p className="truncate text-[11px] text-slate-400">{email ?? "admin"}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
          Admin
        </span>
        <SignOutButton />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16.5rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-4 bg-slate-950 p-4 lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          />
          <div className="relative flex h-full w-72 flex-col gap-4 bg-slate-950 p-4 shadow-2xl animate-[var(--animate-slide-up)]">
            <div className="flex items-start justify-between">
              {brand}
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="btn-ghost h-8 w-8 rounded-full p-0 text-slate-300 hover:text-white"
                aria-label="Close"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/80 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="btn-ghost h-9 w-9 rounded-xl p-0 lg:hidden"
            aria-label="Open navigation"
          >
            <IconMenu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {NAV.find((item) => isActive(item.href))?.label ?? "Admin"}
            </p>
          </div>

          <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Audit logging on
          </span>
          <ThemeToggle />
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
