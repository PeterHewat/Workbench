import { describe, expect, test } from "bun:test";
import { createLine, createPolygon } from "./model.js";
import {
  movePoints,
  onePoint,
  pickedPoints,
  pickPoints,
  pointsInMarquee,
  togglePoint,
} from "./points.js";
import type { Selection } from "./types.js";

const tri = () => {
  const p = createPolygon([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 10 },
  ]);
  p.id = "tri";
  return p;
};
const line = () => {
  const l = createLine(20, 0, 30, 0);
  l.id = "line";
  return l;
};
const none: Selection = { elementIds: ["tri", "line"], pathEdit: null };

describe("picking several points", () => {
  test("toggling adds a point, leading, and takes it out again", () => {
    const one = pickPoints(none, [{ pathId: "tri", index: 0 }]);
    const two = togglePoint(one, { pathId: "line", index: 1 });
    expect(pickedPoints(two)).toEqual([
      { pathId: "line", index: 1 },
      { pathId: "tri", index: 0 },
    ]);
    expect(pickedPoints(togglePoint(two, { pathId: "line", index: 1 }))).toEqual([
      { pathId: "tri", index: 0 },
    ]);
  });

  test("a marquee finds the points of the selected shapes inside it", () => {
    const found = pointsInMarquee([tri(), line()], new Set(["tri", "line"]), {
      x1: -1,
      y1: -1,
      x2: 21,
      y2: 1,
    });
    expect(found).toEqual([
      { pathId: "tri", index: 0 },
      { pathId: "tri", index: 1 },
      { pathId: "line", index: 0 },
    ]);
  });

  test("moving them moves those points and no others", () => {
    const bases = new Map([
      ["tri", tri()],
      ["line", line()],
    ]);
    const moved = movePoints(
      bases,
      [
        { pathId: "tri", index: 2 },
        { pathId: "line", index: 0 },
      ],
      0,
      5
    );
    const t = moved.find((e) => e.id === "tri")!;
    const l = moved.find((e) => e.id === "line")!;
    expect(t.type === "polygon" && t.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 15 },
    ]);
    expect(l).toMatchObject({ x1: 20, y1: 5, x2: 30, y2: 0 });
  });

  test("picking one point keeps the shapes selected with it", () => {
    const sel = onePoint(none, { pathId: "tri", kind: "anchor", index: 1 });
    expect(sel.elementIds).toEqual(["tri", "line"]);
    expect(
      onePoint(
        { elementIds: ["line"], pathEdit: null },
        { pathId: "tri", kind: "anchor", index: 1 }
      ).elementIds
    ).toEqual(["tri"]);
  });
});
