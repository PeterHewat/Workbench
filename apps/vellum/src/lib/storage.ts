// Saved documents live in the browser's IndexedDB (localStorage's ~5 MB cap is too small once
// reference images are embedded). A light "meta" store lets the list load without the images.
import type { ProjectFile } from "./types.js";

const DB_NAME = "vellum";
/**
 * The database's own version, for its stores rather than the documents in them (those carry
 * `ProjectFile.version`). 1 was the unreleased Vellum, whose documents are not kept; from 2 on,
 * an upgrade keeps everything.
 */
const DB_VERSION = 2;
const META = "meta";
const DATA = "data";

/** True when this load found an unreleased library and started it again, empty. */
export let libraryReset = false;

export interface DocumentMeta {
  id: string;
  name: string;
  updated: number;
  /** Place in the Documents list, lowest first. Set by the person, not by recency. */
  order: number;
  /** Labels to find it by; absent when it has none. */
  tags?: string[];
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
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 2) {
          libraryReset = e.oldVersion > 0;
          for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
          db.createObjectStore(META, { keyPath: "id" });
          db.createObjectStore(DATA, { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // A newer Vellum in another tab needs this connection gone before it can upgrade.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("Could not open the document library."));
      };
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
  return all.sort((a, b) => a.order - b.order);
}

/** A new document's place: above everything already in the list. */
const topOrder = (all: readonly DocumentMeta[]) => Math.min(0, ...all.map((m) => m.order)) - 1;
/** A place below everything already in the list. */
const bottomOrder = (all: readonly DocumentMeta[]) => Math.max(0, ...all.map((m) => m.order)) + 1;

/** Saves a document. One that is new goes to the top of the list; one that exists keeps its place. */
export async function saveDocument(doc: {
  id: string;
  name: string;
  /** Given for a document coming in from a file; an autosave leaves the stored ones alone. */
  tags?: string[];
  data: ProjectFile;
  /** Where a new document goes: the top, as for anything made or imported, or the bottom. */
  place?: "top" | "bottom";
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
    order: existing?.order ?? (doc.place === "bottom" ? bottomOrder(all) : topOrder(all)),
  };
  if (doc.tags?.length) record.tags = doc.tags;
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

/** Replaces a document's tags; none takes the field away. */
export async function setDocumentTags(id: string, tags: readonly string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  const store = tx.objectStore(META);
  const rec = await request<DocumentMeta | undefined>(store.get(id));
  if (rec) {
    const next: DocumentMeta = { ...rec, tags: [...tags] };
    if (!tags.length) delete next.tags;
    store.put(next);
  }
  await done(tx);
}

export async function duplicateDocument(id: string, newId: string, name: string): Promise<void> {
  const db = await openDb();
  const rec = await request<DataRecord | undefined>(db.transaction(DATA).objectStore(DATA).get(id));
  if (!rec) return;
  const tx = db.transaction([META, DATA], "readwrite");
  const meta = tx.objectStore(META);
  const all = await request<DocumentMeta[]>(meta.getAll());
  const tags = all.find((m) => m.id === id)?.tags;
  // A copy goes on top, like any new document, and keeps the original's tags.
  meta.put({
    id: newId,
    name,
    updated: Date.now(),
    order: topOrder(all),
    ...(tags?.length ? { tags: [...tags] } : {}),
  });
  tx.objectStore(DATA).put({ id: newId, data: rec.data });
  await done(tx);
}
