import { describe, expect, test } from "bun:test";
import {
  elementIdFromSvgId,
  elementToSvgMarkup,
  formatExportSvg,
  groupIdFromSvgId,
  importSvgFile,
  sanitizeName,
  isInert,
  readProject,
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
import { PROJECT_VERSION, type Anchor, type SceneElement } from "./types.js";

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
      gradFrom: { x: 0.5, y: 0 },
      gradTo: { x: 0.5, y: 1 },
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

const OPAQUE_BLUE = { color: "#3355ff", opacity: 1 };

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

describe("background", () => {
  test("a transparent document exports no background rect at all", () => {
    const svg = formatExportSvg({ ...doc([]), background: { color: "#ffffff", opacity: 0 } }, true);
    expect(svg).not.toContain('id="background"');
  });

  test("a chosen colour is the first thing in the file, at the artboard size", () => {
    const shape = createRect(0, 0, 9, 9);
    const svg = formatExportSvg({ ...doc([shape]), background: OPAQUE_BLUE }, true);
    expect(svg).toContain('<rect id="background" width="1000" height="1000" fill="#3355ff"/>');
    expect(svg.indexOf('id="background"')).toBeLessThan(svg.indexOf(shape.id));
  });

  test("a partly transparent background carries its alpha", () => {
    const svg = formatExportSvg(
      { ...doc([]), background: { color: "#000000", opacity: 0.5 } },
      true
    );
    expect(svg).toContain('fill="#000000" fill-opacity="0.5"');
  });

  test("the background comes back on import, and is not mistaken for a shape", () => {
    const svg = formatExportSvg(
      { ...doc([createRect(0, 0, 9, 9)]), background: OPAQUE_BLUE },
      true
    );
    const back = importSvgFile(svg, { keepIds: true });
    expect(back.background).toEqual(OPAQUE_BLUE);
    expect(back.elements).toHaveLength(1);
  });

  test("a file without one imports as no background", () => {
    expect(importSvgFile(formatExportSvg(doc([]), true)).background).toBeNull();
  });

  test("export -> import -> export is stable with a background", () => {
    const first = formatExportSvg({ ...doc(sampleElements()), background: OPAQUE_BLUE }, true);
    const back = importSvgFile(first, { keepIds: true });
    const second = formatExportSvg(
      {
        artboard: back.artboard ?? { width: 1000, height: 1000 },
        background: back.background,
        elements: back.elements,
      },
      true
    );
    expect(second).toBe(first);
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

  test("a closed two-point path comes back closed, and stable", () => {
    const lens = createPath(
      [
        { x: 0, y: 0, smooth: false, hIn: null, hOut: null },
        { x: 30, y: 0, smooth: false, hIn: null, hOut: null },
      ],
      true
    );
    const first = formatExportSvg(doc([lens]), true);
    const back = importSvgFile(first, { keepIds: true });
    const el = back.elements[0]!;
    expect(el.type === "path" && el.closed).toBe(true);
    const second = formatExportSvg({ artboard: back.artboard!, elements: back.elements }, true);
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

  test("a closed path of two curved anchors keeps both curves (a heart)", () => {
    // Dragging one end of a three-anchor curve onto the other leaves two anchors and two
    // curves; the curve back to the start must be drawn, and must survive the trip.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<path d="M 176 224 C 128 160 112 256 160 288 C 208 256 224 160 176 224 Z"/></svg>';
    const [heart] = importSvgFile(svg).elements;
    expect(heart?.type === "path" && heart.points).toHaveLength(2);
    const first = formatExportSvg(doc([heart!]), true);
    expect(first.match(/ C /g)).toHaveLength(2);
    const back = importSvgFile(first, { keepIds: true });
    expect(formatExportSvg(doc(back.elements), true)).toBe(first);
  });

  test("a closing curve does not come back as an extra anchor on top of the first", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<path d="M 10 10 C 40 0 60 0 90 10 L 50 90 C 20 80 0 40 10 10 Z"/></svg>';
    const [shape] = importSvgFile(svg).elements;
    expect(shape?.type === "path" && shape.points).toHaveLength(3);
  });

  test("a group's name rides along in its id, and comes back as its name", () => {
    const a = Object.assign(createRect(0, 0, 1, 1), { groups: ["group-57cc1c37"] });
    const b = Object.assign(createRect(2, 2, 1, 1), { groups: ["group-57cc1c37"] });
    const first = formatExportSvg(
      { ...doc([a, b]), groupNames: { "group-57cc1c37": "top view" } },
      true
    );
    expect(first).toContain('<g id="group-57cc1c37_top_view">');
    const back = importSvgFile(first, { keepIds: true });
    expect(back.elements[0]!.groups).toEqual(["group-57cc1c37"]);
    expect(back.groupNames).toEqual({ "group-57cc1c37": "top_view" });
    const second = formatExportSvg({ ...doc(back.elements), groupNames: back.groupNames }, true);
    expect(second).toBe(first);
  });

  test("the group id is read back out of a named <g id>", () => {
    expect(groupIdFromSvgId("group-79acbec9_2222")).toBe("group-79acbec9");
    expect(groupIdFromSvgId("group-79acbec9")).toBe("group-79acbec9");
    expect(groupIdFromSvgId("wheels")).toBeNull();
  });

  test("a foreign <g id> becomes the group's name", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="wheels">' +
      '<rect width="1" height="1"/><rect x="2" width="1" height="1"/></g></svg>';
    const back = importSvgFile(svg);
    const gid = back.elements[0]!.groups![0]!;
    expect(gid).toMatch(/^group-/);
    expect(back.groupNames).toEqual({ [gid]: "wheels" });
  });

  test("a hidden shape exports as display none and comes back hidden", () => {
    const el = Object.assign(createRect(0, 0, 10, 10), { hidden: true });
    const first = formatExportSvg(doc([el]), true);
    expect(first).toContain('display="none"');
    const back = importSvgFile(first, { keepIds: true });
    expect(back.elements[0]!.hidden).toBe(true);
    expect(formatExportSvg(doc(back.elements), true)).toBe(first);
  });

  test("a saved project keeps the names of groups that still exist, and only those", () => {
    const a = Object.assign(createRect(0, 0, 1, 1), { groups: ["group-aaaa"] });
    const b = Object.assign(createRect(2, 2, 1, 1), { groups: ["group-aaaa"] });
    const saved = serializeProject({
      ...createInitialState(),
      elements: [a, b],
      groupNames: { "group-aaaa": "side view", "group-gone": "old" },
    });
    expect(saved.groupNames).toEqual({ "group-aaaa": "side view" });
    expect(serializeProject(createInitialState()).groupNames).toBeUndefined();
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
      "background",
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

  test("is written as the current version", () => {
    expect(serializeProject(createInitialState()).version).toBe(PROJECT_VERSION);
  });

  test("a version 1 document, the first released format, still opens", () => {
    const saved = { ...serializeProject(createInitialState()), version: 1 };
    const read = readProject(saved);
    expect(read.version).toBe(PROJECT_VERSION);
    expect(read.elements).toEqual(saved.elements);
  });

  test("a document of the current version reads back as it is", () => {
    const saved = serializeProject(createInitialState());
    expect(readProject(saved)).toEqual(saved);
  });

  test("a document from a newer Vellum is refused, not half-read", () => {
    const saved = { ...serializeProject(createInitialState()), version: 99 };
    expect(() => readProject(saved)).toThrow(/newer Vellum/);
  });

  test("a document with markup hidden in a colour or an id is refused", () => {
    const saved = serializeProject({
      ...createInitialState(),
      elements: [
        Object.assign(createRect(0, 0, 4, 4), { stroke: '#000"/><img src=x onerror=alert(1)>' }),
      ],
    });
    expect(() => readProject(saved)).toThrow(/damaged/);
    const badId = serializeProject({
      ...createInitialState(),
      elements: [Object.assign(createRect(0, 0, 4, 4), { id: "a<b" })],
    });
    expect(() => readProject(badId)).toThrow(/damaged/);
  });

  test("names and text may say anything: they are escaped wherever they appear", () => {
    const saved = serializeProject({
      ...createInitialState(),
      elements: [Object.assign(createRect(0, 0, 4, 4), { name: 'the "big" <box> & co' })],
      groupNames: {},
    });
    expect(readProject(saved).elements[0]!.name).toBe('the "big" <box> & co');
    expect(isInert({ groupNames: { "group-1": 'say "hi"' } })).toBe(true);
    expect(isInert({ groupNames: { 'group-"1': "x" } })).toBe(false);
  });

  test("something that is not a document is refused", () => {
    expect(() => readProject(null)).toThrow(/not a Vellum document/);
    expect(() => readProject({ artboard: {}, grid: {} })).toThrow(/not a Vellum document/);
  });
});

describe("groups and transforms on import", () => {
  test("nested groups become a chain, outermost first", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="group-out"><g id="group-in">' +
        '<rect width="5" height="5"/><rect x="9" width="5" height="5"/>' +
        '</g><rect x="20" width="5" height="5"/></g></svg>',
      { keepIds: true }
    );
    expect(r.elements[0]!.groups).toEqual(["group-out", "group-in"]);
  });

  test("a <g> whose whole content is one other <g> collapses into it", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="group-out"><g id="group-in">' +
        '<rect width="5" height="5"/><rect x="9" width="5" height="5"/>' +
        "</g></g></svg>",
      { keepIds: true }
    );
    // A group carries nothing but its membership here, so a level with one child says nothing.
    expect(r.elements[0]!.groups).toEqual(["group-in"]);
  });

  test("nested groups survive a round trip", () => {
    const a = Object.assign(createRect(0, 0, 1, 1), { groups: ["group-out", "group-in"] });
    const b = Object.assign(createRect(2, 2, 1, 1), { groups: ["group-out", "group-in"] });
    // A third member of the outer group only, so the outer one has two children and stays.
    const c = Object.assign(createRect(4, 4, 1, 1), { groups: ["group-out"] });
    const svg = formatExportSvg(doc([a, b, c]), true);
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

describe("path data the old parser dropped", () => {
  const points = (d: string) => {
    const r = importSvgFile(
      `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="#000"/></svg>`
    );
    const el = r.elements[0]!;
    return el.type === "path" ? el.points : [];
  };

  test("a command repeats implicitly", () => {
    expect(points("M0 0 L10 0 20 0 30 0").map((p) => p.x)).toEqual([0, 10, 20, 30]);
  });

  test("a repeated moveto continues as a lineto", () => {
    expect(points("M0 0 10 0 20 0").map((p) => p.x)).toEqual([0, 10, 20]);
  });

  test("a run of cubics keeps every segment", () => {
    expect(points("M0 0 C1 1 2 2 3 3 4 4 5 5 6 6")).toHaveLength(3);
  });

  test("a quadratic becomes the cubic that draws the same curve", () => {
    const pts = points("M0 0 Q30 0 30 30");
    expect(pts).toHaveLength(2);
    // c1 = p0 + 2/3 (q - p0), c2 = p3 + 2/3 (q - p3).
    expect(pts[0]!.hOut).toEqual({ x: 20, y: 0 });
    expect(pts[1]!.hIn).toEqual({ x: 30, y: 10 });
  });

  test("the smooth shorthands reflect the previous control point", () => {
    const cubic = points("M0 0 C0 10 10 10 10 0 S20 -10 20 0");
    expect(cubic).toHaveLength(3);
    expect(cubic[1]!.hOut).toEqual({ x: 10, y: -10 });
    expect(points("M0 0 Q10 10 20 0 T40 0")).toHaveLength(3);
  });

  test("Z closes back to the start without a second anchor there", () => {
    // The anchor it used to add was dropped by the next import, so the file changed each trip.
    expect(points("M0 0 L10 0 L10 10 Z")).toHaveLength(3);
  });

  test("handles in line through a point import linked; any other pair is a cusp", () => {
    const smooth = points("M0 0 C0 10 10 10 20 10 C30 10 40 10 40 0");
    expect(smooth[1]!.smooth).toBe(true);
    const cusp = points("M0 0 C0 10 10 10 20 10 C20 0 40 10 40 0");
    expect(cusp[1]!.smooth).toBe(false);
  });

  test("relative commands are resolved against the current point", () => {
    expect(points("M10 10 l10 0 l0 10").map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [20, 10],
      [20, 20],
    ]);
  });

  test("an arc is approximated and lands exactly on its endpoint", () => {
    const pts = points("M0 50 A50 50 0 0 1 100 50");
    expect(pts.length).toBeGreaterThan(2);
    const end = pts[pts.length - 1]!;
    expect([Math.round(end.x), Math.round(end.y)]).toEqual([100, 50]);
    // Halfway round a half circle of radius 50 centred at (50,50): the top of the arc.
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(Math.round(mid.y)).toBe(0);
  });

  test("an arc with a zero radius degenerates to a line", () => {
    expect(points("M0 0 A0 0 0 0 1 10 10")).toHaveLength(2);
  });
});

describe("gradients", () => {
  const gradient = (over: Partial<SceneElement>) =>
    Object.assign(createRect(0, 0, 100, 50), { fillEnabled: true, fillType: "linear" }, over);

  test("every stop is written out, in order", () => {
    const el = gradient({
      gradStops: [
        { offset: 0, color: "#ff0000", opacity: 1 },
        { offset: 0.4, color: "#00ff00", opacity: 0.5 },
        { offset: 1, color: "#0000ff", opacity: 1 },
      ],
    });
    const svg = formatExportSvg(doc([el]), true);
    expect(svg.match(/<stop /g)).toHaveLength(3);
    expect(svg).toContain('offset="0.4" stop-color="#00ff00" stop-opacity="0.5"');
  });

  test("the gradient's ends are written as coordinates, not an angle", () => {
    const el = gradient({ gradFrom: { x: 0.25, y: 0 }, gradTo: { x: 0.75, y: 1 } });
    expect(formatExportSvg(doc([el]), true)).toContain('x1="0.25" y1="0" x2="0.75" y2="1"');
  });

  test("a radial gradient's centre and radius come from the same two points", () => {
    const el = gradient({
      fillType: "radial",
      gradFrom: { x: 0.5, y: 0.5 },
      gradTo: { x: 0.9, y: 0.5 },
    });
    expect(formatExportSvg(doc([el]), true)).toContain('cx="0.5" cy="0.5" r="0.4"');
  });

  test("three stops survive a round trip", () => {
    const el = gradient({
      gradStops: [
        { offset: 0, color: "#ff0000", opacity: 1 },
        { offset: 0.4, color: "#00ff00", opacity: 1 },
        { offset: 1, color: "#0000ff", opacity: 1 },
      ],
    });
    const back = importSvgFile(formatExportSvg(doc([el]), true), { keepIds: true });
    expect(back.elements[0]!.gradStops).toHaveLength(3);
    expect(back.elements[0]!.gradStops[1]).toMatchObject({ offset: 0.4, color: "#00ff00" });
  });

  test("percentages are read as fractions", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<linearGradient id="g" x1="10%" y1="0%" x2="90%" y2="0%">' +
        '<stop offset="20%" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff"/>' +
        "</linearGradient></defs>" +
        '<rect width="10" height="10" fill="url(#g)"/></svg>'
    );
    expect(r.elements[0]!.gradFrom).toEqual({ x: 0.1, y: 0 });
    expect(r.elements[0]!.gradStops[0]!.offset).toBeCloseTo(0.2);
  });

  test("a userSpaceOnUse gradient is converted to the shape's own box", () => {
    const r = importSvgFile(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="100" y1="0" x2="200" y2="0">' +
        '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>' +
        "</linearGradient></defs>" +
        '<rect x="100" y="0" width="100" height="50" fill="url(#g)"/></svg>'
    );
    expect(r.elements[0]!.gradFrom).toEqual({ x: 0, y: 0 });
    expect(r.elements[0]!.gradTo).toEqual({ x: 1, y: 0 });
  });
});

describe("rotation round trip", () => {
  test("a rotated rect stays a rect through export and import", () => {
    const el = Object.assign(createRect(10, 20, 100, 50), { rotation: 30 });
    const svg = formatExportSvg(doc([el]), true);
    expect(svg).toContain("<rect ");
    expect(svg).toContain('transform="rotate(30 60 45)"');
    const back = importSvgFile(svg, { keepIds: true });
    expect(back.elements[0]!.type).toBe("rect");
    expect(Math.round(back.elements[0]!.rotation ?? 0)).toBe(30);
  });

  test("export is byte-for-byte stable across that trip", () => {
    const el = Object.assign(createRect(10, 20, 100, 50), { rotation: 30 });
    const first = formatExportSvg(doc([el]), true);
    const back = importSvgFile(first, { keepIds: true });
    expect(formatExportSvg({ artboard: doc([]).artboard, elements: back.elements }, true)).toBe(
      first
    );
  });

  test("a rotated ellipse keeps its type too", () => {
    const el = Object.assign(createEllipse(50, 50, 30, 10), { rotation: 45 });
    const back = importSvgFile(formatExportSvg(doc([el]), true), { keepIds: true });
    expect(back.elements[0]!.type).toBe("ellipse");
    expect(Math.round(back.elements[0]!.rotation ?? 0)).toBe(45);
  });
});

describe("compound paths", () => {
  const svg = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
  const ring =
    '<path d="M 0 0 L 40 0 L 40 40 L 0 40 Z M 10 10 L 10 30 L 30 30 L 30 10 Z" fill="#000000" fill-rule="evenodd"/>';

  test("every moveto starts an outline of its own, in one path", () => {
    const [el] = importSvgFile(svg(ring)).elements;
    expect(el!.type).toBe("path");
    if (el!.type !== "path") return;
    expect(el.points).toHaveLength(8);
    expect(el.subpaths).toEqual([4]);
    expect(el.closed).toBe(true);
    expect(el.fillRule).toBe("evenodd");
  });

  test("the outlines and the fill rule survive the round trip byte for byte", () => {
    const first = formatExportSvg(doc(importSvgFile(svg(ring)).elements), true);
    expect(first).toContain("Z M 10 10");
    expect(first).toContain('fill-rule="evenodd"');
    const back = importSvgFile(first, { keepIds: true });
    const second = formatExportSvg({ artboard: back.artboard!, elements: back.elements }, true);
    expect(second).toBe(first);
  });

  test("open and closed outlines in one d become a path of each kind", () => {
    const els = importSvgFile(
      svg('<path d="M 0 0 L 10 0 L 10 10 Z M 20 0 L 30 0" stroke="#000"/>')
    ).elements;
    expect(els.map((e) => e.type === "path" && e.closed)).toEqual([true, false]);
  });

  test("a stray moveto draws nothing and leaves no point behind", () => {
    const [el] = importSvgFile(
      svg('<path d="M 5 5 M 0 0 L 10 0 L 10 10 Z" fill="#000"/>')
    ).elements;
    expect(el!.type === "path" && el!.points.length).toBe(3);
  });
});

describe("dash patterns", () => {
  test("a dash pattern is written, read back, and stable", () => {
    const line = createLine(0, 0, 100, 0);
    line.dash = [6, 4];
    const first = formatExportSvg(doc([line]), true);
    expect(first).toContain('stroke-dasharray="6 4"');
    const back = importSvgFile(first, { keepIds: true });
    expect(back.elements[0]!.dash).toEqual([6, 4]);
    expect(formatExportSvg({ artboard: back.artboard!, elements: back.elements }, true)).toBe(
      first
    );
  });

  test("none, negatives and all zeros are a solid line", () => {
    for (const d of ["none", "4 -2", "0 0", ""]) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><line x1="0" y1="0" x2="9" y2="0" stroke="#000" stroke-dasharray="${d}"/></svg>`;
      expect(importSvgFile(svg).elements[0]!.dash).toBeUndefined();
    }
  });
});

describe("guides", () => {
  test("are saved with the document only when there are any, and never exported", () => {
    const state = createInitialState();
    expect(serializeProject(state)).not.toHaveProperty("guides");
    const withGuides = { ...state, guides: { x: [100], y: [50] } };
    expect(serializeProject(withGuides).guides).toEqual({ x: [100], y: [50] });
    expect(formatExportSvg(withGuides, true)).not.toContain("100");
  });
});
