/**
 * Thin wrappers around the Tauri commands/events exposed by src-tauri/src/lib.rs.
 * Everything degrades gracefully when the UI runs in a plain browser (`pnpm dev` without Tauri).
 */

import type { AppToExt } from "@lare/shared";
import { WS_PORT } from "@lare/shared";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { type EventCallback, listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

export const inTauri = isTauri();

export interface WsStatus {
  connected: boolean;
  port: number;
}

export async function setCurrentUser(userId: string | null): Promise<void> {
  if (!inTauri) return;
  await invoke("set_current_user", { userId });
}

export async function wsStatus(): Promise<WsStatus> {
  if (!inTauri) return { connected: false, port: WS_PORT };
  return invoke<WsStatus>("ws_status");
}

export async function wsSend(message: AppToExt): Promise<void> {
  if (!inTauri) return;
  await invoke("ws_send", { message });
}

export async function appVersion(): Promise<string> {
  if (!inTauri) return "dev (browser)";
  return invoke<string>("app_version");
}

export async function takeInitialDeeplink(): Promise<string | null> {
  if (!inTauri) return null;
  return invoke<string | null>("take_initial_deeplink");
}

/** Payloads of the events emitted by the Rust side. */
export interface TauriEvents {
  "auth:callback": { code: string; next: string | null };
  "auth:error": { error: string; description: string | null };
  "ext:message": unknown;
  "ext:connected": boolean;
  "deeplink:navigate": string;
}

/**
 * Subscribe to a Tauri event for the lifetime of the component. The handler is kept in a ref so
 * callers can pass inline closures without re-subscribing on every render.
 */
export function useTauriEvent<K extends keyof TauriEvents>(
  name: K,
  handler: (payload: TauriEvents[K]) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const callback: EventCallback<TauriEvents[K]> = (event) => {
      handlerRef.current(event.payload);
    };
    listen<TauriEvents[K]>(name, callback)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error(`failed to listen for ${name}`, err);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [name]);
}
