import { describe, expect, test } from "bun:test";
import { alignBlocks, alignPoints, blocksOf, distributeBlocks, distributePoints } from "./align.js";
import { createPolyline, createRect, elementBBox } from "./model.js";
import type { SceneElement } from "./types.js";

const rect = (id: string, x: number, y: number, w: number, h: number, ...groups: string[]) => {
  const r = createRect(x, y, w, h);
  r.id = id;
  if (groups.length) r.groups = groups;
  return r;
};
const ARTBOARD = { x: 0, y: 0, width: 100, height: 100 };
const boxOf = (list: SceneElement[], id: string) => elementBBox(list.find((e) => e.id === id)!);

describe("aligning shapes", () => {
  test("several line up with the box they share", () => {
    const list = [rect("a", 10, 0, 10, 10), rect("b", 40, 20, 20, 10)];
    const moved = alignBlocks(blocksOf(list, new Set(["a", "b"])), "left", ARTBOARD);
    expect(boxOf(moved, "b")!.x).toBe(10);
    // Already there: not in the list of changes.
    expect(moved.find((e) => e.id === "a")).toBeUndefined();
  });

  test("one shape lines up with the artboard", () => {
    const list = [rect("a", 10, 10, 20, 20)];
    const moved = alignBlocks(blocksOf(list, new Set(["a"])), "hcenter", ARTBOARD);
    expect(boxOf(moved, "a")).toEqual({ x: 40, y: 10, width: 20, height: 20 });
  });

  test("a group selected whole moves as one block, keeping its layout", () => {
    const list = [
      rect("a", 0, 0, 10, 10, "g"),
      rect("b", 20, 0, 10, 10, "g"),
      rect("c", 50, 30, 10, 10),
    ];
    const blocks = blocksOf(list, new Set(["a", "b", "c"]));
    expect(blocks).toHaveLength(2);
    const moved = alignBlocks(blocks, "bottom", ARTBOARD);
    expect(boxOf(moved, "a")!.y).toBe(30);
    expect(boxOf(moved, "b")!.y).toBe(30);
  });
});

describe("distributing shapes", () => {
  test("the gaps between neighbours come out equal; the ends stay", () => {
    const list = [rect("a", 0, 0, 10, 10), rect("b", 15, 0, 20, 10), rect("c", 90, 0, 10, 10)];
    const moved = distributeBlocks(blocksOf(list, new Set(["a", "b", "c"])), "x");
    // 100 wide, 40 of it shapes: two gaps of 30.
    expect(boxOf(moved, "b")!.x).toBe(40);
    expect(moved).toHaveLength(1);
  });
});

describe("aligning and spreading points", () => {
  const zig = () => {
    const p = createPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 8 },
      { x: 30, y: 2 },
    ]);
    p.id = "z";
    return p;
  };
  const all = [0, 1, 2].map((index) => ({ pathId: "z", index }));

  test("top sets every picked point to the highest", () => {
    const [out] = alignPoints([zig()], all, "top");
    expect(out!.type === "polyline" && out!.points.map((p) => p.y)).toEqual([0, 0, 0]);
  });

  test("points spread evenly between the two furthest apart", () => {
    const [out] = distributePoints([zig()], all, "x");
    expect(out!.type === "polyline" && out!.points.map((p) => p.x)).toEqual([0, 15, 30]);
  });
});
