import { describe, expect, test } from "bun:test";
import { arcToCubics, createArcPath } from "./arc.js";

const round = (n: number) => Math.round(n * 100) / 100;

describe("arcToCubics", () => {
  test("a half circle is split into quarter-turn pieces that end where asked", () => {
    const segs = arcToCubics({ x: 0, y: 50 }, 50, 50, 0, false, true, { x: 100, y: 50 });
    expect(segs).toHaveLength(2);
    expect(segs[segs.length - 1]!.to).toEqual({ x: 100, y: 50 });
  });

  test("the sweep flag picks which side the arc bulges", () => {
    const up = arcToCubics({ x: 0, y: 0 }, 50, 50, 0, false, true, { x: 100, y: 0 });
    const down = arcToCubics({ x: 0, y: 0 }, 50, 50, 0, false, false, { x: 100, y: 0 });
    expect(Math.sign(up[0]!.c1.y)).toBe(-Math.sign(down[0]!.c1.y));
  });

  test("radii too small for the endpoints are scaled up rather than failing", () => {
    const segs = arcToCubics({ x: 0, y: 0 }, 1, 1, 0, false, true, { x: 100, y: 0 });
    expect(segs[segs.length - 1]!.to).toEqual({ x: 100, y: 0 });
  });

  test("a zero radius degenerates to a straight line", () => {
    expect(arcToCubics({ x: 0, y: 0 }, 0, 0, 0, false, true, { x: 10, y: 10 })).toHaveLength(1);
  });
});

describe("createArcPath", () => {
  test("a quarter-turn arc is one open two-point curve", () => {
    const arc = createArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 90, true)!;
    expect(arc.type).toBe("path");
    expect(arc.closed).toBe(false);
    expect(arc.points).toHaveLength(2);
    expect(arc.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(arc.points[1]).toMatchObject({ x: 100, y: 0 });
  });

  test("its midpoint bulges by the sagitta a quarter turn implies", () => {
    const arc = createArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 90, true)!;
    // r = chord / (2 sin45) = 70.71; sagitta = r - r cos45 = 20.71.
    const c1 = arc.points[0]!.hOut!;
    expect(round(Math.abs(c1.y))).toBeGreaterThan(0);
    expect(round(Math.abs(c1.y))).toBeLessThan(30);
  });

  test("two points in the same place make no arc at all", () => {
    expect(createArcPath({ x: 5, y: 5 }, { x: 5, y: 5 }, 90, true)).toBeNull();
  });
});
