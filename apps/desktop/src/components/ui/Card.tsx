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
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
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
        "transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-zinc-900/40",
        className,
      )}
    >
      {children}
    </li>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-zinc-100">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-zinc-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
