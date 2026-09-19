/**
 * Everything the app has to tell you that did not come from another person: a permission macOS is
 * withholding, a video that finished processing, a save that failed, an update waiting to install.
 *
 * Each one shows as a toast in the top-right corner (`Toaster`) and leaves on its own, so the
 * Notifications page stays about people. Anything that must outlive the toast — a failed upload,
 * an update — points somewhere with `href`, where the lasting state lives.
 *
 * In memory only: a notice describes what is true on this machine right now.
 */

import { useCallback, useSyncExternalStore } from "react";

export type NoticeTone = "info" | "success" | "error";

export interface Notice {
  id: string;
  title: string;
  description: string | null;
  tone: NoticeTone;
  /** Where clicking the notice goes, when there is somewhere useful. */
  href: string | null;
  /** When it was last raised; a repeat resets it, which restarts the toast's timer. */
  createdAt: number;
}

/** What a caller passes. `variant` matches the toast API these replaced, so call sites read the same. */
export interface NoticeOptions {
  title: string;
  description?: string;
  variant?: NoticeTone;
  href?: string;
  /**
   * Collapses repeats: a second notice with the same key replaces the first instead of stacking.
   * Permission checks and connection state re-report the same fact on every poll.
   */
  key?: string;
}

/** More than this on screen at once is a wall, not a message; the oldest make way. */
const LIMIT = 4;

type Listener = () => void;

let notices: Notice[] = [];
const keyed = new Map<string, string>();
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function forget(id: string) {
  for (const [key, value] of keyed) if (value === id) keyed.delete(key);
}

/**
 * Show a notice. Safe to call from anywhere, including outside React — the pipeline and the
 * updater both report from plain functions.
 *
 * A notice identical to one still on screen refreshes it rather than stacking a copy: pressing a
 * button that keeps failing the same way says so once.
 */
export function notify(options: NoticeOptions): string {
  const description = options.description ?? null;
  const tone = options.variant ?? "info";
  const href = options.href ?? null;
  const same = notices.find(
    (n) =>
      n.title === options.title &&
      n.description === description &&
      n.tone === tone &&
      n.href === href,
  );
  const previous = (options.key ? keyed.get(options.key) : undefined) ?? same?.id;
  const id = previous ?? `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const notice: Notice = {
    id,
    title: options.title,
    description,
    tone,
    href,
    createdAt: Date.now(),
  };
  if (options.key) keyed.set(options.key, id);
  const next = [notice, ...notices.filter((n) => n.id !== id)];
  for (const dropped of next.slice(LIMIT)) forget(dropped.id);
  notices = next.slice(0, LIMIT);
  emit();
  return id;
}

export function dismissNotice(id: string): void {
  if (!notices.some((n) => n.id === id)) return;
  notices = notices.filter((n) => n.id !== id);
  forget(id);
  emit();
}

/** What is on screen now, newest first. What `useNotices` reads, and what tests assert against. */
export function noticesSnapshot(): readonly Notice[] {
  return notices;
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(subscribe, noticesSnapshot, noticesSnapshot) as Notice[];
}

/**
 * `const { notify } = useNotify()` — the shape the toast hook had, so the call sites that moved over
 * read the same as before.
 */
export function useNotify(): { notify: (options: NoticeOptions) => string } {
  return { notify: useCallback((options: NoticeOptions) => notify(options), []) };
}

/** Test seam: the store is module state, so a test that posts notices has to reset it. */
export function __resetNoticesForTest(): void {
  notices = [];
  keyed.clear();
  listeners.clear();
}
