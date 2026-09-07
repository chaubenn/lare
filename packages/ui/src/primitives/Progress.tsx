import { cn } from "../cn";

export function Progress({
  value,
  className,
  barClassName,
  label,
}: {
  /** 0–100. Omit for an indeterminate pulse. */
  value?: number | null;
  className?: string;
  barClassName?: string;
  label?: string;
}) {
  const known = typeof value === "number" && Number.isFinite(value);
  const pct = known ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(pct) : undefined}
      aria-label={label}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full bg-[var(--lare-info)] transition-[width] duration-(--duration-fast) ease-(--ease-smooth-out)",
          !known && "w-1/3 animate-pulse",
          barClassName,
        )}
        style={known ? { width: `${pct}%` } : undefined}
      />
    </div>
  );
}
