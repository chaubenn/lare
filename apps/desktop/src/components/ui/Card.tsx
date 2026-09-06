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

/**
 * Shared tracks for drafts / sessions / recordings. The list is one grid; each row
 * is `subgrid` so a wide actions cell cannot shift When/Time under the wrong header.
 */
export const LOG_TRACKS = "sm:grid-cols-[minmax(0,1fr)_6rem_9rem_4.5rem_7rem_minmax(7rem,auto)]";

/**
 * Rows and the header row are the same shape: full-bleed for the hover stripe and the
 * divider, padded inside, and subgridded so every cell sits under its own label.
 */
const LOG_ROW =
  "grid grid-cols-1 items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:col-span-full sm:grid-cols-subgrid";

/** Shared list chrome for Sessions, Recordings, Drafts, and the feed. */
export function StackedList({
  columns,
  children,
  className,
}: {
  columns?: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-zinc-800", className)}>
      <ul className={cn("sm:grid sm:items-center sm:gap-x-3", LOG_TRACKS)}>
        {columns ? <LogColumns columns={columns} /> : null}
        {children}
      </ul>
    </div>
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
        LOG_ROW,
        "lare-row border-t border-zinc-800/80 first:border-t-0 hover:bg-zinc-900/50 focus-within:bg-zinc-900/60",
        className,
      )}
    >
      {children}
    </li>
  );
}

/** Column labels on the same subgrid — and the same padding — as the rows. */
export function LogColumns({ columns }: { columns: string[] }) {
  return (
    <li
      className={cn(
        LOG_ROW,
        "hidden py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600 sm:grid",
      )}
      aria-hidden
    >
      {columns.map((col) => (
        <span key={col} className="truncate">
          {col}
        </span>
      ))}
      <span />
    </li>
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
