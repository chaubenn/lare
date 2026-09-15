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
 * A page's action bar, pinned to the bottom of the content pane at its full width. `className`
 * sizes the row of buttons inside it, so they can line up with the page's own columns.
 */
export function PageActions({
  children,
  className = "mx-auto max-w-[1360px]",
}: {
  children: ReactNode;
  className?: string;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(SLOT_ID)), []);
  if (!slot) return null;
  return createPortal(
    <div className="lare-material-thin border-t border-[var(--border)]">
      {/* Same gutters as the page above, so the buttons line up with its content. */}
      <div
        className={`flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 ${className}`}
      >
        {children}
      </div>
    </div>,
    slot,
  );
}
