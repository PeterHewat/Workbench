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
  rotationBase,
  canRotate,
  setClosed,
  simplifyPathIfStraight,
  splitAt,
  styleAttrs,
  togglePointSmooth,
  toPathElement,
  translateElement,
} from "./model.js";
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

  test("rects become polygons and ellipses become paths", () => {
    expect(rotationBase(createRect(0, 0, 10, 10)).type).toBe("polygon");
    expect(rotationBase(createEllipse(0, 0, 10, 5)).type).toBe("path");
  });

  test("a square rotated about its centre keeps its bounding box", () => {
    const base = rotationBase(createRect(0, 0, 10, 10));
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
