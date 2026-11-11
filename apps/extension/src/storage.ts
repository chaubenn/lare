import { EMPTY_EXTENSION_STATE, type ExtensionState, ExtensionStateSchema } from "@lare/shared";

/**
 * Key-value store for secrets: the Supabase session (refresh token included) and the desktop
 * pairing secrets. chrome.storage.local is readable from every content script, so a compromised
 * leetcode.com renderer could lift a refresh token from it. IndexedDB here belongs to the
 * extension's own origin, which only the service worker and extension pages can open (a content
 * script's `indexedDB` is the page's), and unlike chrome.storage.session it survives a restart.
 */
const SECURE_DB = "lare-secure";
const SECURE_STORE = "kv";

let secureDb: Promise<IDBDatabase> | null = null;

function openSecureDb(): Promise<IDBDatabase> {
  secureDb ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(SECURE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SECURE_STORE))
        req.result.createObjectStore(SECURE_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Closed under us (extension reloaded, storage cleared): reopen on next use.
      db.onclose = () => {
        secureDb = null;
      };
      db.onversionchange = () => {
        db.close();
        secureDb = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      secureDb = null;
      reject(req.error ?? new Error("indexedDB open failed"));
    };
  });
  return secureDb;
}

async function secureRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openSecureDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SECURE_STORE, mode);
    const req = run(tx.objectStore(SECURE_STORE));
    tx.oncomplete = () => resolve(req.result);
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
  /** Every key starting with `prefix`. */
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
