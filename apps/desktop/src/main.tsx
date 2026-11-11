import "@fontsource-variable/outfit";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { allowAvatarOrigin } from "@lare/ui/primitives";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CameraWindow } from "./features/media/CameraWindow";
import { RecorderPillWindow } from "./features/media/RecorderPillWindow";
import { env } from "./lib/env";
import { windowKind } from "./lib/tauri";
import { initTheme } from "./lib/theme";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// Profile pictures uploaded in the app are public objects in this project's storage. Registered
// here, ahead of the first render, because every window that shows an avatar starts from this file.
allowAvatarOrigin(env.VITE_SUPABASE_URL);

const kind = windowKind();
if (kind !== "main") {
  document.documentElement.classList.add("overlay-window");
}
// The recorder pill and camera preview float over whatever is on screen, so they stay dark.
initTheme(kind === "main" ? undefined : "dark");

createRoot(container).render(
  <StrictMode>
    {kind === "recorder" ? <RecorderPillWindow /> : kind === "camera" ? <CameraWindow /> : <App />}
  </StrictMode>,
);
