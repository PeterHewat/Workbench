import { describe, expect, test } from "bun:test";
import { createPolygon, createRect, elementBBox, toWorldPoint } from "./model.js";
import { cornerHandleInset } from "./pointer.js";
import { applyResize, scaleByCorner } from "./resize.js";
import { deepClone } from "./utils.js";
import type { RectElement } from "./types.js";

function rotatedRect(rotation: number): RectElement {
  const r = createRect(10, 20, 100, 60);
  r.rotation = rotation;
  return r;
}

describe("square handle", () => {
  for (const rotation of [0, 30, 90, 200]) {
    test(`over one whole drag, holds the top-left corner and follows the pointer at ${rotation}deg`, () => {
      const base = rotatedRect(rotation);
      // One element that every move of the drag is applied to, as the pointer handler does.
      const el = deepClone(base);
      const off = cornerHandleInset();
      const corner = toWorldPoint(base, { x: base.x, y: base.y });
      for (const side of [90, 120, 150, 210, 140]) {
        // The pointer sits on the handle's diagonal, in the rect's own frame, turned into place.
        const pointer = toWorldPoint(base, { x: base.x + side + off, y: base.y + side + off });
        applyResize(el, "uniform", pointer, base, false);

        expect(el.width).toBeCloseTo(side, 6);
        expect(el.height).toBeCloseTo(side, 6);
        const now = toWorldPoint(el, { x: el.x, y: el.y });
        expect(now.x).toBeCloseTo(corner.x, 6);
        expect(now.y).toBeCloseTo(corner.y, 6);
        const handle = toWorldPoint(el, { x: el.x + el.width + off, y: el.y + el.height + off });
        expect(handle.x).toBeCloseTo(pointer.x, 6);
        expect(handle.y).toBeCloseTo(pointer.y, 6);
      }
    });
  }
});

describe("box handles", () => {
  const tri = () =>
    createPolygon([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 50 },
    ]);

  test("dragging a corner scales from the opposite one", () => {
    const scaled = scaleByCorner(tri(), "box-br", { x: 200, y: 25 }, false);
    expect(elementBBox(scaled)).toEqual({ x: 0, y: 0, width: 200, height: 25 });
  });

  test("the top-left corner holds the bottom-right still", () => {
    const scaled = scaleByCorner(tri(), "box-tl", { x: 50, y: 25 }, false);
    expect(elementBBox(scaled)).toEqual({ x: 50, y: 25, width: 50, height: 25 });
  });

  test("uniform keeps the proportions, taking the larger stretch", () => {
    const scaled = scaleByCorner(tri(), "box-br", { x: 200, y: 60 }, true);
    expect(elementBBox(scaled)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  test("a flat shape keeps its missing side", () => {
    const flat = createPolygon([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
    const scaled = scaleByCorner(flat, "box-br", { x: 50, y: 99 }, false);
    expect(elementBBox(scaled)).toEqual({ x: 0, y: 10, width: 50, height: 0 });
  });
});
