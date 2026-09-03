import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CameraWindow } from "./features/recording/CameraWindow";
import { RecorderPillWindow } from "./features/recording/RecorderPillWindow";
import { windowKind } from "./lib/tauri";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

const kind = windowKind();
if (kind !== "main") {
  document.documentElement.classList.add("overlay-window");
}

createRoot(container).render(
  <StrictMode>
    {kind === "recorder" ? <RecorderPillWindow /> : kind === "camera" ? <CameraWindow /> : <App />}
  </StrictMode>,
);
