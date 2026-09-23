// Saved documents live in the browser's IndexedDB (localStorage's ~5 MB cap is too small once
// reference images are embedded). A light "meta" store lets the list load without the images.
import type { ProjectFile } from "./types.js";

const DB_NAME = "vellum";
const META = "meta";
const DATA = "data";

export interface DocumentMeta {
  id: string;
  name: string;
  updated: number;
  /** Place in the Documents list, lowest first. Set by the person, not by recency. */
  order: number;
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

/** Saved documents, in the order the list shows them. */
export async function listDocuments(): Promise<DocumentMeta[]> {
  const db = await openDb();
  const all = await request<DocumentMeta[]>(db.transaction(META).objectStore(META).getAll());
  // Greenfield: a library written before documents had a place in the list is refused, not
  // guessed at. Clearing the site's storage starts it again.
  if (all.some((m) => typeof m.order !== "number")) {
    throw new Error(
      "These documents were saved by an older Vellum. Clear this site's storage to start again."
    );
  }
  return all.sort((a, b) => a.order - b.order);
}

/** A new document's place: above everything already in the list. */
const topOrder = (all: readonly DocumentMeta[]) => Math.min(0, ...all.map((m) => m.order)) - 1;

/** Saves a document. One that is new goes to the top of the list; one that exists keeps its place. */
export async function saveDocument(doc: {
  id: string;
  name: string;
  data: ProjectFile;
}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, DATA], "readwrite");
  const meta = tx.objectStore(META);
  const all = await request<DocumentMeta[]>(meta.getAll());
  const existing = all.find((m) => m.id === doc.id);
  const record: DocumentMeta = {
    ...existing,
    id: doc.id,
    name: doc.name,
    updated: Date.now(),
    order: existing?.order ?? topOrder(all),
  };
  meta.put(record);
  tx.objectStore(DATA).put({ id: doc.id, data: doc.data });
  await done(tx);
}

/** Puts the list in the given order. Ids it does not name keep their place after those it does. */
export async function reorderDocuments(ids: readonly string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  const meta = tx.objectStore(META);
  const all = await request<DocumentMeta[]>(meta.getAll());
  for (const m of all) {
    const at = ids.indexOf(m.id);
    meta.put({ ...m, order: at < 0 ? ids.length + m.order : at });
  }
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
  const meta = tx.objectStore(META);
  const all = await request<DocumentMeta[]>(meta.getAll());
  // A copy goes on top, like any new document.
  meta.put({ id: newId, name, updated: Date.now(), order: topOrder(all) });
  tx.objectStore(DATA).put({ id: newId, data: rec.data });
  await done(tx);
}
