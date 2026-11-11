/**
 * window.postMessage bridge between the MAIN-world script (page JS access) and
 * the isolated content script (chrome.* access). Both run on leetcode.com.
 *
 * Any script on the page can post to the same window, so what arrives is untrusted page input:
 * the isolated side only acts on messages that match `MainToIsolatedSchema` exactly as the MAIN
 * script sends them, and ignores everything else.
 */
import { type EditEvent, EditEventSchema } from "@lare/shared";
import { z } from "zod";

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

const mark = z.literal(1);
const pageUrl = z.url({ protocol: /^https?$/ }).max(4096);
/** A parsed JSON body from the judge; its own schema is applied where it is read. */
const judgeBody = z.custom<object>((v) => typeof v === "object" && v !== null);

const MainToIsolatedSchema: z.ZodType<MainToIsolated> = z.discriminatedUnion("kind", [
  z.object({ [BRIDGE_MARK]: mark, kind: z.literal("monaco-ready") }),
  z.object({
    [BRIDGE_MARK]: mark,
    kind: z.literal("edits"),
    modelId: z.string().max(2048),
    language: z.string().max(100),
    focused: z.boolean(),
    events: z.array(EditEventSchema).max(1000),
  }),
  z.object({ [BRIDGE_MARK]: mark, kind: z.literal("submit"), url: pageUrl, body: judgeBody }),
  z.object({ [BRIDGE_MARK]: mark, kind: z.literal("check"), url: pageUrl, body: judgeBody }),
  z.object({ [BRIDGE_MARK]: mark, kind: z.literal("route"), url: pageUrl }),
]);

/** The message if it is one the MAIN script sends, else null (to be ignored). */
export function parseMainToIsolated(data: unknown): MainToIsolated | null {
  if (
    typeof data !== "object" ||
    data === null ||
    (data as Record<string, unknown>)[BRIDGE_MARK] !== 1
  )
    return null;
  const parsed = MainToIsolatedSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function isIsolatedToMain(data: unknown): data is IsolatedToMain {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)[BRIDGE_MARK] === 2
  );
}
