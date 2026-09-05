/**
 * Auto-update via tauri-plugin-updater. The app fetches `latest.json` from the newest GitHub
 * release (see `plugins.updater.endpoints` in tauri.conf.json), compares it with its own version
 * and, when newer, downloads + installs the signed bundle and relaunches.
 *
 * State lives in a tiny module-level store so the launch check (AppShell banner) and the manual
 * check (Settings) share one source of truth and never run two downloads at once.
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
export async function checkForUpdate(): Promise<UpdateState> {
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
    const update = await check({ timeout: 15_000 });
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

export function dismissUpdate(): void {
  if (state.status === "available" || state.status === "error") {
    set({ status: "idle" });
  }
}
