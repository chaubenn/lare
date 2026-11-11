/**
 * Internal runtime messages between the content script, the side panel and the service worker.
 * Distinct from the desktop bridge protocol in `@lare/shared`.
 *
 * Content scripts from the previous build stay alive in open tabs after an update and keep
 * talking to the new worker, so a shape that has shipped has to stay accepted (and sent).
 */
import {
  DistributionSchema,
  EditEventSchema,
  type ExtensionStateSchema,
  type ProblemInfo,
  ProblemInfoSchema,
  type RecordingState,
  SubmissionInfoSchema,
  TopicTagSchema,
} from "@lare/shared";
import { z } from "zod";
import { errorText } from "./util";

export const QuestionDetailsSchema = z.object({
  descriptionHtml: z.string().nullable(),
  topicTags: z.array(TopicTagSchema),
});
export type QuestionDetails = z.infer<typeof QuestionDetailsSchema>;

export const CapturedSubmissionSchema = SubmissionInfoSchema.extend({
  langVerbose: z.string().nullable(),
  runtimeDisplay: z.string().nullable(),
  memoryDisplay: z.string().nullable(),
  runtimeDistribution: DistributionSchema.nullable(),
  memoryDistribution: DistributionSchema.nullable(),
});
export type CapturedSubmission = z.infer<typeof CapturedSubmissionSchema>;

export type AuthInfo = {
  userId: string;
  email: string | null;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
} | null;

/**
 * Requests a LeetCode tab's content script may send. A page is untrusted, so this list is the
 * security boundary: the worker refuses every other request unless it comes from one of the
 * extension's own pages.
 */
const PAGE_REQUESTS = [
  z.object({ type: z.literal("GET_STATE") }),
  z.object({ type: z.literal("PROBE_APP") }),
  z.object({
    type: z.literal("PROBLEM_OPENED"),
    problem: ProblemInfoSchema,
    question: QuestionDetailsSchema.nullable(),
  }),
  z.object({
    type: z.literal("EDITS"),
    slug: z.string(),
    language: z.string().nullable(),
    events: z.array(EditEventSchema),
  }),
  z.object({
    type: z.literal("SUBMISSION"),
    slug: z.string(),
    submission: CapturedSubmissionSchema,
    /**
     * The page's problem, so a submission on a problem that was never tracked (opened offline or
     * signed out, or already posted) can create its inbox row. Absent from older content scripts.
     */
    problem: ProblemInfoSchema.nullable().optional(),
    question: QuestionDetailsSchema.nullable().optional(),
  }),
] as const;

/** Requests only the extension's own pages (the side panel) may send. */
const PANEL_REQUESTS = [
  // Only interviews are started explicitly; practice is tracked passively.
  z.object({
    type: z.literal("START_INTERVIEW"),
    problem: ProblemInfoSchema.nullable(),
    question: QuestionDetailsSchema.nullable(),
    facecam: z.boolean().default(false),
    /** Transcribe the recording and allow an AI review. Off: video only. */
    graded: z.boolean().default(true),
    tabId: z.number().nullable().default(null),
  }),
  /** Load the content scripts into a LeetCode tab that has none (opened before an update). */
  z.object({ type: z.literal("INJECT_PAGE"), tabId: z.number() }),
  z.object({ type: z.literal("PAUSE_SESSION") }),
  z.object({ type: z.literal("RESUME_SESSION") }),
  z.object({ type: z.literal("END_SESSION") }),
  /** Close the interview and throw its recording away, without saving anything. */
  z.object({ type: z.literal("DISCARD_SESSION") }),
  z.object({ type: z.literal("SIGN_IN"), provider: z.enum(["github", "google"]) }),
  z.object({ type: z.literal("SIGN_IN_OTP"), email: z.string().email() }),
  z.object({ type: z.literal("VERIFY_OTP"), email: z.string().email(), token: z.string() }),
  z.object({ type: z.literal("SIGN_OUT") }),
  z.object({ type: z.literal("OPEN_APP"), path: z.string().optional() }),
  z.object({ type: z.literal("CANCEL_START") }),
  /** Retry saving every mock interview that ended but could not be saved. */
  z.object({ type: z.literal("RETRY_SYNC") }),
  /** Stop retrying unsaved mock interviews and forget them here (all of them when omitted). */
  z.object({ type: z.literal("DISCARD_UNSAVED"), sessionIds: z.array(z.string()).optional() }),
  z.object({ type: z.literal("PUBLISH_PROBLEMS"), ids: z.array(z.string().uuid()).min(1) }),
  /** Remove tracked problems from the inbox without posting them (all of them when omitted). */
  z.object({ type: z.literal("CLEAR_TRACKED"), ids: z.array(z.string().uuid()).optional() }),
] as const;

export const RuntimeRequestSchema = z.discriminatedUnion("type", [
  ...PAGE_REQUESTS,
  ...PANEL_REQUESTS,
]);
export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

