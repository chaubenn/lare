import { WS_PORT } from "@lare/shared";
import { useEffect, useState } from "react";
import { useTauriEvent, type WsStatus, wsStatus } from "./tauri";

/**
 * Whether the extension is connected. Polled as well as pushed (`ext:connected`), so a missed
 * event corrects itself.
 */
export function useExtensionStatus(): WsStatus {
  const [status, setStatus] = useState<WsStatus>({ connected: false, port: WS_PORT });

  useEffect(() => {
    let active = true;
    const pull = () => {
      wsStatus()
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch((err: unknown) => console.error("ws_status failed", err));
    };
    pull();
    const id = window.setInterval(pull, 2000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  useTauriEvent("ext:connected", (connected) => {
    setStatus((s) => ({ ...s, connected }));
  });

  return status;
}
