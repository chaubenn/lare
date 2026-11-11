/**
 * The store behind the app's toasts. A factory with no imports, so it runs anywhere, and the app
 * holds a single instance of it (`notices.ts`).
 */

export type NoticeTone = "info" | "success" | "error";

/** A button on the toast for the obvious next step, such as copying the link to a new post. */
export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  id: string;
  title: string;
  description: string | null;
  tone: NoticeTone;
  /** Where clicking the notice goes, when there is somewhere useful. */
  href: string | null;
  action: NoticeAction | null;
  /** When it was last raised; a repeat resets it, which restarts the toast's timer. */
  createdAt: number;
}

export interface NoticeOptions {
  title: string;
  description?: string;
  variant?: NoticeTone;
  href?: string;
  action?: NoticeAction;
  /**
   * Collapses repeats: a second notice with the same key replaces the first instead of stacking.
   * Permission checks and connection state re-report the same fact on every poll.
   */
  key?: string;
}

/** More than this on screen at once is a wall, not a message; the oldest make way. */
const LIMIT = 4;

export interface NoticeStore {
  /**
   * Show a notice and return its id. A notice identical to one still on screen refreshes it rather
   * than stacking a copy: pressing a button that keeps failing the same way says so once.
   */
  notify: (options: NoticeOptions) => string;
  dismiss: (id: string) => void;
  /** What is on screen now, newest first. */
  snapshot: () => readonly Notice[];
  subscribe: (listener: () => void) => () => void;
}

export function createNoticeStore(): NoticeStore {
  let notices: Notice[] = [];
  const keyed = new Map<string, string>();
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const l of listeners) l();
  };
  const forget = (id: string) => {
    for (const [key, value] of keyed) if (value === id) keyed.delete(key);
  };

  return {
    notify(options) {
      const description = options.description ?? null;
      const tone = options.variant ?? "info";
      const href = options.href ?? null;
      const action = options.action ?? null;
      const same = notices.find(
        (n) =>
          n.title === options.title &&
          n.description === description &&
          n.tone === tone &&
          n.href === href &&
          n.action?.label === action?.label,
      );
      const previous = (options.key ? keyed.get(options.key) : undefined) ?? same?.id;
      const id = previous ?? `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const notice: Notice = {
        id,
        title: options.title,
        description,
        tone,
        href,
        action,
        createdAt: Date.now(),
      };
      if (options.key) keyed.set(options.key, id);
      const next = [notice, ...notices.filter((n) => n.id !== id)];
      for (const dropped of next.slice(LIMIT)) forget(dropped.id);
      notices = next.slice(0, LIMIT);
      emit();
      return id;
    },
    dismiss(id) {
      if (!notices.some((n) => n.id === id)) return;
      notices = notices.filter((n) => n.id !== id);
      forget(id);
      emit();
    },
    snapshot: () => notices,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
