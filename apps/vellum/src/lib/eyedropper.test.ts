import { describe, expect, test } from "bun:test";
import { toImagePixel } from "./eyedropper.js";
import { createImage } from "./model.js";

describe("finding the pixel under a point", () => {
  test("undoes the image's position, turn and scale", () => {
    const img = {
      ...createImage("data:,", "a.png"),
      x: 100,
      y: 50,
      scaleX: 2,
      scaleY: 4,
      rotation: 90,
    };
    // The image's pixel (10, 5) is drawn scaled to (20, 20), turned a quarter to (-20, 20),
    // then moved to (80, 70).
    const p = toImagePixel(img, { x: 80, y: 70 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(5);
  });
});
