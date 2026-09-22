import type { Metadata } from "next";
import { LoginForm } from "@/components/admin/LoginForm";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SETUP_HINT, isSupabaseConfigured } from "@/lib/env/public";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin sign in",
};

const HIGHLIGHTS = [
  { title: "Review approvals", body: "Approve submitted reviews with the proof attached." },
  { title: "Payout console", body: "Bank details stay encrypted until you reveal them, and every reveal is logged." },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; setup?: string; next?: string }>;
}) {
  const params = await searchParams;
  const configured = isSupabaseConfigured;

  return (
    <main className="relative grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>

      <section className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 top-1/4 h-[28rem] w-[28rem] rounded-full bg-brand-600/30 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-violet-500/20 blur-3xl"
        />

        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold shadow-lg">
              RO
            </span>
            <span className="text-sm font-semibold tracking-wide text-white/90">Review Ops</span>
          </div>

          <h1 className="mt-16 max-w-md text-4xl font-semibold leading-tight tracking-tight">
            Run the review pipeline without losing track of a single order.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-300/90">
            One console for products, review approval and payouts  with an
            audit trail behind every action.
          </p>

          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs">
                  ✓
                </span>
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-0.5 max-w-sm text-sm text-slate-300/80">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-400">
          Admin access is provisioned manually. There is no public sign-up.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white shadow-lg">
              RO
            </span>
          </div>

          <h2 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white lg:mt-0">
            Admin sign in
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Use the credentials issued to your admin account.
          </p>

          {!configured ? (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-semibold">Supabase is not configured</p>
              <p className="mt-1 text-amber-800/90 dark:text-amber-200/80">{SETUP_HINT}</p>
            </div>
          ) : null}

          {params.denied ? (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              That account does not have admin access.
            </div>
          ) : null}

          <LoginForm disabled={!configured} />
        </div>
      </section>
    </main>
  );
}
