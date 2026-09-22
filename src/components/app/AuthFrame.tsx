import type { ReactNode } from "react";

/**
 * Frame for the three signed-out screens (sign in, register, verify).
 *
 * The left column is the product's one piece of theatre: the same six-stage
 * rail the order tracker uses, drawn inert. It says "this is a progress tool"
 * before a single word is read, and it keeps the three screens feeling like
 * parts of one thing rather than three separate forms.
 */
const RAIL = [
  "Claimed",
  "Order submitted",
  "Review pending",
  "Review submitted",
  "Approved",
  "Paid",
];

export function AuthFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-paper-50 font-body text-ink-800 dark:bg-ink-900 dark:text-paper-100 lg:grid lg:grid-cols-[1fr_1.05fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-12 text-paper-50 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-10 h-96 w-96 rounded-full bg-signal-500/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 bottom-0 h-72 w-72 rounded-full bg-done-500/15 blur-3xl"
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-paper-50 font-data text-[13px] font-semibold text-ink-900">
            R
          </span>
          <span className="font-display text-[17px] font-semibold tracking-tight">Review Ops</span>
        </div>

        <div className="relative">
          <h2 className="max-w-sm font-display text-[34px] font-semibold leading-[1.15] tracking-tight">
            Every order, from claim to cashback.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-paper-200/70">
            Upload your proof once. We read the details, you confirm them, and the tracker shows
            exactly where things stand.
          </p>

          <ol className="mt-10 space-y-0">
            {RAIL.map((stage, index) => (
              <li key={stage} className="flex items-stretch gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      index < 3 ? "bg-signal-500" : "bg-paper-50/20"
                    }`}
                  />
                  {index < RAIL.length - 1 ? (
                    <span
                      className={`w-px flex-1 ${index < 3 ? "bg-signal-500/50" : "bg-paper-50/12"}`}
                    />
                  ) : null}
                </div>
                <span
                  className={`pb-4 font-body text-[13px] ${
                    index < 3 ? "text-paper-50" : "text-paper-200/45"
                  }`}
                >
                  {stage}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="relative font-data text-[11px] uppercase tracking-[0.18em] text-paper-200/40">
          Proof checked by a human, every time
        </p>
      </section>

      <section className="flex min-h-screen flex-col justify-center px-5 py-12 sm:px-10 lg:min-h-0">
        <div className="mx-auto w-full max-w-[26rem]">
          <div className="flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-900 font-data text-[13px] font-semibold text-paper-50 dark:bg-paper-100 dark:text-ink-900">
              R
            </span>
            <span className="font-display text-[17px] font-semibold tracking-tight text-ink-900 dark:text-paper-50">
              Review Ops
            </span>
          </div>

          <h1 className="mt-8 font-display text-[26px] font-semibold tracking-tight text-ink-900 dark:text-paper-50 lg:mt-0">
            {title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-500 dark:text-paper-200/60">
            {subtitle}
          </p>

          <div className="mt-7">{children}</div>

          {footer ? (
            <div className="mt-6 text-center text-[13px] text-ink-500 dark:text-paper-200/60">
              {footer}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
