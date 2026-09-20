import { describe, expect, test } from "bun:test";
import {
  elementIdFromSvgId,
  elementToSvgMarkup,
  formatExportSvg,
  importSvgFile,
  sanitizeName,
  serializeProject,
} from "./io.js";
import {
  createCircle,
  createEllipse,
  createLine,
  createPath,
  createPolygon,
  createPolyline,
  createRect,
  createText,
} from "./model.js";
import { createInitialState } from "./state.js";
import type { Anchor, SceneElement } from "./types.js";

const anchor = (x: number, y: number, hIn: Anchor["hIn"] = null, hOut: Anchor["hOut"] = null) =>
  ({ x, y, smooth: !!(hIn || hOut), hIn, hOut }) as Anchor;

/** One of every supported element, including the awkward styling cases. */
function sampleElements(): SceneElement[] {
  return [
    createRect(10.4, 20.6, 100, 50),
    Object.assign(createRect(0, 0, 80, 40), { rx: 8 }),
    Object.assign(createRect(0, 0, 80, 40), { rx: 8, ry: 4 }),
    createCircle(5, 5, 3),
    createEllipse(5, 5, 3, 2),
    createLine(0, 0, 10, 10),
    createPolyline([
      { x: 0, y: 0 },
      { x: 1.6, y: 2.4 },
    ]),
    createPolygon([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 3, y: 0 },
    ]),
    createText(4, 9, 'a & b <c> "d"'),
    Object.assign(createLine(0, 0, 5, 5), { strokeWidth: 0 }),
    Object.assign(createRect(0, 0, 9, 9), {
      fillEnabled: true,
      fill: "#ff0000",
      fillOpacity: 0.5,
      strokeOpacity: 0.25,
    }),
    Object.assign(createRect(0, 0, 9, 9), {
      fillEnabled: true,
      fillType: "linear" as const,
      gradAngle: 90,
    }),
    Object.assign(createRect(0, 0, 9, 9), {
      fillEnabled: true,
      fillType: "radial" as const,
    }),
    Object.assign(createLine(0, 0, 9, 9), { markerEnd: "arrow" as const }),
    Object.assign(createPath([anchor(0, 0, null, { x: 0, y: 50 }), anchor(100, 0)], false), {
      name: "curve",
    }),
  ];
}

function doc(elements: SceneElement[]) {
  return { artboard: { width: 1000, height: 1000 }, elements };
}

describe("export markup", () => {
  test("coordinates are rounded but style values are not", () => {
    const markup = elementToSvgMarkup(
      Object.assign(createRect(10.4, 20.6, 100, 50), { strokeWidth: 1.5 }),
      "ID"
    );
    expect(markup).toContain('x="10"');
    expect(markup).toContain('y="21"');
    expect(markup).toContain('stroke-width="1.5"');
  });

  test("the id is the first attribute so the editor can find it", () => {
    expect(elementToSvgMarkup(createRect(0, 0, 1, 1), "ID").startsWith('<rect id="ID"')).toBe(true);
  });

  test("text content and attributes are escaped", () => {
    const markup = elementToSvgMarkup(createText(0, 0, "a & b <c>"), "ID");
    expect(markup).toContain("a &amp; b &lt;c&gt;");
    expect(markup).not.toMatch(/>a & b/);
  });

  test("an unknown element yields nothing rather than broken markup", () => {
    expect(elementToSvgMarkup({ type: "spline" } as unknown as SceneElement)).toBe("");
  });
});

describe("export document", () => {
  test("the root carries the artboard as viewBox and size", () => {
    const svg = formatExportSvg(doc([]), true);
    expect(svg).toContain('viewBox="0 0 1000 1000"');
    expect(svg).toContain('width="1000"');
  });

  test("grouped elements are wrapped in one <g> carrying the group id", () => {
    const a = Object.assign(createRect(0, 0, 1, 1), { groups: ["group-abc"] });
    const b = Object.assign(createRect(2, 2, 1, 1), { groups: ["group-abc"] });
    const svg = formatExportSvg(doc([a, b]), true);
    expect(svg.match(/<g id="group-abc">/g)).toHaveLength(1);
    expect(svg.match(/<\/g>/g)).toHaveLength(1);
  });

  test("gradients and markers are emitted into defs", () => {
    const grad = Object.assign(createRect(0, 0, 9, 9), {
      fillEnabled: true,
      fillType: "linear" as const,
    });
    const svg = formatExportSvg(doc([grad]), true);
    expect(svg).toContain("<defs>");
    expect(svg).toContain(`<linearGradient id="grad-${grad.id}"`);
  });

  test("no defs block is emitted when nothing needs one", () => {
    expect(formatExportSvg(doc([createRect(0, 0, 1, 1)]), true)).not.toContain("<defs>");
  });

  test("a custom name rides along in the exported id", () => {
    const el = Object.assign(createRect(0, 0, 1, 1), { name: "my shape" });
    expect(formatExportSvg(doc([el]), true)).toContain(`id="${el.id}_my_shape"`);
  });
});

