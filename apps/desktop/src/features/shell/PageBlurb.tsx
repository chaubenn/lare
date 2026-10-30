import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SLOT_ID = "lare-topbar-blurb";

/** Where a page's one-line description renders: in the topbar, to the right of the page's name. */
export function TopbarBlurbSlot() {
  return <span id={SLOT_ID} className="contents" />;
}

/**
 * A page's one-line description, shown in the topbar beside the page's name, as small grey text. Pages
 * render this where they used to render a subtitle; it unmounts with the page, so nothing lingers.
 */
export function PageBlurb({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(SLOT_ID)), []);
  if (!slot) return null;
  return createPortal(
    <span className="min-w-0 truncate text-sm text-[var(--text-tertiary)]">{children}</span>,
    slot,
  );
}
