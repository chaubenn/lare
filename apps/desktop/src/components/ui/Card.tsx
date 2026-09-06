import { cn } from "@lare/ui";
import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-zinc-800 bg-zinc-900/40 p-4", className)}
      {...rest}
    />
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-3", className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{children}</h2>
      {action}
    </div>
  );
}

/** Shared list chrome for Sessions, Recordings, Drafts, and the feed. */
export function StackedList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn("divide-y divide-zinc-800/80 rounded-xl border border-zinc-800", className)}>
      {children}
    </ul>
  );
}

export function StackedListItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "lare-row first:rounded-t-xl last:rounded-b-xl hover:bg-zinc-900/50",
        className,
      )}
    >
      {children}
    </li>
  );
}

/** Column labels for the denser workbench lists. Hidden on narrow panes. */
export function LogColumns({ columns }: { columns: string[] }) {
  return (
    <div
      className="mb-1 hidden grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.7fr))_auto] gap-3 px-3 text-[10px] font-medium uppercase tracking-wider text-zinc-600 sm:grid"
      aria-hidden
    >
      {columns.map((col) => (
        <span key={col} className="truncate">
          {col}
        </span>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  count,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  count?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h1 className="truncate text-lg font-semibold text-zinc-100">{title}</h1>
          {count !== undefined ? (
            <span className="text-xs tabular-nums text-zinc-500">{count}</span>
          ) : null}
        </div>
        {subtitle ? <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
