import { formatLocalTimestamp } from "@lare/shared";

/** Absolute time in the viewer's timezone. Hydration is suppressed because SSR is UTC. */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  return (
    <time
      dateTime={iso}
      title={formatLocalTimestamp(iso)}
      className={className}
      suppressHydrationWarning
    >
      {formatLocalTimestamp(iso)}
    </time>
  );
}
