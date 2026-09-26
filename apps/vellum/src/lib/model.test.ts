import { describe, expect, test } from "bun:test";
import {
  collectAlignPoints,
  createCircle,
  createEllipse,
  createLine,
  createPath,
  createPolygon,
  createPolyline,
  createRect,
  createText,
  duplicateElement,
  elementBBox,
  geometryOf,
  insertPointAt,
  joinPaths,
  nearestOnElement,
  rotateElementCopy,
  canRotate,
  closeByMerge,
  closingEnd,
  canSplitAt,
  hasHandle,
  removeHandle,
  setClosed,
  simplifyPathIfStraight,
  splitAt,
  styleAttrs,
  togglePointSmooth,
  hasTwoHandles,
  magnetTurn,
  setHandlesLinked,
  toPathElement,
  translateElement,
  translatePoint,
  deletePoints,
  toLocalPoint,
  toWorldPoint,
  localBBox,
  rotationCentre,
} from "./model.js";
import { elementToSvgMarkup } from "./io.js";
import type { Anchor, PathElement } from "./types.js";

const anchor = (x: number, y: number, hIn: Anchor["hIn"] = null, hOut: Anchor["hOut"] = null) =>
  ({ x, y, smooth: !!(hIn || hOut), hIn, hOut }) as Anchor;

