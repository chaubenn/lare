"use client";

import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "../cn";
import { SPRING } from "../motion";

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
    <div className={cn("rounded-[var(--lare-r-2)] border border-[var(--border)]", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="lare-press flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[color-mix(in_oklab,var(--surface-raised)_60%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={SPRING.ui}
          className="inline-flex"
        >
          <ChevronRight className="size-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
        </motion.span>
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={id}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING.ui}
            className="overflow-hidden border-t border-[var(--border)]"
          >
            <div className="px-3 py-3">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
