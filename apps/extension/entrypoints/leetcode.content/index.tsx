import { createRoot, type Root } from "react-dom/client";
import { PageController } from "@/src/pageController";
import { Overlay } from "./Overlay";
import "./overlay.css";

const MATCHES = ["https://leetcode.com/problems/*", "https://leetcode.com/contest/*/problems/*"];
const fixtureOrigin = import.meta.env.WXT_DEV_FIXTURE_ORIGIN;
if (import.meta.env.MODE !== "production" && fixtureOrigin) MATCHES.push(`${fixtureOrigin}/*`);

export default defineContentScript({
  matches: MATCHES,
  allFrames: true,
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
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
    const controller = new PageController();
    let root: Root | null = null;
    const ui = await createShadowRootUi(ctx, {
      name: "lare-overlay",
      position: "overlay",
      anchor: "body",
      zIndex: 2147483000,
      onMount(container) {
        root = createRoot(container);
        root.render(<Overlay controller={controller} />);
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
