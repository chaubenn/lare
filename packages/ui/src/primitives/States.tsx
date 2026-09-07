"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../cn";
import { Button } from "./Button";
import { StackedList, StackedListItem } from "./Card";

function formatError(error: unknown, fallback = "Something went wrong"): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <output
      className={cn(
        "flex items-center justify-center gap-2 text-[var(--text-tertiary)]",
        className,
      )}
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </output>
  );
}

export function PageSpinner({ label = "Loading…" }: { label?: string }) {
  return <Spinner className="py-16" label={label} />;
}

/** Stable keys so the placeholder rows are not keyed by index. */
const SKELETON_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** Placeholder rows on the same tracks as the real list, so nothing jumps on load. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden>
      <StackedList>
        {SKELETON_KEYS.slice(0, rows).map((key) => (
          <StackedListItem key={key} className="hover:bg-transparent">
            <span className="lare-skel h-4 w-3/5" />
            <span className="lare-skel hidden h-3 w-16 sm:block" />
            <span className="lare-skel hidden h-3 w-28 sm:block" />
            <span className="lare-skel hidden h-3 w-10 sm:block" />
            <span className="lare-skel hidden h-3 w-20 sm:block" />
            <span className="lare-skel hidden h-3 w-10 justify-self-end sm:block" />
          </StackedListItem>
        ))}
      </StackedList>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--lare-r-4)] border border-dashed border-[var(--border)] px-5 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-3 text-[var(--text-tertiary)]">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
      {description ? (
        <div className="mt-1 max-w-md text-sm leading-relaxed text-[var(--text-tertiary)]">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-[var(--lare-r-4)] border border-[color-mix(in_oklab,var(--lare-danger)_20%,transparent)] bg-[color-mix(in_oklab,var(--lare-danger)_5%,transparent)] px-6 py-10 text-center"
    >
      <CircleAlert className="mb-2 size-5 text-[var(--lare-danger)]" aria-hidden />
      <h3 className="text-sm font-semibold text-[var(--lare-danger)]">{title}</h3>
      <p className="mt-1 max-w-md break-words text-sm text-[color-mix(in_oklab,var(--lare-danger)_80%,transparent)]">
        {formatError(error)}
      </p>
      {onRetry ? (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
