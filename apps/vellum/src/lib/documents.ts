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
  setDocumentTags,
  libraryReset,
  type DocumentMeta,
} from "./storage.js";
import { serializeProject, loadProject } from "./io.js";
import {
  documentFile,
  documentFileName,
  fileBase,
  libraryFile,
  libraryFileName,
  readDocumentFile,
  type ImportedDocument,
} from "./document-files.js";
import { deepClone, escapeAttr, uid } from "./utils.js";
import { byId, downloadText, registerServiceWorker } from "@workbench/ui";
import { type ProjectFile } from "./types.js";
import { savedView } from "./session.js";
import { setSectionOpen } from "./layout.js";
import { fitToView } from "./zoom.js";
import { invalidateLists, rowDotHtml } from "./accordion.js";
import { hydrateImageDimensions } from "./images-panel.js";
import { WELCOME_NAME, loadWelcome } from "./welcome.js";
import { cleanTags, docStats, matchesSearch, statsText } from "./doc-list.js";

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
  // Don't rebuild the list under a name or tags being edited.
  const editing = active?.closest<HTMLElement>("#doc-list [data-doc-id]")?.dataset.docId;
  if (editing) {
    const stored = docsCache.find((d) => d.id === editing);
    if (active!.classList.contains("doc-title-input") && active!.value !== stored?.name) return;
    if (
      active!.classList.contains("doc-tags-input") &&
      cleanTags(active!.value).join(", ") !== (stored?.tags ?? []).join(", ")
    ) {
      return;
    }
  }
  docListEl.innerHTML = "";
  const last = docsCache.length - 1;
  for (const [i, d] of docsCache.entries()) {
    const isCurrent = d.id === currentDoc.id;
    const li = document.createElement("li");
    li.dataset.docId = d.id;
    const open = expandedDocs.has(d.id);
    li.className = `acc-item doc-row${isCurrent ? " current" : ""}${open ? " expanded" : ""}`;
    const when = new Date(d.updated).toLocaleString([], {
      dateStyle: "short",
      timeStyle: "short",
    });
    li.title = isCurrent ? `Open since ${when}` : `Open (last saved ${when})`;
    li.innerHTML = `<div class="acc-header-row">
        <button type="button" class="acc-expand-btn" data-doc-expand aria-expanded="${open}" aria-label="Tags and details" title="Tags and details">
          <span class="chevron" aria-hidden="true">▶</span>
        </button>
        ${rowDotHtml("radio", isCurrent, isCurrent ? "This is the open document" : "Open")}
        <input type="text" class="acc-title-input doc-title-input" value="${escapeAttr(d.name)}" maxlength="80" aria-label="Document name"${isCurrent ? "" : ' readonly tabindex="-1"'} />
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
      </div>
      <div class="acc-body doc-body">
        <label class="field-row field-row--wide"><span>Tags</span><input type="text" class="doc-tags-input" value="${escapeAttr((d.tags ?? []).join(", "))}" placeholder="icons, arrows" aria-label="Tags, separated by commas" /></label>
        <p class="doc-stats"></p>
      </div>`;
    docListEl.appendChild(li);
    if (open) void fillStats(li, d);
  }
  applyDocSearch();
}

/**
 * Documents showing their tags and details. Where you are, not part of any document: kept for
 * the session only.
 */
const expandedDocs = new Set<string>();

/** Stats of stored documents, kept while the document is unchanged: reading one loads it whole. */
const statsCache = new Map<string, { updated: number; text: string }>();

async function fillStats(li: HTMLElement, d: DocumentMeta): Promise<void> {
  const out = li.querySelector<HTMLElement>(".doc-stats");
  if (!out) return;
  const when = new Date(d.updated).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  let text: string;
  if (d.id === currentDoc.id) {
    text = statsText(docStats(getState()));
  } else {
    const cached = statsCache.get(d.id);
    if (cached?.updated === d.updated) {
      text = cached.text;
    } else {
      let data: ProjectFile | null;
      try {
        data = await loadDocument(d.id);
      } catch {
        data = null;
      }
      text = statsText(docStats(data));
      statsCache.set(d.id, { updated: d.updated, text });
    }
  }
  out.textContent = `${text} · saved ${when}`;
}

/* ---------- Search: names and tags ---------- */

const docSearchBtn = byId("btn-doc-search");
const docSearchRow = byId("doc-search-row");
const docSearchInput = byId<HTMLInputElement>("doc-search");
const docNoMatch = byId("doc-no-match");

/**
 * Shows only the documents matching the search. ▲ and ▼ step through the whole list, so they
 * rest while it is filtered: a step past a hidden document would look like nothing happened.
 */
function applyDocSearch(): void {
  const query = docSearchRow.classList.contains("hidden") ? "" : docSearchInput.value.trim();
  let shown = 0;
  for (const li of docListEl.querySelectorAll<HTMLElement>("[data-doc-id]")) {
    const d = docsCache.find((m) => m.id === li.dataset.docId);
    const match = !d || matchesSearch(d, query);
    li.hidden = !match;
    if (match) shown++;
    li.querySelectorAll<HTMLButtonElement>("[data-doc-move]").forEach((b) => {
      if (query) b.disabled = true;
    });
  }
  docNoMatch.hidden = !query || shown > 0;
}

