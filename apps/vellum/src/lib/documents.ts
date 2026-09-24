import { getState, setState, replaceState, createInitialState } from "./state.js";
import { clearHistory, setHistoryListener } from "./undo.js";
import {
  listDocuments,
  saveDocument,
  loadDocument,
  deleteDocument,
  renameDocument,
  duplicateDocument,
  reorderDocuments,
  libraryReset,
  type DocumentMeta,
} from "./storage.js";
import { serializeProject, loadProject, readProject } from "./io.js";
import { deepClone, escapeAttr, uid } from "./utils.js";
import { byId, downloadText, registerServiceWorker } from "@workbench/ui";
import { type ProjectFile } from "./types.js";
import { savedView } from "./session.js";
import { setSectionOpen } from "./layout.js";
import { fitToView } from "./zoom.js";
import { invalidateLists, rowDotHtml } from "./accordion.js";
import { hydrateImageDimensions } from "./images-panel.js";
import { WELCOME_NAME, loadWelcome } from "./welcome.js";

/** The document on the canvas. Read by the rest of the app; only this module replaces it. */
export let currentDoc: { id: string | null; name: string } = { id: null, name: "" };

/* ---------- Documents: autosaved to browser storage, macOS-style ---------- */
const LAST_DOC_KEY = "vellum.lastDoc";
/** Set once the welcome drawing has been added: deleting it must not bring it back. */
const WELCOMED_KEY = "vellum.welcomed";
const docDirtyEl = byId("doc-dirty");
const docListEl = byId("doc-list");
let docsCache: DocumentMeta[] = [];
let changeSeq = 0;
let savedSeq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pointerDown = false;
let saveChain: Promise<void> = Promise.resolve();

function updateStatus(): void {
  docDirtyEl.classList.toggle("hidden", changeSeq === savedSeq);
}

export function noteChange(): void {
  changeSeq += 1;
  updateStatus();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 900);
}

/** The last storage failure shown, so one that repeats on every autosave is reported once. */
let lastStorageError = "";

function storageError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (message === lastStorageError) return;
  lastStorageError = message;
  window.alert(`Could not access browser storage: ${message}`);
}

function uniqueName(base: string): string {
  const names = new Set(docsCache.map((d) => d.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Writes the open document to storage. The deep clone keeps IndexedDB off the live state. */
function storeCurrent(): Promise<void> {
  if (!currentDoc.id) return Promise.resolve();
  return saveDocument({
    id: currentDoc.id,
    name: currentDoc.name,
    data: deepClone(serializeProject(getState())),
  });
}

async function refreshDocList(): Promise<void> {
  try {
    docsCache = await listDocuments();
  } catch (err) {
    storageError(err);
    docsCache = [];
  }
  const active = document.activeElement as HTMLInputElement | null;
  // Don't rebuild the list under a name that is being edited.
  if (active?.classList?.contains("doc-title-input")) {
    const docId = active.closest<HTMLElement>("[data-doc-id]")?.dataset.docId;
    const stored = docsCache.find((d) => d.id === docId)?.name;
    if (active.value !== stored) return;
  }
  docListEl.innerHTML = "";
  const last = docsCache.length - 1;
  for (const [i, d] of docsCache.entries()) {
    const isCurrent = d.id === currentDoc.id;
    const li = document.createElement("li");
    li.dataset.docId = d.id;
    li.className = `acc-item doc-row${isCurrent ? " current" : ""}`;
    const when = new Date(d.updated).toLocaleString([], {
      dateStyle: "short",
      timeStyle: "short",
    });
    li.title = isCurrent ? `Open since ${when}` : `Open (last saved ${when})`;
    li.innerHTML = `<div class="acc-header-row">
        ${rowDotHtml("radio", isCurrent, isCurrent ? "This is the open document" : "Open", " data-doc-open")}
        <input type="text" class="acc-title-input doc-title-input" data-doc-open value="${escapeAttr(d.name)}" maxlength="80" aria-label="Document name"${isCurrent ? "" : ' readonly tabindex="-1"'} />
        <button type="button" class="acc-icon-btn doc-act" data-doc-dup title="Duplicate" aria-label="Duplicate document">
          <svg class="ui-icon" aria-hidden="true"><use href="#icon-copy" /></svg>
        </button>
        <button type="button" class="acc-icon-btn doc-act" data-doc-save title="Export document" aria-label="Export document">
          <svg class="ui-icon" aria-hidden="true"><use href="#icon-export" /></svg>
        </button>
        <button type="button" class="acc-icon-btn acc-move" data-doc-move="-1" title="Move up the list" aria-label="Move document up"${i > 0 ? "" : " disabled"}>▲</button>
        <button type="button" class="acc-icon-btn acc-move" data-doc-move="1" title="Move down the list" aria-label="Move document down"${i < last ? "" : " disabled"}>▼</button>
        <button type="button" class="acc-icon-btn acc-trash doc-del" data-doc-delete title="Delete" aria-label="Delete document">
          <svg class="ui-icon" aria-hidden="true"><use href="#icon-trash" /></svg>
        </button>
      </div>`;
    docListEl.appendChild(li);
  }
}

function rememberLast(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_DOC_KEY, id);
    else localStorage.removeItem(LAST_DOC_KEY);
  } catch {
    /* not remembered */
  }
}

function flushSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  if (pointerDown) {
    saveTimer = setTimeout(() => void flushSave(), 400);
    return saveChain;
  }
  saveChain = saveChain.then(async () => {
    if (changeSeq === savedSeq || !currentDoc.id) return;
    const seq = changeSeq;
    try {
      await storeCurrent();
    } catch (err) {
      storageError(err);
      return;
    }
    savedSeq = seq;
    updateStatus();
    await refreshDocList();
  });
  return saveChain;
}

