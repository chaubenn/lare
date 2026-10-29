"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../cn";
import { SPRING } from "../motion";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Centred modal over a dimmed backdrop. Escape and a backdrop click close it.
 * Focus is trapped inside the panel, moves in on open, and returns to the opener on close.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === panel,
      );
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (!firstNode || !lastNode) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === firstNode || !panel.contains(active))) {
        event.preventDefault();
        lastNode.focus();
      } else if (!event.shiftKey && (active === lastNode || !panel.contains(active))) {
        event.preventDefault();
        firstNode.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING.ui}
            className="absolute inset-0 cursor-default bg-[color-mix(in_oklab,var(--surface)_70%,transparent)]"
            style={{ backdropFilter: "blur(var(--lare-blur-chrome))" }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.97, filter: "blur(6px)" }}
            transition={SPRING.ui}
            className={cn(
              "lare-material-regular relative flex max-h-[min(32rem,calc(100vh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] shadow-[var(--lare-shadow-2)] outline-none",
              className,
            )}
          >
            <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
              <h2
                id={titleId}
                className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]"
              >
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="lare-press -mr-1 rounded-[var(--lare-r-2)] p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              >
                <X className="size-4" aria-hidden />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
