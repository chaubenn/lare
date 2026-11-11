import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const ACTIONS_SLOT = "lare-page-actions";
const BLURB_SLOT = "lare-topbar-blurb";

/**
 * Renders `children` into a slot the shell owns. The slot element is looked up after mount, so a
 * page can fill it wherever the shell put it; the content unmounts with the page.
 */
function SlotPortal({ slotId, children }: { slotId: string; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(slotId)), [slotId]);
  return slot ? createPortal(children, slot) : null;
}

/**
 * Where `PageActions` render: under the scrolling page, across the whole content pane. A sticky
 * bar inside the page can only be as wide as the column it sits in.
 */
export function PageActionsSlot() {
  return <div id={ACTIONS_SLOT} className="shrink-0 empty:hidden" />;
}

/** A page's action bar, pinned to the bottom of the content pane at its full width. */
export function PageActions({ children }: { children: ReactNode }) {
  return (
    <SlotPortal slotId={ACTIONS_SLOT}>
      <div className="lare-material-thin border-t border-[var(--border)]">
        {/* Same gutters as the page above, so the buttons line up with its content. */}
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3">
          {children}
        </div>
      </div>
    </SlotPortal>
  );
}

/** Where a page's one-line description renders: in the topbar, to the right of the page's name. */
export function TopbarBlurbSlot() {
  return <span id={BLURB_SLOT} className="contents" />;
}

/** A page's one-line description, shown in the topbar beside the page's name as small grey text. */
export function PageBlurb({ children }: { children: ReactNode }) {
  return (
    <SlotPortal slotId={BLURB_SLOT}>
      <span className="min-w-0 truncate text-sm text-[var(--text-tertiary)]">{children}</span>
    </SlotPortal>
  );
}
