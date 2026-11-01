import { formatRelativeTime, type SearchKind } from "@lare/shared";
import { SPRING } from "@lare/ui";
import { Inbox, Mic, Rss, SquarePen, User } from "@lare/ui/icons";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { requestSearchSync } from "@/features/search/sync";
import { usePaletteSearch } from "@/features/search/usePaletteSearch";
import { describeAccelerator } from "@/lib/shortcuts";
import { NAV_ITEMS } from "./nav";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/** `CmdOrCtrl+1` as this platform writes it: ⌘1 on macOS, Ctrl+1 elsewhere. */
function keyHint(accelerator: string): string {
  return describeAccelerator(accelerator, isMac).join(isMac ? "" : "+");
}

interface PaletteAction {
  id: string;
  label: string;
  /** Second line, e.g. a session's difficulty and outcome. */
  detail?: string;
  hint?: string;
  /** Heading drawn above the first item of each group while searching. */
  group?: string;
  kind?: SearchKind;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const groups = usePaletteSearch(query);

  const items = useMemo<PaletteAction[]>(() => {
    const go = (to: string) => {
      void navigate(to);
      onClose();
    };
    const actions: PaletteAction[] = [
      ...NAV_ITEMS.map((item) => ({
        id: `nav:${item.to}`,
        label: item.label,
        hint: keyHint(item.shortcut),
        run: () => go(item.to),
      })),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    const pages = actions
      .filter((a) => a.label.toLowerCase().includes(q))
      .map((a) => ({ ...a, group: "Pages" }));
    const hits = groups.flatMap(({ label, hits }) =>
      hits.map((hit) => ({
        id: hit.id,
        label: hit.title,
        detail: hit.subtitle,
        hint: hit.at > 0 ? formatRelativeTime(new Date(hit.at).toISOString()) : undefined,
        group: label,
        kind: hit.kind,
        run: () => go(hit.route),
      })),
    );
    return [...pages, ...hits];
  }, [groups, navigate, onClose, query]);

  // Results arrive after the keystroke; keep the highlight on a row that still exists.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    requestSearchSync();
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
            className="absolute inset-0 cursor-default bg-[color-mix(in_oklab,var(--surface)_40%,transparent)]"
            style={{ backdropFilter: "blur(var(--lare-blur-scrim))" }}
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
                placeholder="Search sessions, posts and people, or go to a page…"
                aria-label="Search or go to a page"
                autoComplete="off"
                className="h-9 w-full bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-tertiary)] focus-visible:outline-none"
              />
            </div>
            <div ref={listRef} role="listbox" className="max-h-96 overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
                  Nothing matches
                </p>
              ) : (
                items.map((item, index) => (
                  <Fragment key={item.id}>
                    {item.group && item.group !== items[index - 1]?.group ? (
                      <p
                        role="presentation"
                        className="lare-micro px-3 pt-3 pb-1 text-[var(--text-tertiary)] first:pt-1"
                      >
                        {item.group}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      data-index={index}
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => item.run()}
                      className="lare-press flex w-full items-center gap-3 rounded-[var(--lare-r-2)] px-3 py-2 text-left text-sm text-[var(--text)] data-[selected=true]:bg-[var(--surface-raised)]"
                      data-selected={index === active}
                    >
                      <PaletteIcon item={item} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{item.label}</span>
                        {item.detail ? (
                          <span className="lare-micro truncate text-[var(--text-tertiary)]">
                            {item.detail}
                          </span>
                        ) : null}
                      </span>
                      {item.hint ? (
                        <span className="lare-micro shrink-0 text-[var(--text-tertiary)]">
                          {item.hint}
                        </span>
                      ) : null}
                    </button>
                  </Fragment>
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

const KIND_ICONS = { session: Inbox, said: Mic, post: Rss, draft: SquarePen, person: User };

function PaletteIcon({ item }: { item: PaletteAction }) {
  const className = "size-4 shrink-0 text-[var(--text-tertiary)]";
  if (item.kind) {
    const Icon = KIND_ICONS[item.kind];
    return <Icon className={className} aria-hidden />;
  }
  const nav = NAV_ITEMS.find((n) => `nav:${n.to}` === item.id);
  if (!nav) return <span className="size-4" />;
  return <nav.icon className={className} aria-hidden />;
}
