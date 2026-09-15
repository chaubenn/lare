import { createRoot, type Root } from "react-dom/client";
import { PageController } from "@/src/pageController";
import { RecordingDot } from "./RecordingDot";
import "./recording.css";

// All of leetcode.com, not just problem URLs: LeetCode navigates in-page, so a script that only
// loads on /problems/* never arrives when a problem is opened from the list or the home page.
const MATCHES = ["https://leetcode.com/*"];
const fixtureOrigin = import.meta.env.WXT_DEV_FIXTURE_ORIGIN;
if (import.meta.env.MODE !== "production" && fixtureOrigin) MATCHES.push(`${fixtureOrigin}/*`);

function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

export default defineContentScript({
  matches: MATCHES,
  allFrames: true,
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    if (!isTopFrame()) return;
    let dead = false;
    const keepAlive = () => {
      if (dead) return;
      try {
        const port = chrome.runtime.connect({ name: "lare-keepalive" });
        port.onDisconnect.addListener(() => {
          if (!dead) window.setTimeout(keepAlive, 1000);
        });
      } catch {
        if (!dead) window.setTimeout(keepAlive, 1500);
      }
    };
    keepAlive();

    // The controller is the real work: it watches the page and reports problems
    // and submissions to the service worker. The UI it drives is one dot.
    const controller = new PageController();
    let root: Root | null = null;
    const ui = await createShadowRootUi(ctx, {
      name: "lare-overlay",
      position: "overlay",
      anchor: "body",
      zIndex: 2147483000,
      onMount(container) {
        root = createRoot(container);
        root.render(<RecordingDot controller={controller} />);
        return root;
      },
      onRemove() {
        root?.unmount();
        root = null;
      },
    });
    ui.mount();
    ctx.onInvalidated(() => {
      dead = true;
      controller.dispose();
    });
  },
});
