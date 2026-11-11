/**
 * One cached IndexedDB connection per database. Returns a function that starts a transaction on
 * it, opening the database on first use.
 */
export function idbConnection(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): (stores: string | string[], mode: IDBTransactionMode) => Promise<IDBTransaction> {
  let cached: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    cached ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => {
        const db = req.result;
        // The browser can close the connection under us (site data cleared, extension
        // reloaded, storage eviction). Drop the cached handle so the next call reopens.
        db.onclose = () => {
          cached = null;
        };
        db.onversionchange = () => {
          db.close();
          cached = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        cached = null;
        reject(req.error ?? new Error("indexedDB open failed"));
      };
    });
    return cached;
  };

  return async (stores, mode) => {
    try {
      return (await open()).transaction(stores, mode);
    } catch (err) {
      // A connection that went stale without telling us: reopen once.
      if (!(err instanceof DOMException) || err.name !== "InvalidStateError") throw err;
      cached = null;
      return (await open()).transaction(stores, mode);
    }
  };
}