describe("round trip", () => {
  // The live SVG editor re-imports its own output on every keystroke pause, so any instability
  // here would make shapes drift or duplicate as the user types.
  test("export -> import -> export is byte-for-byte stable", () => {
    const first = formatExportSvg(doc(sampleElements()), true);
    const back = importSvgFile(first, { keepIds: true });
    const second = formatExportSvg(
      { artboard: back.artboard ?? { width: 1000, height: 1000 }, elements: back.elements },
      true
    );
    expect(second).toBe(first);
  });

  test("keepIds preserves every element id", () => {
    const elements = sampleElements();
    const back = importSvgFile(formatExportSvg(doc(elements), true), { keepIds: true });
    expect(back.elements.map((e) => e.id).sort()).toEqual(elements.map((e) => e.id).sort());
  });

  test("without keepIds every element gets a fresh id", () => {
    const elements = sampleElements();
    const back = importSvgFile(formatExportSvg(doc(elements), true));
    const original = new Set(elements.map((e) => e.id));
    expect(back.elements.every((e) => !original.has(e.id))).toBe(true);
  });

  test("custom names survive the trip, with spaces carried as underscores", () => {
    // An id cannot hold a space, so a name round-tripped through a file comes back underscored.
    // In the live SVG editor the original element is kept whenever its markup is unchanged,
    // so the spaced name survives there; this is the file round trip.
    const el = Object.assign(createRect(0, 0, 10, 10), { name: "my shape" });
    const back = importSvgFile(formatExportSvg(doc([el]), true), { keepIds: true });
    expect(back.elements[0]!.name).toBe("my_shape");
  });

  test("a name without spaces round-trips exactly", () => {
    const el = Object.assign(createRect(0, 0, 10, 10), { name: "outline" });
    const back = importSvgFile(formatExportSvg(doc([el]), true), { keepIds: true });
    expect(back.elements[0]!.name).toBe("outline");
  });

  test("groups survive the trip", () => {
    const a = Object.assign(createRect(0, 0, 1, 1), { groups: ["group-abc"] });
    const b = Object.assign(createRect(2, 2, 1, 1), { groups: ["group-abc"] });
    const back = importSvgFile(formatExportSvg(doc([a, b]), true), { keepIds: true });
    expect(back.elements[0]!.groups).toEqual(["group-abc"]);
    expect(back.elements[1]!.groups).toEqual(["group-abc"]);
  });
});

describe("import", () => {
  test("invalid markup throws rather than silently dropping content", () => {
    expect(() => importSvgFile("<svg><rect width=")).toThrow();
  });

  test("markup with no svg root throws", () => {
    expect(() => importSvgFile("<html><body>hi</body></html>")).toThrow();
  });

  test("the viewBox becomes the artboard", () => {
    const r = importSvgFile('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"/>');
    expect(r.artboard).toEqual({ width: 640, height: 480 });
  });

  test("width and height are the fallback when there is no viewBox", () => {
    const r = importSvgFile('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>');
    expect(r.artboard).toEqual({ width: 320, height: 200 });
  });

  test("elements inside defs are skipped", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><rect width="5" height="5"/></defs><circle cx="1" cy="1" r="1"/></svg>'
    );
    expect(r.elements).toHaveLength(1);
    expect(r.elements[0]!.type).toBe("circle");
  });

  test("unsupported tags are dropped", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/><rect width="5" height="5"/></svg>'
    );
    expect(r.elements).toHaveLength(1);
  });

  test("an element with no fill attribute and no stroke imports with fill on", () => {
    // SVG's own default is a black fill, which is the only thing such a shape paints.
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>'
    );
    expect(r.elements[0]!.fillEnabled).toBe(true);
  });

  test("an explicitly stroked shape with fill=none imports with fill off", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" stroke="#000" fill="none"/></svg>'
    );
    expect(r.elements[0]!.fillEnabled).toBe(false);
  });

  test("rgb() and #rgb shorthand normalise to #rrggbb", () => {
    // Named colours go through the browser's own parser, so they are not asserted here.
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" stroke="#0f0" fill="rgb(0, 0, 255)"/></svg>'
    );
    expect(r.elements[0]!.stroke).toBe("#00ff00");
    expect(r.elements[0]!.fill).toBe("#0000ff");
  });

  test("an unparseable colour falls back to black rather than throwing", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" stroke="not-a-colour"/></svg>'
    );
    expect(r.elements[0]!.stroke).toBe("#000000");
  });

  test("presentation attributes inherit from an ancestor group", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><g stroke="#00ff00" stroke-width="4"><rect width="5" height="5"/><rect width="6" height="6"/></g></svg>'
    );
    expect(r.elements[0]!.stroke).toBe("#00ff00");
    expect(r.elements[0]!.strokeWidth).toBe(4);
  });

  test("style properties beat attributes on the same node", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" stroke="#ff0000" style="stroke:#0000ff"/></svg>'
    );
    expect(r.elements[0]!.stroke).toBe("#0000ff");
  });

  test("a group of one is not worth keeping", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="group-x"><rect width="5" height="5"/></g></svg>'
    );
    expect(r.elements[0]!.groups).toBeUndefined();
  });

  test("a <title> names the shape", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"><title>hello</title></rect></svg>'
    );
    expect(r.elements[0]!.name).toBe("hello");
  });

  test("relative and absolute path commands agree", () => {
    const abs = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 10 10 L 20 10 L 20 20"/></svg>'
    );
    const rel = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="m 10 10 l 10 0 l 0 10"/></svg>'
    );
    const pts = (r: typeof abs) =>
      (r.elements[0] as { points: { x: number; y: number }[] }).points.map((p) => [p.x, p.y]);
    expect(pts(rel)).toEqual(pts(abs));
  });

  test("H and V commands are understood", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 H 10 V 10"/></svg>'
    );
    expect(
      (r.elements[0] as { points: { x: number; y: number }[] }).points.map((p) => [p.x, p.y])
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });
});