describe("bounding boxes", () => {
  test("rect", () => {
    expect(elementBBox(createRect(10, 20, 100, 50))).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  test("circle and ellipse share one code path", () => {
    expect(elementBBox(createCircle(50, 60, 10))).toEqual({ x: 40, y: 50, width: 20, height: 20 });
    expect(elementBBox(createEllipse(50, 60, 10, 4))).toEqual({
      x: 40,
      y: 56,
      width: 20,
      height: 8,
    });
  });

  test("line uses its endpoints regardless of direction", () => {
    expect(elementBBox(createLine(5, 9, 1, 3))).toEqual({ x: 1, y: 3, width: 4, height: 6 });
  });

  test("a path's box includes its Bezier handles, not just its anchors", () => {
    const p = createPath(
      [anchor(0, 0, null, { x: -5, y: 20 }), anchor(10, 0, { x: 15, y: 20 }, null)],
      false
    );
    expect(elementBBox(p)).toEqual({ x: -5, y: 0, width: 20, height: 20 });
  });

  test("an empty path has no box", () => {
    expect(elementBBox(createPath([], false))).toBeNull();
  });
});

describe("translation", () => {
  test("moves every geometry type by the same offset", () => {
    const circle = createCircle(1, 1, 3);
    const ellipse = createEllipse(1, 1, 3, 4);
    const poly = createPolygon([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    for (const el of [circle, ellipse, poly]) translateElement(el, 2, 3);
    expect([circle.cx, circle.cy]).toEqual([3, 4]);
    expect([ellipse.cx, ellipse.cy]).toEqual([3, 4]);
    expect(poly.points).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 4 },
    ]);
  });

  test("carries a path's handles along with its anchors", () => {
    const p = createPath([anchor(0, 0, { x: -1, y: -1 }, { x: 1, y: 1 })], false);
    translateElement(p, 2, 3);
    expect(p.points[0]).toMatchObject({ x: 2, y: 3, hIn: { x: 1, y: 2 }, hOut: { x: 3, y: 4 } });
  });
});

describe("type conversion", () => {
  test("a rect becomes a path tracing its perimeter, not a bowtie", () => {
    const path = toPathElement(createRect(10, 20, 100, 50)) as PathElement;
    expect(path.points.map((p) => [p.x, p.y])).toEqual([
      [10, 20],
      [110, 20],
      [110, 70],
      [10, 70],
    ]);
    expect(path.closed).toBe(true);
  });

  test("a straight closed path simplifies to a polygon", () => {
    const sq = createPath([anchor(0, 0), anchor(10, 0), anchor(10, 10)], true);
    expect(simplifyPathIfStraight(sq).type).toBe("polygon");
  });

  test("a straight two-point path simplifies to a line", () => {
    expect(simplifyPathIfStraight(createPath([anchor(0, 0), anchor(1, 1)], false)).type).toBe(
      "line"
    );
  });

  test("a curved path is left alone", () => {
    const curved = createPath([anchor(0, 0, null, { x: 5, y: 50 }), anchor(10, 0)], false);
    expect(simplifyPathIfStraight(curved).type).toBe("path");
  });

  test("conversion keeps the id so selection and undo stay valid", () => {
    const rect = createRect(0, 0, 10, 10);
    expect(toPathElement(rect).id).toBe(rect.id);
  });
});

describe("path rendering", () => {
  test("a straight closing segment relies on Z instead of a redundant command", () => {
    const sq = createPath([anchor(0, 0), anchor(10, 0), anchor(10, 10)], true);
    expect(geometryOf(sq)?.attrs.d).toBe("M 0 0 L 10 0 L 10 10 Z");
  });

  test("a curved closing segment gets its own command before Z", () => {
    const p = createPath(
      [anchor(0, 0, { x: -5, y: -5 }, null), anchor(10, 0), anchor(10, 10, null, { x: 20, y: 20 })],
      true
    );
    expect(geometryOf(p)?.attrs.d).toMatch(/C .* Z$/);
  });

  test("rx alone is emitted when both radii match", () => {
    const attrs = geometryOf(Object.assign(createRect(0, 0, 80, 40), { rx: 8 }))!.attrs;
    expect(attrs.rx).toBe(8);
    expect(attrs.ry).toBeNull();
  });

  test("ry is emitted only when it differs from rx", () => {
    const attrs = geometryOf(Object.assign(createRect(0, 0, 80, 40), { rx: 8, ry: 4 }))!.attrs;
    expect(attrs).toMatchObject({ rx: 8, ry: 4 });
  });
});

describe("style attributes", () => {
  test("a zero-width stroke exports as stroke=none with no stroke geometry", () => {
    const attrs = styleAttrs(Object.assign(createLine(0, 0, 5, 5), { strokeWidth: 0 }));
    expect(attrs.stroke).toBe("none");
    expect(attrs["stroke-width"]).toBeUndefined();
  });

  test("fully opaque values are omitted", () => {
    const attrs = styleAttrs(createRect(0, 0, 9, 9));
    expect(attrs["stroke-opacity"]).toBeUndefined();
    expect(attrs["fill-opacity"]).toBeUndefined();
  });

  test("partial opacity is emitted", () => {
    const el = Object.assign(createRect(0, 0, 9, 9), {
      fillEnabled: true,
      fillOpacity: 0.5,
      strokeOpacity: 0.25,
    });
    expect(styleAttrs(el)).toMatchObject({ "stroke-opacity": 0.25, "fill-opacity": 0.5 });
  });

  test("a gradient fill points at its defs entry", () => {
    const el = Object.assign(createRect(0, 0, 9, 9), {
      fillEnabled: true,
      fillType: "linear" as const,
    });
    expect(styleAttrs(el).fill).toBe(`url(#grad-${el.id})`);
  });
});

describe("alignment points", () => {
  test("a rect contributes its four corners", () => {
    expect(collectAlignPoints([createRect(0, 0, 10, 10)])).toHaveLength(4);
  });

  test("a circle contributes only its centre", () => {
    expect(collectAlignPoints([createCircle(7, 8, 2)])).toEqual([{ x: 7, y: 8 }]);
  });

  test("the excluded anchor drops its handles too", () => {
    const p = createPath([anchor(0, 0, { x: -1, y: -1 }, { x: 1, y: 1 })], false);
    expect(collectAlignPoints([p], { excludePoint: { elementId: p.id, index: 0 } })).toEqual([]);
  });

  test("excluded elements contribute nothing", () => {
    const r = createRect(0, 0, 10, 10);
    expect(collectAlignPoints([r], { excludeElementIds: new Set([r.id]) })).toEqual([]);
  });
});

describe("point editing", () => {
  test("inserting on a curved segment splits it without moving the outline", () => {
    // de Casteljau at t=0.5 on P0(0,0) C1(0,50) C2(100,50) P3(100,0) lands exactly on (50, 37.5),
    // so the new anchor must sit on the original curve rather than near it.
    const curve = createPath(
      [anchor(0, 0, null, { x: 0, y: 50 }), anchor(100, 0, { x: 100, y: 50 }, null)],
      false
    );
    insertPointAt(curve, 0, 0.5);
    expect(curve.points).toHaveLength(3);
    expect(curve.points[1]!.x).toBeCloseTo(50, 10);
    expect(curve.points[1]!.y).toBeCloseTo(37.5, 10);
    expect(curve.points[1]!.smooth).toBe(true);
    // The endpoints are untouched.
    expect([curve.points[0]!.x, curve.points[0]!.y]).toEqual([0, 0]);
    expect([curve.points[2]!.x, curve.points[2]!.y]).toEqual([100, 0]);
  });

  test("the split curve still passes through the same sampled points", () => {
    const make = () =>
      createPath(
        [anchor(0, 0, null, { x: 0, y: 50 }), anchor(100, 0, { x: 100, y: 50 }, null)],
        false
      );
    const original = make();
    const split = make();
    insertPointAt(split, 0, 0.5);
    for (const probe of [
      { x: 25, y: 30 },
      { x: 50, y: 40 },
      { x: 75, y: 30 },
    ]) {
      // Tolerance reflects the outline sampler's own resolution, not shape drift.
      expect(nearestOnElement(split, probe)!.dist).toBeCloseTo(
        nearestOnElement(original, probe)!.dist,
        3
      );
    }
  });

  test("inserting on a line yields a three-point polyline with the same id", () => {
    const line = createLine(0, 0, 10, 0);
    const next = insertPointAt(line, 0, 0.5);
    expect(next.type).toBe("polyline");
    expect(next.id).toBe(line.id);
    expect((next as { points: unknown[] }).points).toHaveLength(3);
  });

  test("linking a cusp mirrors its in-handle off the out one; breaking keeps both", () => {
    const p = anchor(10, 10, { x: 0, y: 12 }, { x: 16, y: 18 });
    p.smooth = false;
    expect(hasTwoHandles(p)).toBe(true);
    setHandlesLinked(p, true);
    expect(p.smooth).toBe(true);
    expect(p.hIn).toEqual({ x: 4, y: 2 });
    setHandlesLinked(p, false);
    expect(p.smooth).toBe(false);
    expect(p.hIn).toEqual({ x: 4, y: 2 });
    expect(p.hOut).toEqual({ x: 16, y: 18 });
  });

  test("a point with a retracted handle has no pair to link", () => {
    expect(hasTwoHandles(anchor(0, 0, { x: 0, y: 0 }, { x: 5, y: 0 }))).toBe(false);
  });

  test("smooth and corner round-trip", () => {
    const p = createPath([anchor(0, 0), anchor(10, 10), anchor(20, 0)], false);
    togglePointSmooth(p, 1);
    expect(p.points[1]!.hIn).not.toBeNull();
    expect(p.points[1]!.hOut).not.toBeNull();
    togglePointSmooth(p, 1);
    expect(p.points[1]!.hIn).toBeNull();
    expect(p.points[1]!.hOut).toBeNull();
  });
});

describe("topology", () => {
  // The user's case: three anchors, and dragging the last onto the first should give a heart -
  // two anchors, two curves.
  const heartHalf = () =>
    createPath(
      [
        anchor(192, 288, null, { x: 240, y: 256 }),
        anchor(176, 224, { x: 224, y: 160 }, { x: 128, y: 160 }),
        anchor(192, 288, { x: 112, y: 256 }, null),
      ],
      false
    );

  test("closing by merging the ends of a three-anchor curve keeps both curves", () => {
    const heart = closeByMerge(heartHalf(), 2, 1) as PathElement;
    expect(heart.closed).toBe(true);
    expect(heart.points).toHaveLength(2);
    expect(geometryOf(heart)!.attrs.d).toBe(
      "M 192 288 C 240 256 224 160 176 224 C 128 160 112 256 192 288 Z"
    );
  });

  test("a two-anchor closed path can be hit on its closing curve and split there", () => {
    const heart = closeByMerge(heartHalf(), 2, 1) as PathElement;
    // A point on the closing curve, well away from the first one.
    expect(nearestOnElement(heart, { x: 140, y: 230 })!.index).toBe(1);
    const [open] = splitAt(heart, 1)!;
    expect(open!.type === "path" && open.points).toHaveLength(3);
  });

  test("closing a polyline makes a polygon and back again", () => {
    const pl = createPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    const closed = setClosed(pl, true);
    expect(closed.type).toBe("polygon");
    expect(setClosed(closed, false).type).toBe("polyline");
  });

  test("a polyline with under three points cannot close", () => {
    const pl = createPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(setClosed(pl, true).type).toBe("polyline");
  });

  test("a path closes from two points, a lens once it curves", () => {
    const lens = createPath([anchor(0, 0, null, { x: 5, y: -8 }), anchor(10, 0)], false);
    const closed = setClosed(lens, true);
    expect(closed.type === "path" && closed.closed).toBe(true);
  });

  test("splitting an open shape at a middle vertex gives two shapes", () => {
    const pl = createPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 5 },
    ]);
    const parts = splitAt(pl, 1);
    expect(parts).toHaveLength(2);
    expect(parts![0]!.id).toBe(pl.id);
  });

  test("splitting at an endpoint is refused", () => {
    const pl = createPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(splitAt(pl, 0)).toBeNull();
  });

  test("joining two open shapes merges coincident ends", () => {
    const a = createPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const b = createPolyline([
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    const joined = joinPaths(a, b, 0.5);
    expect(joined).not.toBeNull();
    expect(joined!.id).toBe(a.id);
    expect((joined as { points: unknown[] }).points).toHaveLength(3);
  });

  test("joining refuses closed shapes", () => {
    const poly = createPolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(joinPaths(poly, poly)).toBeNull();
  });

  test("two custom names survive a join", () => {
    const a = Object.assign(
      createPolyline([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      { name: "foo" }
    );
    const b = Object.assign(
      createPolyline([
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
      { name: "bar" }
    );
    expect(joinPaths(a, b, 0.5)!.name).toBe("foo bar");
  });
});

describe("rotation", () => {
  test("a circle is excluded because it looks the same at any angle", () => {
    expect(canRotate(createCircle(0, 0, 1))).toBe(false);
    expect(canRotate(createRect(0, 0, 1, 1))).toBe(true);
  });

  test("a rect stays a rect and an ellipse stays an ellipse: the angle is stored", () => {
    const rect = rotateElementCopy(createRect(0, 0, 10, 10), Math.PI / 4, 5, 5);
    expect(rect.type).toBe("rect");
    expect(Math.round(rect.rotation ?? 0)).toBe(45);
    const ellipse = rotateElementCopy(createEllipse(0, 0, 10, 5), Math.PI / 2, 0, 0);
    expect(ellipse.type).toBe("ellipse");
    expect(Math.round(ellipse.rotation ?? 0)).toBe(90);
  });

  test("a rotated rect exports as a rect with a rotate() transform", () => {
    const rect = rotateElementCopy(createRect(0, 0, 10, 20), Math.PI / 6, 5, 10);
    const markup = elementToSvgMarkup(rect);
    expect(markup.startsWith("<rect ")).toBe(true);
    expect(markup).toContain('transform="rotate(30 5 10)"');
  });

  test("turning a rotated rect into a path bakes the angle into its points", () => {
    const rect = rotateElementCopy(createRect(0, 0, 10, 10), Math.PI / 2, 5, 5);
    const path = toPathElement(rect);
    expect(path.rotation).toBeUndefined();
    const box = elementBBox(path)!;
    expect(box.width).toBeCloseTo(10, 6);
    expect(box.height).toBeCloseTo(10, 6);
  });

  test("a rotated ellipse's bounding box uses its real extent, not its corners", () => {
    const ellipse = rotateElementCopy(createEllipse(0, 0, 20, 10), Math.PI / 2, 0, 0);
    const box = elementBBox(ellipse)!;
    expect(box.width).toBeCloseTo(20, 6);
    expect(box.height).toBeCloseTo(40, 6);
  });

  test("a square rotated about its centre keeps its bounding box", () => {
    const base = toPathElement(createRect(0, 0, 10, 10));
    const box = elementBBox(rotateElementCopy(base, Math.PI / 2, 5, 5))!;
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo(0, 6);
    expect(box.width).toBeCloseTo(10, 6);
    expect(box.height).toBeCloseTo(10, 6);
  });

  test("text records its angle rather than reshaping", () => {
    const rotated = rotateElementCopy(createText(10, 10, "hi"), Math.PI / 2, 0, 0);
    expect(rotated.type).toBe("text");
    expect(Math.round((rotated as { rotation: number }).rotation)).toBe(90);
  });
});

describe("duplication", () => {
  test("a copy gets a fresh id and is not aliased to the original", () => {
    const rect = createRect(0, 0, 10, 10);
    const copy = duplicateElement(rect);
    expect(copy.id).not.toBe(rect.id);
    translateElement(copy, 5, 5);
    expect(rect.x).toBe(0);
  });
});

describe("rotated frames", () => {
  test("a point survives the trip into a shape's own frame and back", () => {
    const rect = Object.assign(createRect(0, 0, 100, 40), { rotation: 37 });
    const p = { x: 12.5, y: -8 };
    const back = toLocalPoint(rect, toWorldPoint(rect, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  test("an unrotated shape's frame is the artboard's", () => {
    const rect = createRect(0, 0, 10, 10);
    expect(toWorldPoint(rect, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  test("the local box ignores the angle; the artboard box does not", () => {
    const rect = Object.assign(createRect(0, 0, 100, 40), { rotation: 90 });
    expect(localBBox(rect)).toEqual({ x: 0, y: 0, width: 100, height: 40 });
    const box = elementBBox(rect)!;
    expect(box.width).toBeCloseTo(40, 6);
    expect(box.height).toBeCloseTo(100, 6);
  });

  test("rotating about the shape's own centre leaves the centre alone", () => {
    const rect = createRect(10, 10, 60, 20);
    const turned = rotateElementCopy(rect, Math.PI / 3, 40, 20);
    expect(rotationCentre(turned)).toEqual({ x: 40, y: 20 });
  });

  test("rotating about another point carries the shape round it", () => {
    const rect = createRect(0, 0, 10, 10);
    const turned = rotateElementCopy(rect, Math.PI, 0, 0);
    const centre = rotationCentre(turned);
    expect(centre.x).toBeCloseTo(-5, 6);
    expect(centre.y).toBeCloseTo(-5, 6);
  });
});

describe("magnetTurn", () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 1000) / 1000;

  test("pulls a turn that comes within reach of 15° onto it", () => {
    expect(deg(magnetTurn(rad(43)))).toBe(45);
    expect(deg(magnetTurn(rad(-16.5)))).toBe(-15);
  });

  test("leaves the angles in between alone", () => {
    expect(deg(magnetTurn(rad(37)))).toBe(37);
  });

  test("works on the angle the shape shows, not on the turn alone", () => {
    // Already at 10°: a 34° turn shows 44°, which the magnet takes to 45°, a 35° turn.
    expect(deg(magnetTurn(rad(34), 10))).toBe(35);
  });
});

describe("point editing", () => {
  const wave = () =>
    createPath(
      [
        anchor(0, 0, null, { x: 10, y: -10 }),
        anchor(30, 0, { x: 20, y: 10 }, { x: 40, y: -10 }),
        anchor(60, 0, { x: 50, y: 10 }, null),
      ],
      false
    ) as PathElement;

  test("an open path splits between its ends, not at them", () => {
    const path = wave();
    expect([0, 1, 2].map((i) => canSplitAt(path, i))).toEqual([false, true, false]);
    for (const i of [0, 1, 2]) expect(canSplitAt(path, i)).toBe(splitAt(wave(), i) !== null);
  });

  test("a closed path splits at any point", () => {
    const path = wave();
    path.closed = true;
    expect([0, 1, 2].map((i) => canSplitAt(path, i))).toEqual([true, true, true]);
  });

  test("removing one handle keeps the other, and the pair is no longer linked", () => {
    const p = wave().points[1]!;
    p.smooth = true;
    removeHandle(p, "in");
    expect(hasHandle(p, "in")).toBe(false);
    expect(hasHandle(p, "out")).toBe(true);
    expect(p.smooth).toBe(false);
    expect(hasTwoHandles(p)).toBe(false);
  });

  test("a handle lying on its anchor does not count as one", () => {
    expect(hasHandle(anchor(5, 5, { x: 5, y: 5 }), "in")).toBe(false);
  });

  test("an end dragged onto the other end announces the close that dropping it makes", () => {
    const path = heartHalfFor();
    expect(closingEnd(path, 2, 1)).toMatchObject({ x: 192, y: 288 });
    expect(closingEnd(path, 1, 1)).toBeNull();
    // Checking changes nothing: the merge itself is still there to be made.
    expect(closeByMerge(path, 2, 1)).not.toBeNull();
  });

  function heartHalfFor(): PathElement {
    return createPath(
      [
        anchor(192, 288, null, { x: 240, y: 256 }),
        anchor(176, 224, { x: 224, y: 160 }, { x: 128, y: 160 }),
        anchor(192, 288, { x: 112, y: 256 }, null),
      ],
      false
    ) as PathElement;
  }
});

describe("translatePoint", () => {
  test("moves an anchor with both of its handles", () => {
    const p = createPath([anchor(0, 0, { x: -1, y: 0 }, { x: 1, y: 0 }), anchor(10, 0)], false);
    translatePoint(p, 0, 2, 3);
    expect(p.points[0]).toMatchObject({ x: 2, y: 3, hIn: { x: 1, y: 3 }, hOut: { x: 3, y: 3 } });
    expect(p.points[1]).toMatchObject({ x: 10, y: 0 });
  });

  test("moves one handle, mirroring its partner only while the pair is linked", () => {
    const linked = createPath([anchor(0, 0, { x: -1, y: 0 }, { x: 1, y: 0 })], false);
    linked.points[0]!.smooth = true;
    translatePoint(linked, 0, 0, 1, "out");
    expect(linked.points[0]).toMatchObject({
      x: 0,
      y: 0,
      hOut: { x: 1, y: 1 },
      hIn: { x: -1, y: -1 },
    });
    const cusp = createPath([anchor(0, 0, { x: -1, y: 0 }, { x: 1, y: 0 })], false);
    cusp.points[0]!.smooth = false;
    translatePoint(cusp, 0, 0, 1, "out");
    expect(cusp.points[0]!.hIn).toEqual({ x: -1, y: 0 });
  });

  test("moves one end of a line, and nothing for a point it does not have", () => {
    const line = createLine(0, 0, 10, 10);
    translatePoint(line, 1, 1, 1);
    expect(line).toMatchObject({ x1: 0, y1: 0, x2: 11, y2: 11 });
    translatePoint(line, 2, 5, 5);
    expect(line).toMatchObject({ x1: 0, y1: 0, x2: 11, y2: 11 });
  });
});

describe("curving a two-point path", () => {
  test("the handles stand square to the line, so it bulges", () => {
    const lens = createPath([anchor(0, 0), anchor(30, 0)], true);
    togglePointSmooth(lens, 0);
    const p = lens.points[0]!;
    expect(p.hOut!.x).toBeCloseTo(0);
    expect(Math.abs(p.hOut!.y)).toBeCloseTo(10);
    expect(p.hIn!.y).toBeCloseTo(-p.hOut!.y);
  });

  test("closed on two straight points it stays a closed path, not a line", () => {
    const lens = createPath([anchor(0, 0), anchor(30, 0)], true);
    expect(simplifyPathIfStraight(lens).type).toBe("path");
  });
});

describe("paths of several outlines", () => {
  // A square with a square hole: two closed outlines, the second starting at point 4.
  const ring = () => {
    const p = createPath(
      [
        anchor(0, 0),
        anchor(40, 0),
        anchor(40, 40),
        anchor(0, 40),
        anchor(10, 10),
        anchor(10, 30),
        anchor(30, 30),
        anchor(30, 10),
      ],
      true
    );
    p.subpaths = [4];
    return p;
  };

  test("each outline is its own subpath", () => {
    expect(geometryOf(ring())!.attrs.d).toBe(
      "M 0 0 L 40 0 L 40 40 L 0 40 Z M 10 10 L 10 30 L 30 30 L 30 10 Z"
    );
  });

  test("a point inserted on the hole's closing edge stays in the hole", () => {
    const p = ring();
    insertPointAt(p, 7, 0.5);
    expect(p.subpaths).toEqual([4]);
    expect(p.points[8]).toMatchObject({ x: 20, y: 10 });
  });

  test("deleting points down to one in an outline drops that outline", () => {
    const next = deletePoints(ring(), [4, 5, 6]);
    expect(next!.type === "path" && next!.points.length).toBe(4);
    expect(next!.type === "path" && next!.subpaths).toBeUndefined();
  });

  test("a point's neighbours are its own outline's", () => {
    const p = ring();
    togglePointSmooth(p, 4);
    // Its neighbours are (30, 10) and (10, 30): the handles run along that diagonal.
    const h = p.points[4]!.hOut!;
    expect(h.x - 10).toBeCloseTo(-(h.y - 10));
  });

  test("it stays a path when straight, and cannot be split or joined", () => {
    expect(simplifyPathIfStraight(ring()).type).toBe("path");
    expect(canSplitAt(ring(), 1)).toBe(false);
  });
});

describe("a rounded rect as a path", () => {
  test("keeps its rounded corners and its box", () => {
    const r = createRect(0, 0, 100, 50);
    r.rx = 10;
    const p = toPathElement(r);
    expect(p.type === "path" && p.points.length).toBe(8);
    expect(elementBBox(p)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(geometryOf(p)!.attrs.d).toContain(" C ");
  });

  test("a radius taking a whole side leaves one anchor there", () => {
    const r = createRect(0, 0, 40, 20);
    r.rx = 10;
    // The ends are half circles: the vertical sides are used up.
    const p = toPathElement(r);
    expect(p.type === "path" && p.points.length).toBe(6);
  });
});
