import { describe, expect, test } from "bun:test";
import { createCircle, createRect, elementBBox } from "./model.js";
import { rotateAll, scaleAllByCorner, setBoxField, unionBox } from "./selection-transform.js";
import type { SceneElement } from "./types.js";

/** Two 10 × 10 squares, at (0, 0) and (20, 10): a shared box of 30 × 20. */
const pair = (): SceneElement[] => [createRect(0, 0, 10, 10), createRect(20, 10, 10, 10)];

const rounded = (b: ReturnType<typeof unionBox>) =>
  b && Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

describe("transforming a selection as one", () => {
  test("the shared box covers every member", () => {
    expect(unionBox(pair())).toEqual({ x: 0, y: 0, width: 30, height: 20 });
  });

  test("typed X and W move and stretch the whole box", () => {
    expect(unionBox(setBoxField(pair(), "x", 5)!)).toEqual({ x: 5, y: 0, width: 30, height: 20 });
    expect(unionBox(setBoxField(pair(), "width", 60)!)).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 20,
    });
    expect(setBoxField(pair(), "y", 0)).toBeNull();
  });

  test("a corner drag stretches from the opposite corner", () => {
    const out = scaleAllByCorner(pair(), "box-tl", { x: -30, y: 0 }, false);
    expect(unionBox(out)).toEqual({ x: -30, y: 0, width: 60, height: 20 });
  });

  test("a quarter turn swaps the box's sides about its centre", () => {
    const out = rotateAll(pair(), 90, 15, 10);
    expect(rounded(unionBox(out))).toEqual({ x: 5, y: -5, width: 20, height: 30 });
    // The squares keep their type and carry the angle.
    expect(out.every((e) => e.type === "rect" && e.rotation === 90)).toBe(true);
  });

  test("a circle only moves when turned", () => {
    const [c] = rotateAll([createCircle(10, 0, 2)], 90, 0, 0);
    expect(c!.rotation).toBeUndefined();
    expect(rounded(elementBBox(c!))).toEqual({ x: -2, y: 8, width: 4, height: 4 });
  });
});
