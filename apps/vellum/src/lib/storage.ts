// Saved documents live in the browser's IndexedDB (localStorage's ~5 MB cap is too small once
// reference images are embedded). A light "meta" store lets the list load without the images.
import type { ProjectFile } from "./types.js";

const DB_NAME = "vector-tracer";
const META = "meta";
const DATA = "data";

export interface DocumentMeta {
  id: string;
  name: string;
  updated: number;
}

interface DataRecord {
  id: string;
  data: ProjectFile;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("This browser has no IndexedDB storage."));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(META, { keyPath: "id" });
        db.createObjectStore(DATA, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted (quota?)"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Saved documents, newest first. */
export async function listDocuments(): Promise<DocumentMeta[]> {
  const db = await openDb();
  const all = await request<DocumentMeta[]>(db.transaction(META).objectStore(META).getAll());
  return all.sort((a, b) => b.updated - a.updated);
}

export async function saveDocument(doc: {
  id: string;
  name: string;
  data: ProjectFile;
}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, DATA], "readwrite");
  tx.objectStore(META).put({ id: doc.id, name: doc.name, updated: Date.now() });
  tx.objectStore(DATA).put({ id: doc.id, data: doc.data });
  await done(tx);
}

export async function loadDocument(id: string): Promise<ProjectFile | null> {
  const db = await openDb();
  const rec = await request<DataRecord | undefined>(db.transaction(DATA).objectStore(DATA).get(id));
  return rec ? rec.data : null;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, DATA], "readwrite");
  tx.objectStore(META).delete(id);
  tx.objectStore(DATA).delete(id);
  await done(tx);
}

export async function renameDocument(id: string, name: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  const store = tx.objectStore(META);
  const rec = await request<DocumentMeta | undefined>(store.get(id));
  if (rec) store.put({ ...rec, name });
  await done(tx);
}

export async function duplicateDocument(id: string, newId: string, name: string): Promise<void> {
  const db = await openDb();
  const rec = await request<DataRecord | undefined>(db.transaction(DATA).objectStore(DATA).get(id));
  if (!rec) return;
  const tx = db.transaction([META, DATA], "readwrite");
  tx.objectStore(META).put({ id: newId, name, updated: Date.now() });
  tx.objectStore(DATA).put({ id: newId, data: rec.data });
  await done(tx);
}
