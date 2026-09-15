import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SLOT_ID = "lare-page-actions";

/**
 * Where `PageActions` render: under the scrolling page, above the jobs tray and footer, across the
 * whole content pane. A sticky bar inside the page can only be as wide as the column it sits in.
 */
export function PageActionsSlot() {
  return <div id={SLOT_ID} className="shrink-0 empty:hidden" />;
}

/** A page's action bar, pinned to the bottom of the content pane at its full width. */
export function PageActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(SLOT_ID)), []);
  if (!slot) return null;
  return createPortal(
    <div className="lare-material-thin border-t border-[var(--border)]">
      {/* Same width and gutters as the page above, so the buttons line up with its content. */}
      <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-center justify-between gap-3 px-5 py-3">
        {children}
      </div>
    </div>,
    slot,
  );
}
