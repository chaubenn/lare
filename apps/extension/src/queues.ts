/**
 * Small persisted queues the service worker drains when it can. Each lives under its own
 * chrome.storage key, apart from `lare:state`, so a full state reset (sign-out) or a schema bump
 * there never loses work that is still waiting to be delivered.
 */
import type { ProblemInfo } from "@lare/shared";
import type { CapturedSubmission } from "./messages";

const SUBMISSIONS_KEY = "lare:submission-queue";
const OUTBOX_KEY = "lare:desktop-outbox";
const SYNC_RETRY_KEY = "lare:sync-retry-attempt";
/** Oldest submissions are dropped past this; a week offline should not fill chrome.storage. */
const MAX_QUEUED_SUBMISSIONS = 50;

/** Read-modify-write on one key, serialised like `withState` (handlers run concurrently). */
let chain: Promise<unknown> = Promise.resolve();
function update<T, R>(
  key: string,
  read: (raw: unknown) => T,
  fn: (value: T) => [T, R],
): Promise<R> {
  const run = chain.then(async () => {
    const res = await chrome.storage.local.get(key);
    const [next, result] = fn(read(res[key]));
    await chrome.storage.local.set({ [key]: next });
    return result;
  });
  chain = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Practice submissions that could not be saved (offline, Supabase down)
// ---------------------------------------------------------------------------

export interface QueuedSubmission {
  id: string;
  /** Only flushed while this user is signed in: the row belongs to their inbox. */
  userId: string;
  slug: string;
  /** Lets the flush create the inbox row if it still does not exist. */
  problem: ProblemInfo | null;
  /** Attach to this exact row (an interview problem) instead of the inbox one. */
  sessionProblemId: string | null;
  submission: CapturedSubmission;
  queuedAt: number;
}

const readSubmissions = (raw: unknown): QueuedSubmission[] =>
  Array.isArray(raw) ? (raw as QueuedSubmission[]) : [];

export function loadSubmissionQueue(): Promise<QueuedSubmission[]> {
  return update(SUBMISSIONS_KEY, readSubmissions, (q) => [q, q]);
}

export function enqueueSubmission(entry: Omit<QueuedSubmission, "id">): Promise<void> {
  return update(SUBMISSIONS_KEY, readSubmissions, (q) => {
    // A re-captured submission replaces its queued copy rather than saving twice.
    const rest = q.filter(
      (e) =>
        entry.submission.leetcodeSubmissionId === null ||
        e.submission.leetcodeSubmissionId !== entry.submission.leetcodeSubmissionId,
    );
    const next = [...rest, { ...entry, id: crypto.randomUUID() }];
    return [next.slice(-MAX_QUEUED_SUBMISSIONS), undefined];
  });
}

export function removeQueuedSubmission(id: string): Promise<void> {
  return update(SUBMISSIONS_KEY, readSubmissions, (q) => [q.filter((e) => e.id !== id), undefined]);
}

// ---------------------------------------------------------------------------
// session.end / session.cancel frames the desktop app was not connected for
// ---------------------------------------------------------------------------

export type OutboxFrame = "end" | "cancel";
type Outbox = Record<string, OutboxFrame>;

const readOutbox = (raw: unknown): Outbox =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Outbox) : {};

export function queueDesktopFrame(sessionId: string, frame: OutboxFrame): Promise<void> {
  return update(OUTBOX_KEY, readOutbox, (o) => [{ ...o, [sessionId]: frame }, undefined]);
}

export function clearDesktopFrame(sessionId: string): Promise<void> {
  return update(OUTBOX_KEY, readOutbox, (o) => {
    const { [sessionId]: _dropped, ...rest } = o;
    return [rest, undefined];
  });
}

/** Everything waiting, removed from storage: the caller delivers it now or it is moot. */
export function takeDesktopOutbox(): Promise<Outbox> {
  return update(OUTBOX_KEY, readOutbox, (o) => [{}, o]);
}

export function hasDesktopOutbox(): Promise<boolean> {
  return update(OUTBOX_KEY, readOutbox, (o) => [o, Object.keys(o).length > 0]);
}

// ---------------------------------------------------------------------------
// Backoff for retrying unsaved mock interviews
// ---------------------------------------------------------------------------

/** Minutes between retries; the last step repeats until the save goes through or is discarded. */
const SYNC_RETRY_MINUTES = [0.5, 1, 2, 5, 10, 30];

/** Bump the attempt count (or reset it) and return the delay before the next retry. */
export function nextSyncRetryDelay(reset: boolean): Promise<number> {
  return update(
    SYNC_RETRY_KEY,
    (raw) => (typeof raw === "number" ? raw : -1),
    (attempt) => {
      const next = reset ? 0 : attempt + 1;
      const delay = SYNC_RETRY_MINUTES[Math.min(next, SYNC_RETRY_MINUTES.length - 1)] ?? 30;
      return [next, delay];
    },
  );
}

export async function resetSyncRetry(): Promise<void> {
  await chain;
  await chrome.storage.local.remove(SYNC_RETRY_KEY);
}
