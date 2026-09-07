import { formatLocalTimestamp } from "@lare/shared";
import { Tooltip } from "@lare/ui/primitives";

/** Absolute time in the viewer's timezone. Hydration is suppressed because SSR is UTC. */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const label = formatLocalTimestamp(iso);
  return (
    <Tooltip label={label}>
      <time dateTime={iso} className={className} suppressHydrationWarning>
        {label}
      </time>
    </Tooltip>
  );
}
