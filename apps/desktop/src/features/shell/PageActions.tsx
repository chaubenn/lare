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

/**
 * A page's action bar, pinned to the bottom of the content pane at its full width. Its buttons
 * follow the page's own width: the centred 1360px column, or the whole pane for `fullWidth` pages.
 */
export function PageActions({
  children,
  fullWidth = false,
}: {
  children: ReactNode;
  fullWidth?: boolean;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(SLOT_ID)), []);
  if (!slot) return null;
  return createPortal(
    <div className="lare-material-thin border-t border-[var(--border)]">
      {/* Same gutters as the page above, so the buttons line up with its content. */}
      <div
        className={`flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 ${fullWidth ? "" : "mx-auto max-w-[1360px]"}`}
      >
        {children}
      </div>
    </div>,
    slot,
  );
}
