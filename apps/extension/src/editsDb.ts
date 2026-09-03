import type { EditEvent } from "@lare/shared";

/**
 * IndexedDB store for Monaco edit events captured during a session. Lives in
 * the service worker's origin. Cleared once a session has been uploaded.
 */
const DB_NAME = "lare-edits";
const DB_VERSION = 1;
const STORE = "events";

interface EventRow {
  id?: number;
  sessionId: string;
  sessionProblemId: string;
  slug: string;
  language: string | null;
  event: EditEvent;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("byProblem", ["sessionId", "sessionProblemId"], { unique: false });
        store.createIndex("bySession", "sessionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export async function appendEvents(
  sessionId: string,
  sessionProblemId: string,
  slug: string,
  language: string | null,
  events: readonly EditEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const event of events) {
    const row: EventRow = { sessionId, sessionProblemId, slug, language, event };
    store.add(row);
  }
  await txDone(tx);
}

export async function readEvents(
  sessionId: string,
  sessionProblemId: string,
): Promise<{ language: string | null; events: EditEvent[] }> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const index = tx.objectStore(STORE).index("byProblem");
  const rows: EventRow[] = await new Promise((resolve, reject) => {
    const req = index.getAll(IDBKeyRange.only([sessionId, sessionProblemId]));
    req.onsuccess = () => resolve(req.result as EventRow[]);
    req.onerror = () => reject(req.error ?? new Error("read failed"));
  });
  rows.sort((a, b) => a.event.t - b.event.t || (a.id ?? 0) - (b.id ?? 0));
  const language = rows.find((r) => r.language)?.language ?? null;
  return { language, events: rows.map((r) => r.event) };
}

export async function deleteSessionEvents(sessionId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const index = tx.objectStore(STORE).index("bySession");
  await new Promise<void>((resolve, reject) => {
    const req = index.openKeyCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      tx.objectStore(STORE).delete(cursor.primaryKey);
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("delete failed"));
  });
  await txDone(tx);
}