describe("ids and names", () => {
  test("a name is sanitised into an id-safe form", () => {
    expect(sanitizeName("  my shape!  ")).toBe("my_shape");
    expect(sanitizeName("a/b\\c")).toBe("abc");
    expect(sanitizeName(undefined)).toBe("");
  });

  test("only the first underscore separates the generated id from the name", () => {
    expect(elementIdFromSvgId("a1b2c3d4_my_shape")).toBe("a1b2c3d4");
  });

  test("a bare generated id has no name half", () => {
    expect(elementIdFromSvgId("a1b2c3d4")).toBe("a1b2c3d4");
  });

  test("a foreign id is not mistaken for ours", () => {
    expect(elementIdFromSvgId("someone-elses-id")).toBeNull();
  });
});

describe("project file", () => {
  test("the serialized shape is exactly the documented set of keys", () => {
    expect(Object.keys(serializeProject(createInitialState())).sort()).toEqual([
      "artboard",
      "elements",
      "finalOnly",
      "grid",
      "images",
      "tool",
      "version",
      "viewport",
    ]);
  });

  test("style defaults are not stored: each element carries its own", () => {
    expect(serializeProject(createInitialState())).not.toHaveProperty("defaults");
  });
});

describe("groups and transforms on import", () => {
  test("nested groups become a chain, outermost first", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="group-out"><g id="group-in">' +
        '<rect width="5" height="5"/><rect x="9" width="5" height="5"/>' +
        "</g></g></svg>",
      { keepIds: true }
    );
    expect(r.elements[0]!.groups).toEqual(["group-out", "group-in"]);
  });

  test("nested groups survive a round trip", () => {
    const a = Object.assign(createRect(0, 0, 1, 1), { groups: ["group-out", "group-in"] });
    const b = Object.assign(createRect(2, 2, 1, 1), { groups: ["group-out", "group-in"] });
    const svg = formatExportSvg(doc([a, b]), true);
    expect(svg.match(/<g id="group-out">/g)).toHaveLength(1);
    expect(svg.match(/<g id="group-in">/g)).toHaveLength(1);
    const back = importSvgFile(svg, { keepIds: true });
    expect(back.elements[1]!.groups).toEqual(["group-out", "group-in"]);
  });

  test("a group transform is baked into the coordinates", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(10 20)">' +
        '<rect width="5" height="5"/><rect x="9" width="5" height="5"/></g></svg>'
    );
    expect(r.elements[0]).toMatchObject({ type: "rect", x: 10, y: 20 });
    expect(r.elements[1]).toMatchObject({ type: "rect", x: 19, y: 20 });
  });

  test("an element's own transform is baked in too", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4" transform="scale(3)"/></svg>'
    );
    expect(r.elements[0]).toMatchObject({ type: "rect", width: 12, height: 12 });
  });

  test("one group split across two <g> is gathered back into one", () => {
    // Editing the SVG text by hand can leave the same group id on two separate <g> elements.
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<g id="group-a"><rect id="r1" width="1" height="1"/></g>' +
        '<rect id="r2" width="1" height="1"/>' +
        '<g id="group-a"><rect id="r3" width="1" height="1"/></g>' +
        "</svg>",
      { keepIds: true }
    );
    expect(r.elements.map((e) => e.name)).toEqual(["r1", "r3", "r2"]);
    expect(formatExportSvg(doc(r.elements), true).match(/<g id="group-a">/g)).toHaveLength(1);
  });
});

describe("uniform shapes", () => {
  test("an ellipse with equal radii exports as a circle and comes back as one", () => {
    const e = createEllipse(50, 50, 20, 20);
    const svg = formatExportSvg(doc([e]), true);
    expect(svg).toContain("<circle id=");
    expect(svg).toContain('r="20"');
    const back = importSvgFile(svg);
    expect(back.elements[0]!.type).toBe("circle");
  });

  test("export stays byte-for-byte stable across that round trip", () => {
    const first = formatExportSvg(doc([createEllipse(50, 50, 20, 20)]), true);
    const back = importSvgFile(first, { keepIds: true });
    expect(formatExportSvg({ artboard: doc([]).artboard, elements: back.elements }, true)).toBe(
      first
    );
  });
});
