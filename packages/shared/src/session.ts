/**
 * Extension-side persisted session state (chrome.storage.local). The timer is
 * derived from `events` (see timer.ts) so a restarted service worker resumes
 * exactly where it left off.
 */
import { z } from "zod";
import { ProblemInfoSchema, SubmissionInfoSchema } from "./protocol";
import { TimerEventSchema } from "./timer";

export const TrackedProblemSchema = z.object({
  /** Supabase session_problems.id (uuid, generated client-side). */
  sessionProblemId: z.string(),
  problem: ProblemInfoSchema,
  openedAt: z.number(),
  closedAt: z.number().nullable(),
  /** Number of edit events captured so far (edits themselves live in IndexedDB). */
  editCount: z.number().int().nonnegative().default(0),
  submissions: z.array(SubmissionInfoSchema).default([]),
  /** Whether the row has been created in Supabase. */
  synced: z.boolean().default(false),
});
export type TrackedProblem = z.infer<typeof TrackedProblemSchema>;

export const ActiveSessionSchema = z.object({
  sessionId: z.string(),
  kind: z.enum(["practice", "interview"]),
  scope: z.enum(["session", "problem"]),
  startedAt: z.number(),
  events: z.array(TimerEventSchema),
  problems: z.array(TrackedProblemSchema),
  /** Slug of the problem currently open in the active tab, if any. */
  currentSlug: z.string().nullable(),
  /** Tab that started the session (used to scope UI). */
  tabId: z.number().nullable(),
  facecam: z.boolean().default(false),
  /** Whether the Supabase `sessions` row exists yet. */
  synced: z.boolean().default(false),
});
export type ActiveSession = z.infer<typeof ActiveSessionSchema>;

export const ExtensionStateSchema = z.object({
  version: z.literal(1),
  session: ActiveSessionSchema.nullable(),
  /** Last known desktop connection state (for UI only). */
  appConnected: z.boolean().default(false),
  /** Sessions that ended but failed to fully sync; flushed on next start-up. */
  pendingSync: z.array(z.string()).default([]),
});
export type ExtensionState = z.infer<typeof ExtensionStateSchema>;

export const EMPTY_EXTENSION_STATE: ExtensionState = {
  version: 1,
  session: null,
  appConnected: false,
  pendingSync: [],
};
