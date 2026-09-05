import { cn } from "@lare/ui";
import type { ReactNode } from "react";

type Side = "top" | "bottom";
type Align = "start" | "center" | "end";

/**
 * Hover/focus label for icon-only controls. The child should already expose an
 * accessible name (`aria-label` or visible text); this is the visual hint.
 */
export function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
  className,
}: {
  label: string;
  children: ReactNode;
  side?: Side;
  align?: Align;
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 shadow-lg shadow-black/40",
          "invisible opacity-0 transition-[opacity,visibility] delay-0 duration-[var(--duration-fast)] ease-(--ease-smooth-out)",
          "group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-200",
          "group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-focus-within/tip:delay-200",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}