const PAGE_REQUEST_TYPES: ReadonlySet<RuntimeRequest["type"]> = new Set(
  PAGE_REQUESTS.map((schema) => schema.shape.type.value),
);

/** Whether a content script in a LeetCode tab is allowed to send this request. */
export function isPageRequest(req: RuntimeRequest): boolean {
  return PAGE_REQUEST_TYPES.has(req.type);
}

export interface RecordingInfo {
  state: RecordingState;
  message?: string | null;
}

export interface RuntimeSnapshot {
  state: z.infer<typeof ExtensionStateSchema>;
  auth: AuthInfo;
  /** The desktop app is running, signed in as this user, and able to record. */
  appConnected: boolean;
  /** Why a mock interview cannot start right now; null when it can. */
  desktopBlocker: string | null;
  /** The service worker's build; null from a worker older than this field. */
  buildId: string | null;
  recording: RecordingInfo | null;
}

function toSnapshot(res: Partial<RuntimeSnapshot>): RuntimeSnapshot | null {
  if (!res.state) return null;
  return {
    state: res.state,
    auth: res.auth ?? null,
    appConnected: res.appConnected ?? false,
    desktopBlocker: res.desktopBlocker ?? null,
    buildId: res.buildId ?? null,
    recording: res.recording ?? null,
  };
}

export type RuntimeResponse =
  | ({ ok: true; postId?: string } & Partial<RuntimeSnapshot>)
  | { ok: false; error: string };

export interface StateBroadcast extends RuntimeSnapshot {
  type: "STATE_CHANGED";
  toast?: { kind: "info" | "success" | "error"; text: string } | undefined;
}

/**
 * Hand `set` the snapshot carried by a successful response or a `STATE_CHANGED` broadcast.
 * Anything else (a failed response, some other runtime message, a reply without state) is skipped.
 */
export function applySnapshot(msg: unknown, set: (snapshot: RuntimeSnapshot) => void): void {
  if (typeof msg !== "object" || msg === null) return;
  const carrier = msg as RuntimeResponse | Partial<StateBroadcast>;
  if ("ok" in carrier ? !carrier.ok : carrier.type !== "STATE_CHANGED") return;
  const snapshot = toSnapshot(carrier as Partial<RuntimeSnapshot>);
  if (snapshot) set(snapshot);
}

/**
 * Only the tab being recorded is told the recording state; what goes to any other tab says
 * `recording: null`.
 */
export function forTab<T extends { state?: RuntimeSnapshot["state"] }>(
  payload: T,
  tabId: number,
): T | (T & { recording: null }) {
  return payload.state?.interview?.tabId === tabId ? payload : { ...payload, recording: null };
}

/** Side panel -> content script: "what problem is this tab on?". */
export interface PageProblemReply {
  problem: ProblemInfo | null;
  question: QuestionDetails | null;
}

/** Everything a content script is sent with `chrome.tabs.sendMessage`. */
export type TabMessage =
  /** Show or hide the consent dot; answered `{ ok: true }` once it has rendered. */
  | { type: "LARE_RECORDING_INDICATOR"; visible: boolean }
  /** Send any buffered edits to the worker now; answered `{ ok: true }` when they are in. */
  | { type: "LARE_FLUSH_EDITS" }
  | { type: "LARE_PAGE_PROBLEM" }
  | StateBroadcast;

type TabReply<M extends TabMessage> = M extends { type: "LARE_PAGE_PROBLEM" }
  ? PageProblemReply
  : M extends StateBroadcast
    ? undefined
    : { ok?: boolean };

/** Send to a tab's content script and reject when nothing there is listening. */
export function requestFromTab<M extends TabMessage>(
  tabId: number,
  msg: M,
): Promise<TabReply<M> | undefined> {
  return chrome.tabs.sendMessage(tabId, msg);
}

/**
 * Send to a tab's content script, best effort. A tab with no receiver (closed, navigated away,
 * opened before the extension loaded) is normal, so that resolves undefined instead of rejecting.
 */
export function sendToTab<M extends TabMessage>(
  tabId: number,
  msg: M,
): Promise<TabReply<M> | undefined> {
  return requestFromTab(tabId, msg).catch(() => undefined);
}

/** Send a broadcast to the extension's own pages; no side panel open is normal. */
export function sendToExtensionPages(msg: StateBroadcast): void {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

export async function sendRuntime(req: RuntimeRequest): Promise<RuntimeResponse> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await new Promise<RuntimeResponse>((resolve) => {
      try {
        chrome.runtime.sendMessage(req, (raw: RuntimeResponse | undefined) => {
          if (chrome.runtime.lastError || !raw) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError?.message ?? "No response",
            });
          } else {
            resolve(raw);
          }
        });
      } catch (e) {
        resolve({ ok: false, error: errorText(e) });
      }
    });
    if (res.ok) return res;
    const transient = /Receiving end does not exist|Extension context invalidated/i.test(res.error);
    if (!transient || attempt === 3) return res;
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  return { ok: false, error: "No response" };
}
