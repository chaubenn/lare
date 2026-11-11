/**
 * `localStorage`, for the few things worth remembering on this machine. The webview can refuse
 * storage outright, so nothing here throws: a read that fails is a miss, and a write that fails
 * is reported to the caller, who carries on without it.
 */

/** Every key the app keeps. They are read back by later versions, so the names are permanent. */
export const STORAGE_KEYS = {
  theme: "lare-theme",
  sidebarCollapsed: "lare-sidebar-collapsed",
  /** The app version whose recording-setup screen was skipped. */
  setupDismissedVersion: "lare:setup-dismissed-version",
  extensionPairing: "lare:extension-pairing",
  /** Unsaved edits to one draft, kept until the cloud save lands. */
  draftRecovery: (userId: string, draftId: string) => `lare:draft:${userId}:${draftId}`,
} as const;

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** Whether the value was stored. */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to remove from a store that cannot be reached.
    }
  },
};
