/**
 * Internal runtime messages between the content script / popup and the service
 * worker. Distinct from the desktop protocol in @lare/shared/protocol.
 */
import {
  DistributionSchema,
  EditEventSchema,
  ExtensionStateSchema,
  ProblemInfoSchema,
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
  z.object({
    type: z.literal("START_SESSION"),
    kind: z.enum(["practice", "interview"]),
    scope: z.enum(["session", "problem"]),
    problem: ProblemInfoSchema.nullable(),
    question: QuestionDetailsSchema.nullable(),
    facecam: z.boolean().default(false),
    tabId: z.number().nullable().default(null),
  }),
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
]);
export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

export interface RuntimeSnapshot {
  state: z.infer<typeof ExtensionStateSchema>;
  auth: AuthInfo;
  appConnected: boolean;
}

export type RuntimeResponse =
  | ({ ok: true; postId?: string } & Partial<RuntimeSnapshot>)
  | { ok: false; error: string };

export interface StateBroadcast extends RuntimeSnapshot {
  type: "STATE_CHANGED";
  toast?: { kind: "info" | "success" | "error"; text: string } | undefined;
}

export function sendRuntime(req: RuntimeRequest): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(req, (res: RuntimeResponse | undefined) => {
        if (chrome.runtime.lastError || !res) {
          resolve({ ok: false, error: chrome.runtime.lastError?.message ?? "No response" });
        } else {
          resolve(res);
        }
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
