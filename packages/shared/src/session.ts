/**
 * Extension-side persisted state (chrome.storage.local).
 *
 * Two independent things live here:
 *
 * - `tracking` is passive practice capture. There is nothing to start or stop:
 *   every problem opened and every submission made is recorded against the
 *   user's long-lived "inbox" session server-side (see the practice_inbox
 *   migration). No timer, so no timer events.
 * - `interview` is a mock interview, which is still an explicit, timed session
 *   with a start and an end. Its timer is derived from `events` (see timer.ts)
 *   so a restarted service worker resumes exactly where it left off.
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

/**
 * A problem the extension has seen while tracking passively. Deliberately thin:
 * it is a local index onto the server row so repeat visits to the same problem
 * reuse one `session_problems` id, plus just enough to render a picker.
 */
export const InboxProblemSchema = z.object({
  /** Supabase session_problems.id (uuid, generated client-side). */
  sessionProblemId: z.string(),
  slug: z.string(),
  title: z.string(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  submissionCount: z.number().int().nonnegative().default(0),
  acceptedCount: z.number().int().nonnegative().default(0),
  /**
   * When the user last took this problem over to the desktop app, or null while it
   * is still waiting to be looked at. Only unreviewed problems are counted on the
   * badge and listed in the popup.
   *
   * Reviewed entries are kept rather than deleted because this list doubles as the
   * slug -> `session_problems.id` map: dropping an entry would mint a fresh row the
   * next time the same problem is opened, duplicating it in the inbox and in the
   * desktop picker. The server row is untouched either way — the desktop app stays
   * the source of truth for what has actually been posted.
   */
  reviewedAt: z.number().nullable().default(null),
  /** Whether the `session_problems` row exists in Supabase yet. */
  synced: z.boolean().default(false),
});
export type InboxProblem = z.infer<typeof InboxProblemSchema>;

export const TrackingStateSchema = z.object({
  /** `sessions.id` of the practice inbox, resolved lazily via the practice_inbox RPC. */
  inboxSessionId: z.string().nullable().default(null),
  problems: z.array(InboxProblemSchema).default([]),
});
export type TrackingState = z.infer<typeof TrackingStateSchema>;

export const EMPTY_TRACKING_STATE: TrackingState = { inboxSessionId: null, problems: [] };

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
  /**
   * 2 = passive tracking. Bumped from 1 so state written by a build that still
   * had the on-page overlay is discarded rather than half-read; the practice
   * session it might describe no longer has anywhere to live.
   */
  version: z.literal(2),
  /** The live mock interview, if one is running. Practice never appears here. */
  interview: ActiveSessionSchema.nullable(),
  tracking: TrackingStateSchema.default(EMPTY_TRACKING_STATE),
  /** Last known desktop connection state (for UI only). */
  appConnected: z.boolean().default(false),
  /** Interviews that ended but failed to fully sync; flushed on next start-up. */
  pendingSync: z.array(z.string()).default([]),
});
export type ExtensionState = z.infer<typeof ExtensionStateSchema>;

export const EMPTY_EXTENSION_STATE: ExtensionState = {
  version: 2,
  interview: null,
  tracking: EMPTY_TRACKING_STATE,
  appConnected: false,
  pendingSync: [],
};
