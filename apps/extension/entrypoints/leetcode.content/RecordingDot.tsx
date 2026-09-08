import { useEffect, useState } from "react";
import type { PageController } from "@/src/pageController";

/**
 * The extension's entire on-page presence: a red dot, shown only while a mock
 * interview is actually recording.
 *
 * There is deliberately nothing else here. Practice is tracked silently, and an
 * interview should not put a timer or a control panel in front of someone who is
 * trying to think — but recording without any visible sign of it would be worse,
 * so the dot stays. Controls live in the extension popup.
 */
export function RecordingDot({ controller }: { controller: PageController }) {
  const [state, setState] = useState(() => controller.getState());

  useEffect(() => controller.subscribe(() => setState(controller.getState())), [controller]);

  const recording = state.snapshot?.recording ?? null;
  const live = recording?.state === "recording";
  if (!live) return null;

  return (
    <div className="lare-rec" role="status" aria-label="Mock interview recording">
      <span className="lare-rec-dot" aria-hidden />
    </div>
  );
}
