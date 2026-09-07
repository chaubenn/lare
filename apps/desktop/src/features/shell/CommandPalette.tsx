import { SPRING } from "@lare/ui";
import { CircleDot, RefreshCw, Settings, SquarePen } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { checkForUpdate } from "@/lib/updater";
import { NAV_ITEMS } from "./nav";

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const items = useMemo<PaletteAction[]>(() => {
    const go = (to: string) => {
      void navigate(to);
      onClose();
    };
    const actions: PaletteAction[] = [
      ...NAV_ITEMS.map((item) => ({
        id: `nav:${item.to}`,
        label: item.label,
        hint: item.shortcut,
        run: () => go(item.to),
      })),
      {
        id: "record",
        label: "Start recording",
        hint: "Recordings",
        run: () => go("/recordings"),
      },
      { id: "draft", label: "New draft", hint: "Drafts", run: () => go("/drafts") },
      {
        id: "update",
        label: "Check for updates",
        run: () => {
          void checkForUpdate();
          onClose();
        },
      },
      { id: "settings", label: "Open settings", hint: "⌘7", run: () => go("/settings") },
    ];
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || (a.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [navigate, onClose, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        items[active]?.run();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [active, items, onClose, open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[min(20vh,8rem)]">
          <motion.button
            type="button"
            aria-label="Close command palette"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING.ui}
            className="absolute inset-0 cursor-default bg-[color-mix(in_oklab,var(--surface)_70%,transparent)]"
            style={{ backdropFilter: "blur(var(--lare-blur-chrome))" }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.97, filter: "blur(6px)" }}
            transition={SPRING.ui}
            className="lare-material-regular relative flex w-full max-w-lg flex-col overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] shadow-[var(--lare-shadow-2)]"
          >
            <h2 id={titleId} className="sr-only">
              Command palette
            </h2>
            <div className="border-b border-[var(--border)] px-3 py-2">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Go to a page or run an action…"
                aria-label="Filter commands"
                autoComplete="off"
                className="h-9 w-full bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-tertiary)] focus-visible:outline-none"
              />
            </div>
            <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
                  No matching commands
                </p>
              ) : (
                items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    data-index={index}
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => item.run()}
                    className="lare-press flex w-full items-center gap-3 rounded-[var(--lare-r-2)] px-3 py-2 text-left text-sm text-[var(--text)] data-[selected=true]:bg-[var(--surface-raised)]"
                    data-selected={index === active}
                  >
                    <PaletteIcon id={item.id} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? (
                      <span className="lare-micro shrink-0 text-[var(--text-tertiary)]">
                        {item.hint}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function PaletteIcon({ id }: { id: string }) {
  const className = "size-4 shrink-0 text-[var(--text-tertiary)]";
  if (id === "record") return <CircleDot className={className} aria-hidden />;
  if (id === "draft") return <SquarePen className={className} aria-hidden />;
  if (id === "update") return <RefreshCw className={className} aria-hidden />;
  if (id === "settings") return <Settings className={className} aria-hidden />;
  const item = NAV_ITEMS.find((n) => `nav:${n.to}` === id);
  if (!item) return <span className="size-4" />;
  return <item.icon className={className} aria-hidden />;
}