export function saveNow(): Promise<void> {
  noteChange();
  return flushSave();
}

function afterDocumentReplaced(): void {
  void hydrateImageDimensions(getState().images);
  clearHistory();
  invalidateLists();
  savedSeq = changeSeq;
  updateStatus();
}

/** Creates and stores a fresh, named, empty document and switches to it. */
async function createBlankDocument(): Promise<void> {
  try {
    docsCache = await listDocuments();
  } catch (err) {
    storageError(err);
  }
  replaceState(createInitialState());
  setState({ viewport: fitToView() });
  currentDoc = { id: uid("doc"), name: uniqueName("Untitled") };
  await storeNew();
}

/**
 * Creates the welcome drawing as a document and switches to it. False, with nothing stored, when
 * the drawing cannot be fetched (offline before a first load).
 */
async function createWelcomeDocument(): Promise<boolean> {
  replaceState(createInitialState());
  if (!(await loadWelcome())) return false;
  markWelcomed();
  setState({ viewport: fitToView() });
  currentDoc = { id: uid("doc"), name: uniqueName(WELCOME_NAME) };
  await storeNew();
  return true;
}

/** Stores the document just put on the canvas, at the top of the list, and makes it the open one. */
async function storeNew(): Promise<void> {
  afterDocumentReplaced();
  try {
    await saveDocument({
      id: currentDoc.id!,
      name: currentDoc.name,
      data: deepClone(serializeProject(getState())),
    });
  } catch (err) {
    storageError(err);
  }
  rememberLast(currentDoc.id);
  await refreshDocList();
}

function focusCurrentDocName(): void {
  const input = docListEl.querySelector<HTMLInputElement>(".current .doc-title-input");
  input?.scrollIntoView({ block: "nearest" });
  input?.focus();
  input?.select();
}

async function newDocument(): Promise<void> {
  await flushSave();
  setSectionOpen("documents", true);
  const st = getState();
  // If the open document is still empty there is no need for another one.
  if (!(currentDoc.id && !st.elements.length && !st.images.length)) await createBlankDocument();
  focusCurrentDocName();
}

