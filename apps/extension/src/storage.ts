import { EMPTY_EXTENSION_STATE, type ExtensionState, ExtensionStateSchema } from "@lare/shared";
import { idbConnection } from "./idb";

/**
 * Key-value store for secrets: the Supabase session (refresh token included) and the desktop
 * pairing secrets. chrome.storage.local is readable from every content script, so a compromised
 * leetcode.com renderer could lift a refresh token from it. IndexedDB here belongs to the
 * extension's own origin, which only the service worker and extension pages can open (a content
 * script's `indexedDB` is the page's), and unlike chrome.storage.session it survives a restart.
 */
const SECURE_DB = "lare-secure";
const SECURE_STORE = "kv";

const beginSecureTx = idbConnection(SECURE_DB, 1, (db) => {
  if (!db.objectStoreNames.contains(SECURE_STORE)) db.createObjectStore(SECURE_STORE);
});

async function secureRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const tx = await beginSecureTx(SECURE_STORE, mode);
  return new Promise((resolve, reject) => {
    const req = run(tx.objectStore(SECURE_STORE));
    tx.oncomplete = () => resolve(req.result);
    // A failed request reaches the transaction before the transaction has an error of its own.
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error("transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    const v = await secureRequest("readonly", (s) => s.get(key));
    return typeof v === "string" ? v : null;
  },
  async set(key: string, value: string): Promise<void> {
    await secureRequest("readwrite", (s) => s.put(value, key));
  },
  async remove(key: string): Promise<void> {
    await secureRequest("readwrite", (s) => s.delete(key));
  },
  async removePrefix(prefix: string): Promise<void> {
    await secureRequest("readwrite", (s) =>
      s.delete(IDBKeyRange.bound(prefix, `${prefix}￿`, false, false)),
    );
  },
};

/**
 * Store `value` under `key` unless something is there already, and return what is stored. A
 * legacy session moved over while supabase-js writes a newer one must not overwrite it.
 */
async function secureAdopt(key: string, value: string): Promise<string | null> {
  try {
    await secureRequest("readwrite", (s) => s.add(value, key));
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "ConstraintError")) throw e;
  }
  return secureStorage.get(key);
}

/**
 * supabase-js storage adapter (service-worker safe), backed by `secureStorage`. Builds before
 * this one kept the session in chrome.storage.local; it is moved over on first read, so an
 * update does not sign anyone out.
 */
export const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const stored = await secureStorage.get(key);
    if (stored !== null) return stored;
    const legacy = (await chrome.storage.local.get(key))[key];
    if (typeof legacy !== "string") return null;
    const adopted = await secureAdopt(key, legacy);
    await chrome.storage.local.remove(key);
    return adopted;
  },
  async setItem(key: string, value: string): Promise<void> {
    await secureStorage.set(key, value);
    await chrome.storage.local.remove(key);
  },
  async removeItem(key: string): Promise<void> {
    await secureStorage.remove(key);
    await chrome.storage.local.remove(key);
  },
};

/** Also read by the e2e suite, which resets it between tests. */
export const STATE_KEY = "lare:state";

export async function loadState(): Promise<ExtensionState> {
  const res = await chrome.storage.local.get(STATE_KEY);
  const stored = res[STATE_KEY];
  const parsed = ExtensionStateSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  // Nothing stored yet is the normal first run; anything else is state this build cannot read
  // (an older schema version, or damage), which is dropped for a fresh start.
  if (stored !== undefined)
    console.warn(
      "[lare] stored state does not match the schema; starting empty:",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return { ...EMPTY_EXTENSION_STATE };
}

/**
 * Serialised read-modify-write. Service-worker handlers run concurrently, so
 * every mutation goes through this lock to avoid lost updates.
 */
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

export function withState<T>(
  fn: (
    state: ExtensionState,
  ) => Promise<{ state: ExtensionState; result: T }> | { state: ExtensionState; result: T },
): Promise<T> {
  return locked(async () => {
    const current = await loadState();
    const { state, result } = await fn(current);
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return result;
  });
}

/**
 * Forget all state (sign-out). Takes the same lock as `withState`: a mutation still in flight
 * would otherwise write the state back after it was removed.
 */
export function clearState(): Promise<void> {
  return locked(() => chrome.storage.local.remove(STATE_KEY));
}
