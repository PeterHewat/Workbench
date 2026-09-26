import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { BACKDROP_NAME, DEMOS, demoDocument, demosToAdd } from "./demos.js";
import { cleanTags } from "./doc-list.js";
import { formatExportSvg, importSvgFile, readProject } from "./io.js";

const dir = new URL("../../public/demos/", import.meta.url);
const read = (file: string) => Bun.file(new URL(file, dir)).text();

describe("the demos", () => {
  test("every file is listed, and every listed file is there", () => {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".svg"))
      .sort();
    expect(DEMOS.map((d) => d.file).sort()).toEqual(files);
  });

  test("names are distinct, and tags are as if typed", () => {
    expect(new Set(DEMOS.map((d) => d.name)).size).toBe(DEMOS.length);
    for (const d of DEMOS) expect(cleanTags(d.tags)).toEqual(d.tags);
  });

  for (const demo of DEMOS) {
    describe(demo.name, () => {
      test("is already in Vellum's own format: exporting it gives the file back", async () => {
        const svg = await read(demo.file);
        const back = importSvgFile(svg, { keepIds: true });
        const again = formatExportSvg(
          {
            artboard: back.artboard!,
            background: back.background,
            elements: back.elements,
            groupNames: back.groupNames,
          },
          true
        );
        expect(again + "\n").toBe(svg);
      });

      test("becomes a document that opens, its backdrop first and locked", async () => {
        const doc = readProject(demoDocument(await read(demo.file)));
        expect(doc.elements.length).toBeGreaterThan(5);
        expect(doc.elements[0]!.name).toBe(BACKDROP_NAME);
        expect(doc.elements[0]!.locked).toBe(true);
        expect(doc.elements.filter((e) => e.locked)).toHaveLength(1);
      });
    });
  }

  test("a browser is given only the demos it has not had", () => {
    expect(demosToAdd([])).toEqual([...DEMOS]);
    expect(demosToAdd(DEMOS.map((d) => d.file))).toEqual([]);
    expect(demosToAdd([DEMOS[0]!.file]).map((d) => d.file)).not.toContain(DEMOS[0]!.file);
  });
});
