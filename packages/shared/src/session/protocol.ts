/**
 * Extension <-> desktop app protocol over ws://127.0.0.1:47831.
 * Every frame is a JSON object with a `type` discriminator. Mirrored in Rust
 * by crates/lare-core/src/protocol.rs — keep both in sync (PROTOCOL_VERSION).
 */
import { z } from "zod";
import { DifficultySchema } from "../leetcode/leetcode";
import { PAIRING_DOMAIN } from "./constants";
import { EditEventSchema } from "./edits";

export const ProblemInfoSchema = z.object({
  slug: z.string(),
  frontendId: z.string().nullable(),
  title: z.string(),
  difficulty: DifficultySchema.nullable(),
  url: z.string(),
  language: z.string().nullable(),
});
export type ProblemInfo = z.infer<typeof ProblemInfoSchema>;

export const SubmissionInfoSchema = z.object({
  leetcodeSubmissionId: z.number().nullable(),
  submittedAt: z.number(), // epoch ms
  lang: z.string().nullable(),
  statusDisplay: z.string().nullable(),
  statusCode: z.number().nullable(),
  accepted: z.boolean(),
  runtimeMs: z.number().nullable(),
  runtimePercentile: z.number().nullable(),
  memoryMb: z.number().nullable(),
  memoryPercentile: z.number().nullable(),
  totalCorrect: z.number().nullable(),
  totalTestcases: z.number().nullable(),
  code: z.string().nullable(),
});
export type SubmissionInfo = z.infer<typeof SubmissionInfoSchema>;

// ----- extension -> app -----------------------------------------------------
export const ExtHelloSchema = z.object({
  type: z.literal("hello"),
  protocol: z.number().int(),
  extVersion: z.string(),
  userId: z.string().nullable(),
  /** 32 random bytes (hex) that the app's `auth.challenge` proof covers. Absent before v4. */
  nonce: z.string().optional(),
});

/** The extension's half of the pairing handshake, answering `auth.challenge`. */
export const AuthResponseSchema = z.object({
  type: z.literal("auth.response"),
  proof: z.string(),
});

export const SessionStartSchema = z.object({
  type: z.literal("session.start"),
  sessionId: z.string(),
  kind: z.enum(["practice", "interview"]),
  scope: z.enum(["session", "problem"]),
  startedAt: z.number(),
  problem: ProblemInfoSchema.nullable(),
  /** Interview only: record the webcam as a PiP track. */
  facecam: z.boolean().default(false),
  /** Interview only: capture the microphone (always true for interviews in v1). */
  mic: z.boolean().default(true),
});

export const ProblemOpenSchema = z.object({
  type: z.literal("problem.open"),
  sessionId: z.string(),
  sessionProblemId: z.string(),
  at: z.number(),
  problem: ProblemInfoSchema,
});

export const EditsBatchSchema = z.object({
  type: z.literal("edits.batch"),
  sessionId: z.string(),
  sessionProblemId: z.string(),
  slug: z.string(),
  events: z.array(EditEventSchema),
});

export const SubmissionMsgSchema = z.object({
  type: z.literal("submission"),
  sessionId: z.string(),
  sessionProblemId: z.string(),
  submission: SubmissionInfoSchema,
});

export const ExtToAppSchema = z.discriminatedUnion("type", [
  ExtHelloSchema,
  AuthResponseSchema,
  SessionStartSchema,
  z.object({ type: z.literal("session.pause"), sessionId: z.string(), at: z.number() }),
  z.object({ type: z.literal("session.resume"), sessionId: z.string(), at: z.number() }),
  z.object({ type: z.literal("session.end"), sessionId: z.string(), at: z.number() }),
  /** Throw the recording away: the interview was discarded rather than ended. */
  z.object({ type: z.literal("session.cancel"), sessionId: z.string(), at: z.number() }),
  ProblemOpenSchema,
  EditsBatchSchema,
  SubmissionMsgSchema,
  z.object({ type: z.literal("ping"), at: z.number() }),
]);
export type ExtToApp = z.infer<typeof ExtToAppSchema>;

// ----- app -> extension -----------------------------------------------------
export const RecordingStateSchema = z.enum([
  "idle",
  "starting",
  "recording",
  "paused",
  "stopping",
  "error",
]);
export type RecordingState = z.infer<typeof RecordingStateSchema>;

/** The recorder's state as of its last `recording.state` frame (sent in `hello.ack`). */
export const RecordingSnapshotSchema = z.object({
  /** Null for a demo recording started from the app. */
  sessionId: z.string().nullable(),
  state: RecordingStateSchema,
  startedAt: z.number().nullable(),
});
export type RecordingSnapshot = z.infer<typeof RecordingSnapshotSchema>;

export const AppToExtSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello.ack"),
    /**
     * The protocol both sides will speak (the lower of the two). Optional so an app too old to
     * send one still parses, and is then reported as needing an update.
     */
    protocol: z.number().int().optional(),
    appVersion: z.string().optional(),
    userId: z.string().nullable(),
    /** True when screen recording permission is granted and devices are available. */
    recordingCapable: z.boolean(),
    /** Null when nothing is recording; absent from apps older than protocol 3. */
    recording: RecordingSnapshotSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal("recording.state"),
    sessionId: z.string().nullable(),
    state: RecordingStateSchema,
    /** Epoch ms when media time 0 occurred; null until recording. */
    startedAt: z.number().nullable(),
    message: z.string().nullable().optional(),
  }),
  /**
   * The app's half of the pairing handshake: `proof` covers the extension's nonce, and the
   * extension answers with one covering `nonce`. `installId` names the secret to look up.
   */
  z.object({
    type: z.literal("auth.challenge"),
    installId: z.string(),
    nonce: z.string(),
    proof: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "not_signed_in",
      "user_mismatch",
      "permission_denied",
      "already_recording",
      "recording_failed",
      "bad_message",
      "unsupported_protocol",
      "auth_failed",
    ]),
    message: z.string(),
  }),
  z.object({ type: z.literal("pong"), at: z.number() }),
]);
export type AppToExt = z.infer<typeof AppToExtSchema>;

/**
 * What each side's pairing proof is an HMAC-SHA256 of, keyed with the install's secret (see
 * `ws_server.rs`). `role` keeps one side's proof from ever passing as the other's.
 */
export function pairingTranscript(
  role: "app" | "ext",
  userId: string,
  extNonce: string,
  appNonce: string,
): string {
  return [PAIRING_DOMAIN, role, userId, extNonce, appNonce].join("\n");
}

export function encode(msg: ExtToApp | AppToExt): string {
  return JSON.stringify(msg);
}

export function decodeExtToApp(raw: string): ExtToApp | null {
  try {
    const r = ExtToAppSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function decodeAppToExt(raw: string): AppToExt | null {
  try {
    const r = AppToExtSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
