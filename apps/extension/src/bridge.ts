/**
 * window.postMessage bridge between the MAIN-world script (page JS access) and
 * the isolated content script (chrome.* access). Both run on leetcode.com.
 */
import type { EditEvent } from "@lare/shared";

export const BRIDGE_MARK = "__lare__" as const;

export type MainToIsolated =
  | { [BRIDGE_MARK]: 1; kind: "monaco-ready" }
  | {
      [BRIDGE_MARK]: 1;
      kind: "edits";
      modelId: string;
      language: string;
      focused: boolean;
      events: EditEvent[];
    }
  | { [BRIDGE_MARK]: 1; kind: "submit"; url: string; body: unknown }
  | { [BRIDGE_MARK]: 1; kind: "check"; url: string; body: unknown }
  | { [BRIDGE_MARK]: 1; kind: "route"; url: string };

/** Omit that distributes over union members (plain Omit collapses unions). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type IsolatedToMain =
  | { [BRIDGE_MARK]: 2; kind: "request-snapshot"; modelId: string }
  | { [BRIDGE_MARK]: 2; kind: "list-models" };

export function isMainToIsolated(data: unknown): data is MainToIsolated {
  return typeof data === "object" && data !== null && (data as Record<string, unknown>)[BRIDGE_MARK] === 1;
}

export function isIsolatedToMain(data: unknown): data is IsolatedToMain {
  return typeof data === "object" && data !== null && (data as Record<string, unknown>)[BRIDGE_MARK] === 2;
}
