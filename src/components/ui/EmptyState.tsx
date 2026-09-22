import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  icon = "✓",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-lg text-brand-600 ring-1 ring-inset ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/20">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
