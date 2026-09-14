import { useEffect, useState } from "react";
import type { PageController } from "@/src/pageController";

/**
 * The extension's entire on-page presence: a red dot, shown only while a mock
 * interview is actually recording.
 *
 * There is deliberately nothing else here. Practice is tracked silently, and an
 * interview should not put a timer or a control panel in front of someone who is
 * trying to think — but recording without any visible sign of it would be worse,
 * so the dot stays. Controls live in the extension side panel.
 */
export function RecordingDot({ controller }: { controller: PageController }) {
  const [state, setState] = useState(() => controller.getState());
  const [forced, setForced] = useState(false);
  useEffect(() => {
    const listener = (
      msg: { type?: string; visible?: boolean },
      _sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void,
    ) => {
      if (msg.type !== "LARE_RECORDING_INDICATOR") return;
      setForced(msg.visible === true);
      requestAnimationFrame(() => respond({ ok: true }));
      return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => controller.subscribe(() => setState(controller.getState())), [controller]);

  const recording = state.snapshot?.recording ?? null;
  const capture = state.snapshot?.capture;
  const live =
    forced ||
    (!!capture && ["starting", "recording", "paused"].includes(capture.state)) ||
    recording?.state === "recording";
  if (!live) return null;

  return (
    <div className="lare-rec" role="status" aria-label="Mock interview recording">
      <span className="lare-rec-dot" aria-hidden />
    </div>
  );
}
