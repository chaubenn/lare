import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { takeInitialDeeplink, useTauriEvent } from "@/lib/tauri";

/** Route-level listeners that need the router: deep links (`lare://...`). */
export function RootLayout() {
  const navigate = useNavigate();

  useTauriEvent("deeplink:navigate", (path) => {
    if (typeof path === "string" && path.startsWith("/")) void navigate(path);
  });

  // The app may have been launched *by* a deep link, before this listener existed.
  useEffect(() => {
    let active = true;
    takeInitialDeeplink()
      .then((path) => {
        if (active && path) void navigate(path);
      })
      .catch((err: unknown) => console.error("take_initial_deeplink failed", err));
    return () => {
      active = false;
    };
  }, [navigate]);

  return <Outlet />;
}
