import { cn } from "@lare/ui";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

export function Collapsible({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn("rounded-lg border border-zinc-800", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-900/60"
      >
        <ChevronRight
          className={cn("size-4 shrink-0 text-zinc-500 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </button>
      {open ? (
        <div id={id} className="border-t border-zinc-800 px-3 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
