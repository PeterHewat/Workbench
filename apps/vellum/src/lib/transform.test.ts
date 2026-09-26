import { describe, expect, test } from "bun:test";
import { createEllipse, createRect, createText, elementBBox } from "./model.js";
import {
  applyMatrix,
  isAxisAligned,
  parseTransform,
  scaleAbout,
  transformElement,
} from "./transform.js";

const round = (n: number) => Math.round(n * 1000) / 1000;

describe("parseTransform", () => {
  test("translate", () => {
    expect(applyMatrix(parseTransform("translate(10 5)"), { x: 1, y: 2 })).toEqual({
      x: 11,
      y: 7,
    });
  });

  test("translate with one argument leaves y alone", () => {
    expect(applyMatrix(parseTransform("translate(10)"), { x: 1, y: 2 })).toEqual({ x: 11, y: 2 });
  });

  test("scale with one argument is uniform", () => {
    expect(applyMatrix(parseTransform("scale(2)"), { x: 3, y: 4 })).toEqual({ x: 6, y: 8 });
  });

  test("rotate about a centre", () => {
    const p = applyMatrix(parseTransform("rotate(90 10 10)"), { x: 20, y: 10 });
    expect([round(p.x), round(p.y)]).toEqual([10, 20]);
  });

  test("a list applies left to right", () => {
    const p = applyMatrix(parseTransform("translate(10 0) scale(2)"), { x: 1, y: 1 });
    expect([round(p.x), round(p.y)]).toEqual([12, 2]);
  });

  test("an unknown function is skipped rather than throwing", () => {
    expect(isAxisAligned(parseTransform("nonsense(3) translate(1 1)"))).toBe(true);
  });
});

describe("transformElement", () => {
  test("a scaled rect stays a rect", () => {
    const out = transformElement(createRect(10, 20, 30, 40), parseTransform("scale(2)"));
    expect(out).toMatchObject({ type: "rect", x: 20, y: 40, width: 60, height: 80 });
  });

  test("a rotated rect stays a rect, carrying the angle", () => {
    const out = transformElement(createRect(0, 0, 10, 10), parseTransform("rotate(30)"));
    expect(out.type).toBe("rect");
    expect(Math.round(out.rotation ?? 0)).toBe(30);
  });

  test("a sheared rect cannot stay one, so it becomes a path", () => {
    const out = transformElement(createRect(0, 0, 10, 10), parseTransform("skewX(20)"));
    expect(out.type).toBe("path");
  });

  test("a rotated then non-uniformly scaled rect also becomes a path", () => {
    const out = transformElement(createRect(0, 0, 10, 10), parseTransform("rotate(30) scale(2 1)"));
    expect(out.type).toBe("path");
  });

  test("a uniformly scaled circle stays a circle", () => {
    const out = transformElement(createEllipse(5, 5, 3, 3), parseTransform("scale(2)"));
    expect(out).toMatchObject({ type: "ellipse", cx: 10, cy: 10, rx: 6, ry: 6 });
  });

  test("text keeps its anchor and picks up the rotation and scale", () => {
    const out = transformElement(
      createText(10, 10, "hi"),
      parseTransform("translate(5 0) rotate(90) scale(2)")
    );
    expect(out.type).toBe("text");
    if (out.type !== "text") return;
    expect(round(out.rotation ?? 0)).toBe(90);
    expect(out.fontSize).toBe(createText(0, 0, "hi").fontSize * 2);
  });
});

describe("stretching a turned shape", () => {
  test("a rotated rect stretched along the artboard's axes becomes a path of that outline", () => {
    const r = createRect(0, 0, 10, 10);
    r.rotation = 45;
    const out = transformElement(r, scaleAbout(2, 1, 5, 5));
    expect(out.type).toBe("path");
    const box = elementBBox(out)!;
    // The diamond is 14.14 across; twice as wide, the same height.
    expect(box.width).toBeCloseTo(20 * Math.SQRT1_2 * 2, 5);
    expect(box.height).toBeCloseTo(10 * Math.SQRT2, 5);
  });
});
