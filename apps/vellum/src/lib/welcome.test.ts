import { describe, expect, test } from "bun:test";
import { formatExportSvg, importSvgFile } from "./io.js";

const ART = await Bun.file(new URL("../../public/art.svg", import.meta.url)).text();

describe("the welcome drawing", () => {
  const imported = importSvgFile(ART);

  test("imports whole, on its own artboard", () => {
    expect(imported.artboard).toEqual({ width: 512, height: 320 });
    expect(imported.elements.length).toBeGreaterThan(30);
  });

  test("reads like a layers list: every part of the desk is a named group", () => {
    expect(Object.values(imported.groupNames).sort()).toEqual([
      "desk",
      "laptop",
      "mug",
      "pencil",
      "plant",
      "ruler",
    ]);
  });

  test("shows off what it is there to show", () => {
    const types = new Set(imported.elements.map((e) => e.type));
    for (const t of ["polygon", "path", "ellipse", "rect"] as const) expect(types).toContain(t);
    expect(imported.elements.some((e) => e.fillEnabled && e.fillType === "linear")).toBe(true);
    expect(imported.elements.some((e) => e.type === "ellipse" && e.rotation)).toBe(true);
  });

  test("its backdrop is translucent, so it sits on a light page and a dark one", () => {
    const backdrop = imported.elements.find((e) => e.name === "backdrop");
    expect(backdrop?.gradStops.every((s) => s.opacity < 0.5)).toBe(true);
  });

  test("is already in Vellum's own format: exporting it gives the file back", () => {
    const back = importSvgFile(ART, { keepIds: true });
    const again = formatExportSvg(
      {
        artboard: back.artboard!,
        background: back.background,
        elements: back.elements,
        groupNames: back.groupNames,
      },
      true
    );
    expect(`${again}\n`).toBe(ART);
  });
});
