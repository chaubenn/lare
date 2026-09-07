import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)] p-4",
        className,
      )}
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
      <h2 className="lare-label text-[var(--text-tertiary)]">{children}</h2>
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
  tracks = LOG_TRACKS,
}: {
  columns?: string[];
  children: ReactNode;
  className?: string;
  /** Grid tracks. Defaults to the shared drafts/sessions/recordings columns. */
  tracks?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)]",
        className,
      )}
    >
      <ul className={cn("sm:grid sm:items-center sm:gap-x-3", tracks)}>
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
        "lare-row lare-press border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] first:border-t-0 hover:bg-[color-mix(in_oklab,var(--surface-raised)_50%,transparent)] focus-within:bg-[color-mix(in_oklab,var(--surface-raised)_60%,transparent)]",
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
        "lare-micro hidden py-1.5 font-medium text-[var(--text-tertiary)] sm:grid",
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
  sticky = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  count?: ReactNode;
  sticky?: boolean;
}) {
  return (
    <header
      className={cn(
        "mb-4 flex flex-wrap items-end justify-between gap-3",
        sticky && "lare-material-thin sticky top-0 z-10 -mx-5 px-5 pt-4 pb-3",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h1 className="lare-heading truncate text-[var(--text)]">{title}</h1>
          {count !== undefined ? (
            <span className="lare-micro tabular-nums text-[var(--text-tertiary)]">{count}</span>
          ) : null}
        </div>
        {subtitle ? <p className="mt-0.5 text-sm text-[var(--text-tertiary)]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
