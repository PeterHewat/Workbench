import { describe, expect, test } from "bun:test";
import {
  documentFile,
  documentFileName,
  libraryFile,
  libraryFileName,
  readDocumentFile,
} from "./document-files.js";
import { serializeProject } from "./io.js";
import { createInitialState } from "./state.js";

const data = serializeProject(createInitialState());

describe("document files", () => {
  test("a single document reads back as one", () => {
    const text = JSON.stringify(documentFile("Logo", data));
    expect(readDocumentFile(text)).toEqual([{ name: "Logo", data }]);
  });

  test("a library reads back as all of its documents, in order", () => {
    const text = JSON.stringify(
      libraryFile([
        { name: "One", data },
        { name: "Two", data },
      ])
    );
    expect(readDocumentFile(text).map((d) => d.name)).toEqual(["One", "Two"]);
  });

  test("a document without a name is still imported, as Untitled", () => {
    const text = JSON.stringify({ ...documentFile("x", data), name: " " });
    expect(readDocumentFile(text)[0]!.name).toBe("Untitled");
  });

  test("anything else is refused with a reason", () => {
    expect(() => readDocumentFile("not json")).toThrow("not valid JSON");
    expect(() => readDocumentFile(JSON.stringify({ tag: "other" }))).toThrow("not a Vellum");
    const newer = JSON.stringify(
      documentFile("x", { ...data, version: 99 as typeof data.version })
    );
    expect(() => readDocumentFile(newer)).toThrow("newer Vellum");
  });

  test("file names are safe everywhere", () => {
    expect(documentFileName('a/b:c*"d')).toBe("abcd.vellum.json");
    expect(libraryFileName(new Date("2026-09-26T10:00:00Z"))).toBe(
      "Vellum library 2026-09-26.vellum.json"
    );
  });
});
