import { describe, expect, test } from "bun:test";
import { boxToGuides, movedGuide, nearestGuide, withGuide } from "./guides.js";

describe("guides", () => {
  test("a value lands on the nearest guide in reach, and on none out of it", () => {
    expect(nearestGuide(52, [10, 50, 55], 4)).toBe(50);
    expect(nearestGuide(30, [10, 50], 4)).toBeNull();
  });

  test("a box lines up its nearest edge or centre with a guide", () => {
    const guides = { x: [100], y: [48] };
    // Right edge at 98 is 2 from the guide; the top at 50 is 2 below the other.
    expect(boxToGuides({ x: 58, y: 50, width: 40, height: 20 }, guides, 4)).toEqual({
      dx: 2,
      dy: -2,
    });
    // Its centre, not an edge, is nearest.
    expect(boxToGuides({ x: 79, y: 0, width: 40, height: 0 }, { x: [100], y: [] }, 4).dx).toBe(1);
  });

  test("adding, moving and taking away", () => {
    const g = withGuide({ x: [], y: [5] }, "x", 20);
    expect(g).toEqual({ x: [20], y: [5] });
    expect(movedGuide(g, "y", 0, 9)).toEqual({ x: [20], y: [9] });
    expect(movedGuide(g, "x", 0, null)).toEqual({ x: [], y: [5] });
  });
});