function setDocSearch(open: boolean): void {
  docSearchRow.classList.toggle("hidden", !open);
  docSearchBtn.classList.toggle("active", open);
  docSearchBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    setSectionOpen("documents", true);
    docSearchInput.focus();
    docSearchInput.select();
  } else {
    docSearchInput.value = "";
  }
  // Leaving the search gives ▲ and ▼ back, which only a rebuild works out.
  void refreshDocList();
}

docSearchBtn.addEventListener("click", () =>
  setDocSearch(docSearchRow.classList.contains("hidden"))
);
docSearchInput.addEventListener("input", applyDocSearch);
docSearchInput.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  if (docSearchInput.value) {
    docSearchInput.value = "";
    applyDocSearch();
  } else {
    setDocSearch(false);
    docSearchBtn.focus();
  }
});

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
docListEl.addEventListener("keydown", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.classList?.contains("doc-tags-input") && e.key === "Enter") target.blur();
});
docListEl.addEventListener("change", async (e) => {
  const target = e.target as HTMLInputElement;
  const id = target.closest<HTMLElement>("[data-doc-id]")?.dataset.docId;
  if (id && target.classList?.contains("doc-tags-input")) {
    const tags = cleanTags(target.value);
    target.value = tags.join(", ");
    try {
      await setDocumentTags(id, tags);
    } catch (err) {
      storageError(err);
    }
    await refreshDocList();
    return;
  }
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
  if (target.closest("[data-doc-expand]")) {
    if (!expandedDocs.delete(id)) expandedDocs.add(id);
    await refreshDocList();
    return;
  }
  // The details under a row are for reading and typing tags, not a way to open the document.
  if (!target.closest(".acc-header-row")) return;
  const move = target.closest<HTMLElement>("[data-doc-move]");
  if (move) await moveDoc(id, Number(move.dataset.docMove));
  else if (target.closest("[data-doc-dup]")) await duplicateDoc(id);
  else if (target.closest("[data-doc-save]")) await exportDoc(id);
  else if (target.closest("[data-doc-delete]")) await deleteDoc(id);
  // Anywhere else on another document's row opens it: the dot is not the only way in.
  else if (id !== currentDoc.id) await openDocument(id);
});

/* ---------- Files: one document, or all of them, in and out ---------- */

/** What an SVG export of the open document is saved as. */
export function svgFileName(): string {
  return `${fileBase(currentDoc.name)}.svg`;
}

/** A stored document's data, or null (with the error shown) when storage fails. */
async function storedData(id: string): Promise<ProjectFile | null> {
  try {
    return await loadDocument(id);
  } catch (err) {
    storageError(err);
    return null;
  }
}

async function exportDoc(id: string): Promise<void> {
  if (id === currentDoc.id) await flushSave();
  const data = await storedData(id);
  if (!data) return;
  const meta = docsCache.find((d) => d.id === id);
  const name = meta?.name ?? "Untitled";
  downloadText(
    documentFileName(name),
    JSON.stringify(documentFile({ name, tags: meta?.tags, data })),
    "application/json"
  );
}

/** Every document in one file, in list order: a backup, or a whole library to move. */
async function exportAll(): Promise<void> {
  await flushSave();
  const documents: ImportedDocument[] = [];
  for (const d of docsCache) {
    const data = await storedData(d.id);
    if (!data) return;
    documents.push({ name: d.name, tags: d.tags, data });
  }
  if (!documents.length) return;
  downloadText(libraryFileName(), JSON.stringify(libraryFile(documents)), "application/json");
}

byId("btn-doc-export-all").addEventListener("click", () => void exportAll());

byId("btn-doc-import").addEventListener("click", () => {
  byId<HTMLInputElement>("input-doc-file").click();
});

/**
 * Adds every document in the chosen files - single documents and whole libraries alike - beside
 * the ones already here, each with a fresh id and a free name, then opens the first of them.
 */
byId("input-doc-file").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (!files.length) return;
  const incoming: ImportedDocument[] = [];
  const problems: string[] = [];
  for (const file of files) {
    try {
      incoming.push(...readDocumentFile(await file.text()));
    } catch (err) {
      problems.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (incoming.length) await addDocuments(incoming);
  if (problems.length) window.alert(`Could not import:\n${problems.join("\n")}`);
});

async function addDocuments(incoming: readonly ImportedDocument[]): Promise<void> {
  await flushSave();
  let firstId: string | null = null;
  try {
    docsCache = await listDocuments();
    // A new document goes on top of the list, so the last one stored ends up first: stored
    // backwards, a library comes back in its own order.
    for (const doc of [...incoming].reverse()) {
      const id = uid("doc");
      // Named against everything stored so far, this import's other documents included.
      await saveDocument({ id, name: uniqueName(doc.name), tags: doc.tags, data: doc.data });
      docsCache = await listDocuments();
      firstId = id;
    }
  } catch (err) {
    storageError(err);
  }
  if (!firstId) return;
  setSectionOpen("documents", true);
  await openDocument(firstId);
  await refreshDocList();
}

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