async function openDocument(id: string): Promise<void> {
  if (id === currentDoc.id) return;
  await flushSave();
  let data: ProjectFile | null;
  try {
    data = await loadDocument(id);
  } catch (err) {
    storageError(err);
    return;
  }
  if (!data) return;
  try {
    loadProject(data);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : String(err));
    return;
  }
  currentDoc = { id, name: docsCache.find((d) => d.id === id)?.name ?? "" };
  rememberLast(id);
  afterDocumentReplaced();
  await refreshDocList();
}

async function renameCurrent(raw: string): Promise<void> {
  const name = raw.trim();
  if (!name || name === currentDoc.name || !currentDoc.id) return;
  await flushSave();
  currentDoc.name = name;
  try {
    await renameDocument(currentDoc.id, name);
  } catch (err) {
    storageError(err);
  }
}

byId("btn-new-doc").addEventListener("click", () => void newDocument());

// Inline rename of the open document's name.
docListEl.addEventListener("keydown", (e) => {
  const target = e.target as HTMLInputElement;
  if (!target.classList?.contains("doc-title-input")) return;
  if (e.key === "Enter") target.blur();
  if (e.key === "Escape") {
    target.value = currentDoc.name;
    target.blur();
  }
});
docListEl.addEventListener("change", async (e) => {
  const target = e.target as HTMLInputElement;
  if (!target.classList?.contains("doc-title-input")) return;
  if (!target.value.trim()) target.value = currentDoc.name;
  else await renameCurrent(target.value);
  await refreshDocList();
});

async function duplicateDoc(id: string): Promise<void> {
  if (id === currentDoc.id) await flushSave();
  const name = uniqueName(`${docsCache.find((d) => d.id === id)?.name ?? "Untitled"} copy`);
  try {
    await duplicateDocument(id, uid("doc"), name);
  } catch (err) {
    storageError(err);
  }
  await refreshDocList();
}

/** Empty documents are removed without asking; anything with content needs a confirmation. */
async function confirmDelete(id: string): Promise<boolean> {
  const name = docsCache.find((d) => d.id === id)?.name ?? "this document";
  let empty: boolean;
  try {
    const st = getState();
    const data =
      id === currentDoc.id ? { elements: st.elements, images: st.images } : await loadDocument(id);
    empty = !!data && !(data.elements ?? []).length && !(data.images ?? []).length;
  } catch {
    empty = false;
  }
  return empty || window.confirm(`Delete "${name}"? This cannot be undone.`);
}

/** Moves a document one place up (-1) or down (+1) the list. */
async function moveDoc(id: string, step: number): Promise<void> {
  const ids = docsCache.map((d) => d.id);
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  try {
    await reorderDocuments(ids);
  } catch (err) {
    storageError(err);
  }
  await refreshDocList();
}

async function deleteDoc(id: string): Promise<void> {
  if (!(await confirmDelete(id))) return;
  const wasCurrent = id === currentDoc.id;
  if (wasCurrent) {
    if (saveTimer) clearTimeout(saveTimer);
    savedSeq = changeSeq;
    updateStatus();
  }
  try {
    await deleteDocument(id);
  } catch (err) {
    storageError(err);
    return;
  }
  if (!wasCurrent) {
    await refreshDocList();
    return;
  }
  currentDoc = { id: null, name: "" };
  await refreshDocList();
  const first = docsCache[0];
  if (first) await openDocument(first.id);
  else await createBlankDocument();
}

docListEl.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const li = target.closest<HTMLElement>("[data-doc-id]");
  const id = li?.dataset.docId;
  if (!id) return;
  const move = target.closest<HTMLElement>("[data-doc-move]");
  if (move) await moveDoc(id, Number(move.dataset.docMove));
  else if (target.closest("[data-doc-dup]")) await duplicateDoc(id);
  else if (target.closest("[data-doc-save]")) await exportDoc(id);
  else if (target.closest("[data-doc-delete]")) await deleteDoc(id);
  else if (target.closest("[data-doc-open]") && id !== currentDoc.id) await openDocument(id);
});

/* ---------- Backup: the whole library in and out as one file ---------- */

