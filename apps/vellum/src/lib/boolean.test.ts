import { describe, expect, test } from "bun:test";
import { combine } from "./boolean.js";
import { contours, createCircle, createPath, createRect } from "./model.js";
import type { Anchor, PathElement, SceneElement } from "./types.js";

/** The area a path encloses under the non-zero rule, from its outlines traced finely. */
function area(path: PathElement | null): number {
  if (!path) return 0;
  let total = 0;
  for (const { start, end } of contours(path)) {
    const pts = path.points.slice(start, end);
    const trace: { x: number; y: number }[] = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      const c1 = p.hOut ?? p;
      const c2 = q.hIn ?? q;
      for (let k = 0; k < 64; k++) {
        const t = k / 64;
        const u = 1 - t;
        trace.push({
          x: u * u * u * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * q.x,
          y: u * u * u * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * q.y,
        });
      }
    });
    let a = 0;
    trace.forEach((p, i) => {
      const q = trace[(i + 1) % trace.length]!;
      a += p.x * q.y - q.x * p.y;
    });
    total += a / 2;
  }
  return Math.abs(total);
}

const style = {};
const squares = (): SceneElement[] => [createRect(0, 0, 10, 10), createRect(5, 5, 10, 10)];

describe("combining two overlapping squares", () => {
  test("union covers both, once", () => {
    const out = combine(squares(), "union", style);
    expect(area(out)).toBeCloseTo(175, 6);
    // One outline, its eight corners and nothing else.
    expect(out!.subpaths).toBeUndefined();
    expect(out!.points).toHaveLength(8);
  });

  test("intersect keeps what they share", () => {
    expect(area(combine(squares(), "intersect", style))).toBeCloseTo(25, 6);
  });

  test("subtract takes the front one from the back one", () => {
    expect(area(combine(squares(), "subtract", style))).toBeCloseTo(75, 6);
  });

  test("exclude keeps what only one of them covers", () => {
    const out = combine(squares(), "exclude", style);
    expect(area(out)).toBeCloseTo(150, 6);
  });
});

describe("edge cases that icons are made of", () => {
  test("two squares sharing an edge join into one rectangle of four corners", () => {
    const out = combine([createRect(0, 0, 10, 10), createRect(10, 0, 10, 10)], "union", style);
    expect(area(out)).toBeCloseTo(200, 6);
    expect(out!.points).toHaveLength(4);
  });

  test("a hole cut in the middle is an outline of its own", () => {
    const out = combine([createRect(0, 0, 20, 20), createRect(5, 5, 10, 10)], "subtract", style);
    expect(out!.subpaths).toHaveLength(1);
    expect(area(out)).toBeCloseTo(300, 6);
  });

  test("shapes that do not meet: intersect leaves nothing, union keeps both", () => {
    const apart = [createRect(0, 0, 5, 5), createRect(10, 10, 5, 5)];
    expect(combine(apart, "intersect", style)).toBeNull();
    const out = combine(apart, "union", style);
    expect(out!.subpaths).toHaveLength(1);
    expect(area(out)).toBeCloseTo(50, 6);
  });

  test("curves stay curves: two circles make a lens of two arcs", () => {
    const out = combine([createCircle(0, 0, 10), createCircle(10, 0, 10)], "intersect", style);
    // Two sharp tips where the circles cross, and each circle's own anchor on its arc.
    expect(out!.points).toHaveLength(4);
    expect(out!.points.every((p) => p.hIn && p.hOut)).toBe(true);
    expect(out!.points.filter((p) => p.smooth)).toHaveLength(2);
    // Two circular segments of 120°: 2 × (r²/2)(θ - sin θ).
    const theta = (2 * Math.PI) / 3;
    expect(area(out)).toBeCloseTo(100 * (theta - Math.sin(theta)), 1);
  });

  test("a ring drawn even-odd counts its hole as empty", () => {
    const ring = createPath(
      [
        ...[
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        ...[
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
        ],
      ].map(([x, y]) => ({ x: x!, y: y!, smooth: false, hIn: null, hOut: null }) as Anchor),
      true
    );
    ring.subpaths = [4];
    ring.fillRule = "evenodd";
    // The square fills the ring's hole, and a union gives the whole square back.
    const out = combine([ring, createRect(5, 5, 10, 10)], "union", style);
    expect(area(out)).toBeCloseTo(400, 6);
  });
});

describe("shapes lying on each other", () => {
  test("a square joined with itself is the square, four corners and no more", () => {
    const out = combine([createRect(0, 0, 10, 10), createRect(0, 0, 10, 10)], "union", style);
    expect(area(out)).toBeCloseTo(100, 6);
    expect(out!.points).toHaveLength(4);
  });

  test("a circle joined with itself is the circle", () => {
    const out = combine([createCircle(0, 0, 10), createCircle(0, 0, 10)], "union", style);
    expect(area(out)).toBeCloseTo(Math.PI * 100, 0);
  });

  test("a square standing on another's edge joins it at a T", () => {
    const out = combine([createRect(0, 0, 20, 10), createRect(5, 10, 10, 10)], "union", style);
    expect(area(out)).toBeCloseTo(300, 6);
    expect(out!.subpaths).toBeUndefined();
    expect(out!.points).toHaveLength(8);
  });

  test("squares touching at a corner stay two shapes' worth of area", () => {
    const out = combine([createRect(0, 0, 10, 10), createRect(10, 10, 10, 10)], "union", style);
    expect(area(out)).toBeCloseTo(200, 6);
  });

  test("subtracting a shape that covers everything leaves nothing", () => {
    expect(
      combine([createRect(2, 2, 5, 5), createRect(0, 0, 10, 10)], "subtract", style)
    ).toBeNull();
  });

  test("a rounded rect keeps its rounding through a cut", () => {
    const r = createRect(0, 0, 40, 20);
    r.rx = 5;
    const out = combine([r, createRect(20, -5, 30, 30)], "subtract", style);
    const full = 40 * 20 - (4 - Math.PI) * 25;
    // The left half: the rect's area left of x = 20, two rounded corners included.
    expect(area(out)).toBeCloseTo(full / 2, 1);
    expect(out!.points.some((p) => p.hIn || p.hOut)).toBe(true);
  });
});
