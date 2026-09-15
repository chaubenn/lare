/**
 * Internal runtime messages between the content script / popup and the service
 * worker. Distinct from the desktop protocol in @lare/shared/protocol.
 */
import {
  DistributionSchema,
  EditEventSchema,
  type ExtensionStateSchema,
  ProblemInfoSchema,
  type RecordingState,
  SubmissionInfoSchema,
} from "@lare/shared";
import { z } from "zod";

export const QuestionDetailsSchema = z.object({
  descriptionHtml: z.string().nullable(),
  topicTags: z.array(z.object({ name: z.string(), slug: z.string() })),
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

export const AuthInfoSchema = z
  .object({
    userId: z.string(),
    email: z.string().nullable(),
    handle: z.string().nullable(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  })
  .nullable();
export type AuthInfo = z.infer<typeof AuthInfoSchema>;

export const RuntimeRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GET_STATE") }),
  // Only interviews are started explicitly; practice is tracked passively.
  z.object({
    type: z.literal("START_INTERVIEW"),
    problem: ProblemInfoSchema.nullable(),
    question: QuestionDetailsSchema.nullable(),
    facecam: z.boolean().default(false),
    tabId: z.number().nullable().default(null),
  }),
  /** Load the content scripts into a LeetCode tab that has none (opened before an update). */
  z.object({ type: z.literal("INJECT_PAGE"), tabId: z.number() }),
  z.object({ type: z.literal("PAUSE_SESSION") }),
  z.object({ type: z.literal("RESUME_SESSION") }),
  z.object({ type: z.literal("END_SESSION") }),
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
  }),
  z.object({ type: z.literal("SIGN_IN"), provider: z.enum(["github", "google"]) }),
  z.object({ type: z.literal("SIGN_IN_OTP"), email: z.string().email() }),
  z.object({ type: z.literal("VERIFY_OTP"), email: z.string().email(), token: z.string() }),
  z.object({ type: z.literal("SIGN_OUT") }),
  z.object({ type: z.literal("PROBE_APP") }),
  z.object({ type: z.literal("OPEN_APP"), path: z.string().optional() }),
  z.object({ type: z.literal("CANCEL_START") }),
  z.object({ type: z.literal("RETRY_SYNC") }),
  z.object({ type: z.literal("PUBLISH_PROBLEMS"), ids: z.array(z.string().uuid()).min(1) }),
  /** Remove tracked problems from the inbox without posting them (all of them when omitted). */
  z.object({ type: z.literal("CLEAR_TRACKED"), ids: z.array(z.string().uuid()).optional() }),
]);
export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

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

export function toSnapshot(res: Partial<RuntimeSnapshot>): RuntimeSnapshot | null {
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
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
    if (res.ok) return res;
    const transient = /Receiving end does not exist|Extension context invalidated/i.test(res.error);
    if (!transient || attempt === 3) return res;
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  return { ok: false, error: "No response" };
}