/**
 * A document travels as a file of its own, not as a copy of the whole library. Exporting one
 * means picking it; importing one adds it beside what you already have. A library file could
 * only ever be restored wholesale, which is the wrong unit for moving a single drawing between
 * two browsers - the thing people actually do.
 */
const DOC_TAG = "vellum/document";

interface DocumentFile {
  tag: typeof DOC_TAG;
  version: 1;
  exported: string;
  name: string;
  data: ProjectFile;
}

/** A document name made safe for a file name on every operating system. */
function fileBase(name: string): string {
  return name.replace(/[^\w. -]+/g, "").trim() || "document";
}

function docFileName(name: string): string {
  return `${fileBase(name)}.vellum.json`;
}

/** What an SVG export of the open document is saved as. */
export function svgFileName(): string {
  return `${fileBase(currentDoc.name)}.svg`;
}

async function exportDoc(id: string): Promise<void> {
  if (id === currentDoc.id) await flushSave();
  let data: ProjectFile | null;
  try {
    data = await loadDocument(id);
  } catch (err) {
    storageError(err);
    return;
  }
  if (!data) return;
  const name = docsCache.find((d) => d.id === id)?.name ?? "Untitled";
  const file: DocumentFile = {
    tag: DOC_TAG,
    version: 1,
    exported: new Date().toISOString(),
    name,
    data,
  };
  downloadText(docFileName(name), JSON.stringify(file), "application/json");
}

byId("btn-doc-import").addEventListener("click", () => {
  byId<HTMLInputElement>("input-doc-file").click();
});

byId("input-doc-file").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  let parsed: DocumentFile;
  try {
    parsed = JSON.parse(await file.text()) as DocumentFile;
  } catch {
    window.alert("That file is not valid JSON.");
    return;
  }
  if (parsed?.tag !== DOC_TAG || !parsed.data) {
    window.alert("That is not a Vellum document file.");
    return;
  }
  try {
    parsed.data = readProject(parsed.data);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : String(err));
    return;
  }
  await flushSave();
  const id = uid("doc");
  try {
    docsCache = await listDocuments();
    // An imported document always gets a fresh id and a free name: it is added, never merged.
    await saveDocument({ id, name: uniqueName(parsed.name || "Untitled"), data: parsed.data });
    docsCache = await listDocuments();
  } catch (err) {
    storageError(err);
    return;
  }
  setSectionOpen("documents", true);
  await openDocument(id);
  await refreshDocList();
});

// Anything that changes the document schedules an autosave; saves wait until the pointer is up.
setHistoryListener(noteChange);
window.addEventListener("pointerdown", () => (pointerDown = true), true);
window.addEventListener(
  "pointerup",
  () => {
    pointerDown = false;
    if (changeSeq !== savedSeq) noteChange();
  },
  true
);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flushSave();
});
window.addEventListener("beforeunload", (e) => {
  if (changeSeq !== savedSeq) {
    void flushSave();
    e.preventDefault();
  }
});

/** True until the drawing has been added once: an empty library on a later visit gets an empty document. */
function firstVisit(): boolean {
  if (libraryReset) return true;
  try {
    return !localStorage.getItem(WELCOMED_KEY);
  } catch {
    return true;
  }
}

function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOMED_KEY, "1");
  } catch {
    /* no storage: the drawing is offered again next time, which beats never */
  }
}

/** Opens the last document (or a blank one) and starts the service worker. Call once, last. */
export function startDocuments(): void {
  void openInitialDocument();
  registerServiceWorker();
}

async function openInitialDocument(): Promise<void> {
  await refreshDocList();
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_DOC_KEY);
  } catch {
    last = null;
  }
  if (!docsCache.length && firstVisit()) await createWelcomeDocument();
  const first = docsCache[0];
  if (last && docsCache.some((d) => d.id === last)) await openDocument(last);
  else if (!currentDoc.id && first) await openDocument(first.id);
  else if (!currentDoc.id) await createBlankDocument();
  // The view the tab was last showing, but only for the document it was showing it of.
  if (savedView.viewport && savedView.docId === currentDoc.id) {
    setState({ viewport: savedView.viewport });
  }
}
