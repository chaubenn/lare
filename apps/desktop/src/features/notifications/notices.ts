/**
 * Everything the app has to tell you that did not come from another person: a permission macOS is
 * withholding, a video that finished processing, a save that failed, an update waiting to install.
 *
 * These used to arrive in four different places — a toast in the corner, a banner above the page, a
 * tray above the status bar, red text inside Settings — so which one you got depended on which part
 * of the app happened to be speaking. They now all land here, and the Notifications page shows them
 * next to likes and follows, behind one unread badge.
 *
 * In memory only: a notice describes what is true on this machine right now, so surviving a restart
 * would mean showing a stale one. The social half of the page is the part that persists, and it
 * comes from the server.
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
  createdAt: number;
  readAt: number | null;
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

/** Old notices are not worth memory; the page only ever shows a screenful. */
const LIMIT = 100;

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

/**
 * Record a notice. Safe to call from anywhere, including outside React — the pipeline and the
 * updater both report from plain functions.
 */
export function notify(options: NoticeOptions): string {
  const previous = options.key ? keyed.get(options.key) : undefined;
  const id = previous ?? `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const notice: Notice = {
    id,
    title: options.title,
    description: options.description ?? null,
    tone: options.variant ?? "info",
    href: options.href ?? null,
    createdAt: Date.now(),
    readAt: null,
  };
  if (options.key) keyed.set(options.key, id);
  notices = [notice, ...notices.filter((n) => n.id !== id)].slice(0, LIMIT);
  emit();
  return id;
}

export function markNoticesRead(): void {
  if (!notices.some((n) => n.readAt === null)) return;
  const now = Date.now();
  notices = notices.map((n) => (n.readAt === null ? { ...n, readAt: now } : n));
  emit();
}

export function dismissNotice(id: string): void {
  notices = notices.filter((n) => n.id !== id);
  for (const [key, value] of keyed) if (value === id) keyed.delete(key);
  emit();
}

export function clearNotices(): void {
  notices = [];
  keyed.clear();
  emit();
}

/** The current list, newest first. What `useNotices` reads, and what tests assert against. */
export function noticesSnapshot(): readonly Notice[] {
  return notices;
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(subscribe, noticesSnapshot, noticesSnapshot) as Notice[];
}

export function useUnreadNoticeCount(): number {
  return useNotices().filter((n) => n.readAt === null).length;
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
