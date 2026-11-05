import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSyncExternalStore } from "react";
import { isNetworkError } from "./supabase";
import { inTauri } from "./tauri";

// TanStack assumes it is online until the first `offline` event, so a launch with no network
// would never see an `online` event flip the state and refetch. Start from what the OS reports.
if (typeof navigator !== "undefined") onlineManager.setOnline(navigator.onLine);

// TanStack only listens for `visibilitychange`, which never fires when you switch to Lare from
// Chrome: the window was visible the whole time. Treat the Tauri window gaining focus as a focus
// event too, so stale lists (tracked problems, drafts, the feed) refresh the moment you come back.
// Blur is left to `visibilitychange`, so polling keeps going while Lare sits visible beside Chrome.
focusManager.setEventListener((handleFocus) => {
  const onVisibility = () => handleFocus();
  window.addEventListener("visibilitychange", onVisibility, false);
  let unlisten: (() => void) | undefined;
  let disposed = false;
  if (inTauri) {
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) handleFocus();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
  }
  return () => {
    disposed = true;
    window.removeEventListener("visibilitychange", onVisibility);
    unlisten?.();
  };
});

/**
 * With `networkMode: "always"` an offline refetch fails, and most pages show their error state
 * over data that was perfectly good a moment ago. So background refreshes wait for the network;
 * only a query with nothing to show yet goes ahead, and fails into its retry state.
 */
const unlessOfflineWithData = (query: { state: { data: unknown } }) =>
  onlineManager.isOnline() || query.state.data === undefined;

/** A polling interval that stops while offline (the reconnect refetch picks things up again). */
export function whileOnline(ms: number): () => number | false {
  return () => (onlineManager.isOnline() ? ms : false);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // The default "online" mode pauses a query while offline, which leaves a spinner up forever
      // ("Loading your profile…"). Always run it, so being offline shows up as an error with a
      // retry; queries still refetch by themselves when the connection comes back.
      networkMode: "always",
      // Retrying a request the OS already knows cannot leave the machine only delays the error.
      retry: (failureCount, error) =>
        failureCount < 1 && !(isNetworkError(error) && !onlineManager.isOnline()),
      refetchOnWindowFocus: unlessOfflineWithData,
      refetchOnMount: unlessOfflineWithData,
    },
    mutations: {
      // Same reason: a paused mutation is a "Saving…" that never finishes. Fail it and say why.
      networkMode: "always",
    },
  },
});

/** Whether the OS reports a network connection, for the offline banner. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}
