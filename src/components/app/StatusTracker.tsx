import { IconAlert, IconCheck } from "@/components/ui/icons";
import { ORDER_STAGES, trackerState } from "@/lib/user-orders";
import type { OrderStatus } from "@/lib/types";

/**
 * The six-stage order tracker.
 *
 * Built as a rail rather than a checklist: the connecting segments are drawn
 * from the stage above, so the progress visibly fills the line as the order
 * advances, and each segment animates in with a stagger. The active stage gets
 * a pulsing marker, which is what makes the current position obvious on a
 * phone at arm's length.
 *
 * Render-only, so it works from a server component and costs no JavaScript.
 */
export function StatusTracker({
  status,
  rejectionReason,
  reviewSubmittedAt,
  compact = false,
}: {
  status: OrderStatus;
  rejectionReason?: string | null;
  reviewSubmittedAt?: string | null;
  compact?: boolean;
}) {
  const tracker = trackerState({ status, review_submitted_at: reviewSubmittedAt ?? null });
  const activeStage = tracker.stages.find((stage) => stage.active);

  return (
    <div className={compact ? "" : "u-card overflow-hidden"}>
      {tracker.rejected ? (
        <div className="flex gap-3 border-b border-paper-300/70 bg-paper-100/70 p-4 dark:border-white/10 dark:bg-white/5">
          <IconAlert className="mt-0.5 h-5 w-5 shrink-0 text-signal-600" />
          <div className="min-w-0">
            <p className="font-body text-[14px] font-semibold text-ink-900 dark:text-paper-50">
              Rejected
              {tracker.rejectedAt ? (
                <span className="font-normal text-ink-500 dark:text-paper-200/60">
                  {" "}
                  at the {ORDER_STAGES.find((stage) => stage.key === tracker.rejectedAt)?.label.toLowerCase()} stage
                </span>
              ) : null}
            </p>
            <p className="mt-1 font-body text-[13px] leading-relaxed text-ink-600 dark:text-paper-200/70">
              {rejectionReason?.trim() ? rejectionReason : "No reason was given. Contact support."}
            </p>
          </div>
        </div>
      ) : null}

      {!compact ? (
        <div className="border-b border-paper-300/60 px-4 py-3 dark:border-white/10">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-body text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:text-paper-200/50">
              {tracker.rejected ? "Stopped here" : activeStage ? activeStage.label : "Progress"}
            </p>
            <p className="u-data text-[12px] font-semibold text-ink-700 dark:text-paper-100">
              {Math.round(tracker.progress * 100)}%
            </p>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-white/10">
            <div
              className={`h-full origin-left rounded-full ${
                tracker.rejected ? "bg-ink-500/50" : "bg-signal-500"
              }`}
              style={{
                width: `${Math.round(tracker.progress * 100)}%`,
                transition: "width 0.9s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </div>
        </div>
      ) : null}

      <ol className={compact ? "space-y-0" : "p-4"}>
        {tracker.stages.map((stage, index) => {
          const isLast = index === tracker.stages.length - 1;
          const filled = stage.done;

          return (
            <li key={stage.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    stage.done
                      ? "border-done-500 bg-done-500 text-white"
                      : stage.active
                        ? "border-signal-500 bg-signal-50 text-signal-600 dark:bg-signal-500/15"
                        : "border-paper-300 bg-paper-50 text-transparent dark:border-white/15 dark:bg-ink-900"
                  }`}
                >
                  {stage.done ? (
                    <IconCheck className="h-3.5 w-3.5" />
                  ) : stage.active ? (
                    <span className="h-2 w-2 rounded-full bg-signal-500 animate-[live-pulse_1.8s_ease-in-out_infinite]" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-500/25 dark:bg-white/20" />
                  )}
                </span>

                {!isLast ? (
                  <span className="relative my-1 w-px flex-1 bg-paper-300 dark:bg-white/10">
                    <span
                      className={`absolute inset-x-0 top-0 origin-top bg-done-500 ${
                        filled ? "animate-[stage-fill_0.5s_ease-out_both]" : ""
                      }`}
                      style={{
                        height: filled ? "100%" : "0%",
                        animationDelay: `${index * 80}ms`,
                      }}
                    />
                  </span>
                ) : null}
              </div>

              <div className={isLast ? "pb-0" : "pb-5"}>
                <p
                  className={`font-body text-[14px] leading-tight ${
                    stage.active
                      ? "font-semibold text-ink-900 dark:text-paper-50"
                      : filled
                        ? "font-medium text-ink-700 dark:text-paper-100"
                        : "font-medium text-ink-500/70 dark:text-paper-200/40"
                  }`}
                >
                  {stage.label}
                </p>
                {!compact ? (
                  <p
                    className={`mt-0.5 font-body text-[12px] leading-relaxed ${
                      stage.active
                        ? "text-ink-600 dark:text-paper-200/70"
                        : "text-ink-500/70 dark:text-paper-200/35"
                    }`}
                  >
                    {stage.hint}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
