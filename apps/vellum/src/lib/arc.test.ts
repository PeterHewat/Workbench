import { describe, expect, test } from "bun:test";
import { arcToCubics } from "./arc.js";

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
