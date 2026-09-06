import { cn } from "@lare/ui";
import type { ReactNode } from "react";

type Align = "start" | "center" | "end";

/**
 * Hover/focus label for icon-only controls. The child should already expose an
 * accessible name (`aria-label` or visible text); this is the visual hint.
 */
export function Tooltip({
  label,
  children,
  align = "center",
  className,
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: Align;
  className?: string;
}) {
  return (
    <span className={cn("t-tt-wrap", className)} data-align={align}>
      {children}
      <span className="t-tt" role="tooltip">
        {label}
      </span>
    </span>
  );
}
