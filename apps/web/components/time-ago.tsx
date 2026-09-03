import { formatRelativeTime } from "@lare/shared";

/** Relative timestamp; hydration warnings are suppressed since "3m ago" drifts between renders. */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const date = new Date(iso);
  return (
    <time
      dateTime={iso}
      title={date.toLocaleString()}
      className={className}
      suppressHydrationWarning
    >
      {formatRelativeTime(iso)}
    </time>
  );
}
