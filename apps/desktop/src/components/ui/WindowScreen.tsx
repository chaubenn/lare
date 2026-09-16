import { cn } from "@lare/ui";
import type { ReactNode } from "react";

/**
 * Full-window layout for the screens that render before the app shell — sign-in, onboarding,
 * recording setup.
 *
 * Two things they need and the shell would otherwise have given them. The window is configured with
 * `titleBarStyle: "Overlay"`, so there is no native title bar to grab and the only drag handles are
 * the ones the page draws: without the strip here the window cannot be moved at all. The strip also
 * keeps content clear of the traffic lights floating over the top-left corner.
 *
 * The box is centred with `my-auto` rather than `items-center` so that a card taller than the window
 * scrolls from its top edge instead of having it clipped.
 */
export function WindowScreen({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div data-tauri-drag-region className="h-8 shrink-0" />
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-8 pb-8">
        <div className={cn("my-auto w-full", className)}>{children}</div>
      </div>
    </div>
  );
}
