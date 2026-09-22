"use client";

import { slotsLeft } from "@/lib/user-orders";

/**
 * The slot gauge. Counts the slots that have been released, so a staggered
 * product reads as a small batch filling up rather than a bar that never moves.
 *
 * Reads like an instrument rather than a progress decoration: a segmented track
 * that fills, the exact figures in tabular mono, and a one-shot tick on the
 * number when somebody else claims. The tick is what makes a live counter feel
 * live instead of just updating between refreshes.
 */
export function SlotMeter({
  filled,
  released,
  changed,
  size = "md",
}: {
  filled: number;
  /** Slots opened so far, which is what "of" means to a reviewer. */
  released: number;
  changed: boolean;
  size?: "md" | "lg";
}) {
  const safeReleased = Math.max(1, released);
  const pct = Math.min(100, Math.round((filled / safeReleased) * 100));
  const left = slotsLeft({ slots_filled: filled, released_slots: released });
  const soldOut = left <= 0;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span
            key={filled}
            className={`u-data font-semibold leading-none ${
              size === "lg" ? "text-3xl" : "text-2xl"
            } ${soldOut ? "text-ink-500 dark:text-paper-200/50" : "text-ink-900 dark:text-paper-50"} ${
              changed ? "animate-[slot-tick_0.6s_cubic-bezier(0.22,1,0.36,1)]" : ""
            }`}
          >
            {left}
          </span>
          <span className="font-body text-[12px] font-medium uppercase tracking-[0.14em] text-ink-500 dark:text-paper-200/50">
            {left === 1 ? "slot left" : "slots left"}
          </span>
        </div>
        <span className="u-data text-[12px] text-ink-500 dark:text-paper-200/50">
          {filled}/{released}
        </span>
      </div>

      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={released}
        aria-valuenow={filled}
        aria-label={`${left} of ${released} slots left`}
        className={`mt-2 h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-white/10 ${
          changed ? "animate-[slot-flash_0.9s_ease-out]" : ""
        }`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${
            soldOut
              ? "bg-ink-500/50 dark:bg-white/25"
              : pct > 80
                ? "bg-signal-600"
                : "bg-done-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
