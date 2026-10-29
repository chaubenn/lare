import { EMPTY_EXTENSION_STATE, type ExtensionState, ExtensionStateSchema } from "@lare/shared";

/** supabase-js storage adapter backed by chrome.storage.local (service-worker safe). */
export const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const res = await chrome.storage.local.get(key);
    const v = res[key];
    return typeof v === "string" ? v : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

const STATE_KEY = "lare:state";

export async function loadState(): Promise<ExtensionState> {
  const res = await chrome.storage.local.get(STATE_KEY);
  const parsed = ExtensionStateSchema.safeParse(res[STATE_KEY]);
  return parsed.success ? parsed.data : { ...EMPTY_EXTENSION_STATE };
}

export async function saveState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

/**
 * Serialised read-modify-write. Service-worker handlers run concurrently, so
 * every mutation goes through this lock to avoid lost updates.
 */
let chain: Promise<unknown> = Promise.resolve();
export function withState<T>(
  fn: (
    state: ExtensionState,
  ) => Promise<{ state: ExtensionState; result: T }> | { state: ExtensionState; result: T },
): Promise<T> {
  const run = chain.then(async () => {
    const current = await loadState();
    const { state, result } = await fn(current);
    await saveState(state);
    return result;
  });
  chain = run.catch(() => undefined);
  return run;
}
