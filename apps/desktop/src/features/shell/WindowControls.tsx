import { cn } from "@lare/ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { inTauri } from "@/lib/tauri";

/**
 * Windows has no overlay title bar, so the main window drops its frame there
 * (tauri.windows.conf.json) and the top bar draws minimise, maximise and close itself. macOS
 * keeps its traffic lights; a plain browser has no window to control.
 */
export const drawsWindowControls =
  inTauri && typeof navigator !== "undefined" && /Win/i.test(navigator.platform);

const BUTTON =
  "inline-flex h-9 w-11 items-center justify-center rounded-[var(--lare-r-2)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let active = true;
    const sync = () => {
      void win.isMaximized().then((m) => {
        if (active) setMaximized(m);
      });
    };
    sync();
    void win.onResized(sync).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const win = getCurrentWindow();
  return (
    <div className="-mr-2 flex shrink-0 items-center">
      <button
        type="button"
        aria-label="Minimise"
        title="Minimise"
        className={BUTTON}
        onClick={() => void win.minimize()}
      >
        <Glyph d="M0 5h10" />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximise"}
        title={maximized ? "Restore" : "Maximise"}
        className={BUTTON}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <Glyph d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /> : <Glyph d="M.5.5h9v9h-9z" />}
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        className={cn(BUTTON, "hover:bg-[#c42b1c] hover:text-white")}
        onClick={() => void win.close()}
      >
        <Glyph d="M.5.5l9 9M9.5.5l-9 9" />
      </button>
    </div>
  );
}

/** Thin 10px strokes, the same weight as the system caption buttons. */
function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
