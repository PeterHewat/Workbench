/**
 * Documents as files, for moving them between browsers.
 *
 * A file holds one document, or every document of a library. Either kind imports the same way:
 * each document in it is added beside the ones already there, with a fresh id and a free name,
 * so an import never replaces or merges with anything.
 */

import { readProject } from "./io.js";
import type { ProjectFile } from "./types.js";

const DOC_TAG = "vellum/document";
const LIBRARY_TAG = "vellum/library";

/** One document, as `Name.vellum.json`. */
export interface DocumentFile {
  tag: typeof DOC_TAG;
  version: 1;
  exported: string;
  name: string;
  data: ProjectFile;
}

/** Every document, in list order. */
export interface LibraryFile {
  tag: typeof LIBRARY_TAG;
  version: 1;
  exported: string;
  documents: { name: string; data: ProjectFile }[];
}

/** A document read from a file, ready to store. */
export interface ImportedDocument {
  name: string;
  data: ProjectFile;
}

export function documentFile(name: string, data: ProjectFile, now = new Date()): DocumentFile {
  return { tag: DOC_TAG, version: 1, exported: now.toISOString(), name, data };
}

export function libraryFile(documents: readonly ImportedDocument[], now = new Date()): LibraryFile {
  return {
    tag: LIBRARY_TAG,
    version: 1,
    exported: now.toISOString(),
    documents: documents.map(({ name, data }) => ({ name, data })),
  };
}

/** A document name made safe for a file name on every operating system. */
export function fileBase(name: string): string {
  return name.replace(/[^\w. -]+/g, "").trim() || "document";
}

export function documentFileName(name: string): string {
  return `${fileBase(name)}.vellum.json`;
}

export function libraryFileName(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `Vellum library ${day}.vellum.json`;
}

/**
 * The documents in a file's text, each brought up to the current format. Throws, with a message
 * worth showing, when the file is not one of ours or a document in it cannot be read.
 */
export function readDocumentFile(text: string): ImportedDocument[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("It is not valid JSON.");
  }
  const file = (parsed ?? {}) as Partial<DocumentFile> & Partial<LibraryFile>;
  const entries =
    file.tag === DOC_TAG && file.data
      ? [{ name: file.name, data: file.data }]
      : file.tag === LIBRARY_TAG && Array.isArray(file.documents)
        ? file.documents
        : null;
  if (!entries) throw new Error("It is not a Vellum document file.");
  return entries.map((entry) => ({
    name: typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : "Untitled",
    data: readProject(entry?.data),
  }));
}
