import "@fontsource-variable/outfit";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { domAnimation, LazyMotion } from "motion/react";
import { createRoot, type Root } from "react-dom/client";
import { PageController } from "@/src/pageController";
import { Overlay } from "./Overlay";
import "./overlay.css";

const MATCHES = ["https://leetcode.com/problems/*", "https://leetcode.com/contest/*/problems/*"];
const fixtureOrigin = import.meta.env.WXT_DEV_FIXTURE_ORIGIN;
if (import.meta.env.MODE !== "production" && fixtureOrigin) MATCHES.push(`${fixtureOrigin}/*`);

function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

function installOverlayFonts(): void {
  const id = "lare-overlay-fonts";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  const outfit = chrome.runtime.getURL("/fonts/outfit-latin-wght-normal.woff2");
  const mono400 = chrome.runtime.getURL("/fonts/ibm-plex-mono-latin-400-normal.woff2");
  const mono500 = chrome.runtime.getURL("/fonts/ibm-plex-mono-latin-500-normal.woff2");
  style.textContent = `
@font-face {
  font-family: Outfit;
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url("${outfit}") format("woff2-variations");
}
@font-face {
  font-family: "IBM Plex Mono";
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url("${mono400}") format("woff2");
}
@font-face {
  font-family: "IBM Plex Mono";
  font-style: normal;
  font-display: swap;
  font-weight: 500;
  src: url("${mono500}") format("woff2");
}
`;
  document.documentElement.appendChild(style);
}

export default defineContentScript({
  matches: MATCHES,
  allFrames: true,
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    if (!isTopFrame()) return;
    installOverlayFonts();
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
        root.render(
          <LazyMotion features={domAnimation} strict>
            <Overlay controller={controller} />
          </LazyMotion>,
        );
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
