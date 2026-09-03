import { WS_PORT } from "@lare/shared";
import { useEffect, useState } from "react";
import { useTauriEvent, type WsStatus, wsStatus } from "@/lib/tauri";

/** Extension connection state: polled once on mount, then driven by `ext:connected` events. */
export function useExtensionStatus(): WsStatus {
  const [status, setStatus] = useState<WsStatus>({ connected: false, port: WS_PORT });

  useEffect(() => {
    let active = true;
    wsStatus()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch((err: unknown) => console.error("ws_status failed", err));
    return () => {
      active = false;
    };
  }, []);

  useTauriEvent("ext:connected", (connected) => {
    setStatus((s) => ({ ...s, connected }));
  });

  return status;
}
