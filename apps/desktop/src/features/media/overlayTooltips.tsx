/**
 * Tooltips for the always-on-top overlays (the recorder pill and the facecam bubble).
 *
 * On macOS both are non-activating panels, never the key window, and WebKit sends them no hover
 * at all: no CSS `:hover`, no pointer events, no native `title` tooltips. Rust follows the
 * pointer instead and sends its position over the window (`recorder:pointer`, `camera:pointer`),
 * and these find the control under it. Elsewhere the webview's own pointer events agree.
 */

import { cn } from "@lare/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { describeAccelerator, isMac } from "@/lib/shortcuts";
import { useTauriEvent } from "@/lib/tauri";

/** How long the pointer rests on a control before its tooltip shows. */
const TOOLTIP_DELAY_MS = 350;

/**
 * Which control the pointer is on (`pointed`, for the hover highlight) and whose tooltip shows.
 * Once one tooltip has shown, sliding to the next control shows its tooltip straight away.
 */
export function useOverlayTooltips(pointerEvent: "recorder:pointer" | "camera:pointer") {
  const [pointed, setPointed] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const warm = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (pointed === null) {
      setShown(null);
      // A gap between two buttons should not start the delay over.
      timer.current = window.setTimeout(() => {
        warm.current = false;
      }, 250);
      return;
    }
    if (warm.current) {
      setShown(pointed);
      return;
    }
    setShown(null);
    timer.current = window.setTimeout(() => {
      warm.current = true;
      setShown(pointed);
    }, TOOLTIP_DELAY_MS);
  }, [pointed]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useTauriEvent(pointerEvent, (at) => {
    const el = at ? document.elementFromPoint(at[0], at[1]) : null;
    setPointed(el?.closest<HTMLElement>("[data-tip]")?.dataset.tip ?? null);
  });

  /** Props for the element wrapping a control and its tooltip. */
  const target = (id: string) => ({
    "data-tip": id,
    onPointerEnter: () => setPointed(id),
    onPointerLeave: () => setPointed((p) => (p === id ? null : p)),
    onFocus: () => setPointed(id),
    onBlur: () => setPointed((p) => (p === id ? null : p)),
  });

  return { pointed, shown, target };
}

/** A shortcut drawn as keycaps, for a tooltip ("Hide ⌃⌥⇧H"). */
export function ShortcutCaps({ accelerator }: { accelerator: string }) {
  return (
    <span className="ml-1.5 inline-flex gap-0.5">
      {describeAccelerator(accelerator, isMac).map((cap) => (
        <kbd
          key={cap}
          className="rounded-[4px] border border-white/[0.1] bg-white/[0.06] px-1 font-sans text-[10.5px] leading-4 text-[var(--lare-soft)]"
        >
          {cap}
        </kbd>
      ))}
    </span>
  );
}

/**
 * A control's tooltip, beside it on `side`. It is drawn by the control's wrapper rather than the
 * button, so a disabled button's fade does not reach it.
 */
export function OverlayTooltip({
  show,
  align = "center",
  side = "top",
  gap = 16,
  children,
}: {
  show: boolean;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  /** Points between the wrapper and the tooltip. */
  gap?: number;
  children: ReactNode;
}) {
  return (
    <span
      role="tooltip"
      aria-hidden={!show}
      style={{ [side === "top" ? "bottom" : "top"]: `calc(100% + ${gap}px)` }}
      className={cn(
        "pointer-events-none absolute z-10 flex items-center whitespace-nowrap rounded-lg border border-white/[0.08] px-2 py-1 text-[11.5px] font-medium leading-4 text-[var(--lare-bone)]",
        "bg-[color-mix(in_oklab,var(--lare-ink-2)_96%,transparent)] shadow-[0_4px_14px_rgb(0_0_0/0.45)]",
        "transition-opacity duration-100 motion-reduce:transition-none",
        align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
        show ? "opacity-100" : "opacity-0",
      )}
    >
      {children}
    </span>
  );
}
