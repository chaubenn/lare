/**
 * Everything the app has to tell you that did not come from another person: a permission macOS is
 * withholding, a video that finished processing, a save that failed, an update waiting to install.
 *
 * Each one shows as a toast in the top-right corner (`Toaster`) and leaves on its own, so the
 * Notifications page stays about people. Anything that must outlive the toast (a failed upload,
 * an update) points somewhere with `href`, where the lasting state lives.
 *
 * In memory only: a notice describes what is true on this machine right now.
 */

import { useSyncExternalStore } from "react";
import { errorMessage } from "./errors";
import { createNoticeStore, type Notice } from "./noticeStore";

export type { Notice } from "./noticeStore";

const store = createNoticeStore();

/**
 * Show a notice. Module state rather than a provider, so it works outside React too: the pipeline
 * and the updater both report from plain functions.
 */
export const notify = store.notify;

/** The toast for something that failed: `title` says what, the error says why. */
export function notifyError(title: string, error: unknown): string {
  return notify({ title, description: errorMessage(error), variant: "error" });
}

export const dismissNotice = store.dismiss;

export function useNotices(): readonly Notice[] {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
