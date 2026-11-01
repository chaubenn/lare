/**
 * Auto-update via tauri-plugin-updater. The app fetches `latest.json` from the newest GitHub
 * release (see `plugins.updater.endpoints` in tauri.conf.json), compares it with its own version
 * and, when newer, downloads + installs the signed bundle and relaunches.
 *
 * Updates are not optional: the splash checks on every launch and, when a newer release exists,
 * installs it before the app opens (see {@link checkOnLaunch}). The hourly background check and
 * the manual one in Settings cover a release published while Lare is open.
 *
 * State lives in a tiny module-level store so the splash, the background check and Settings share
 * one source of truth and never run two downloads at once.
 */

import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";
import { inTauri } from "./tauri";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; checkedAt: number }
  | { status: "available"; version: string; notes: string | null }
  | { status: "downloading"; version: string; progress: number | null }
  | { status: "installing"; version: string }
  | { status: "error"; message: string };

let state: UpdateState = { status: "idle" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  for (const l of listeners) l();
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

/** Ask GitHub whether a newer release exists. Safe to call repeatedly; no-op in a browser. */
export async function checkForUpdate(timeoutMs = 15_000): Promise<UpdateState> {
  if (!inTauri) return state;
  if (
    state.status === "checking" ||
    state.status === "downloading" ||
    state.status === "installing"
  ) {
    return state;
  }
  set({ status: "checking" });
  try {
    const update = await check({ timeout: timeoutMs });
    if (update) {
      pending = update;
      set({ status: "available", version: update.version, notes: update.body ?? null });
    } else {
      pending = null;
      set({ status: "up-to-date", checkedAt: Date.now() });
    }
  } catch (err) {
    pending = null;
    set({ status: "error", message: describe(err) });
  }
  return state;
}

/** Download, install and relaunch into the update found by {@link checkForUpdate}. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  if (!update) return;
  let total: number | null = null;
  let received = 0;
  set({ status: "downloading", version: update.version, progress: null });
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? null;
          break;
        case "Progress":
          received += event.data.chunkLength;
          set({
            status: "downloading",
            version: update.version,
            progress: total ? Math.min(1, received / total) : null,
          });
          break;
        case "Finished":
          set({ status: "installing", version: update.version });
          break;
      }
    });
    pending = null;
    // On Windows the NSIS installer exits the app itself; elsewhere we relaunch.
    await relaunch();
  } catch (err) {
    set({ status: "error", message: describe(err) });
  }
}

/**
 * The launch check is held to a shorter timeout than a manual one: the splash waits on it, and a
 * slow or absent network should cost a few seconds, not keep Lare from opening.
 */
const LAUNCH_CHECK_TIMEOUT_MS = 8_000;
let launchCheck: Promise<UpdateState> | null = null;

/**
 * The check the splash waits on, run once per launch (memoised, so React's double-mounted effects
 * in development do not race two of them). An update it finds is installed straight away and the
 * app relaunches into it; the result is "available" while that runs. A failed check lets the app
 * open, since being offline should not lock anyone out.
 */
export function checkOnLaunch(): Promise<UpdateState> {
  launchCheck ??= checkForUpdate(LAUNCH_CHECK_TIMEOUT_MS).then((result) => {
    if (result.status === "available") void installUpdate();
    return result;
  });
  return launchCheck;
}

export function dismissUpdate(): void {
  if (state.status === "available" || state.status === "error") {
    set({ status: "idle" });
  }
}
