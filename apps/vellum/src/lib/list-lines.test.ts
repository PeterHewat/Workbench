import { describe, expect, test } from "bun:test";
import { createRect } from "./model.js";
import { flattenLines, lineOffsets, visibleRange, type ListLine } from "./list-lines.js";
import type { SceneElement } from "./types.js";

/** A rect named `id`, in the given groups (outermost first). */
function el(id: string, ...groups: string[]): SceneElement {
  const rect = createRect(0, 0, 1, 1);
  rect.id = id;
  if (groups.length) rect.groups = groups;
  return rect;
}

const keys = (lines: readonly ListLine[]) => lines.map((l) => l.key).join(" ");
const rails = (line: ListLine) =>
  line.rails.map((r) => `${r.gid}${r.first ? "^" : ""}${r.last ? "$" : ""}`).join(",");

describe("flattenLines", () => {
  test("back to front, a group's head before its members", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1"), el("d")];
    expect(keys(flattenLines(list, new Set()))).toBe("e:d g:g1 e:c e:b e:a");
  });

  test("a bracket starts on the head and ends on the group's last line", () => {
    const lines = flattenLines([el("a"), el("b", "g1"), el("c", "g1")], new Set());
    expect(lines.map(rails)).toEqual(["g1^", "g1", "g1$", ""]);
  });

  test("nested brackets run inside the outer one", () => {
    const list = [el("a", "g1"), el("b", "g1", "g2"), el("c", "g1", "g2")];
    const lines = flattenLines(list, new Set());
    expect(keys(lines)).toBe("g:g1 g:g2 e:c e:b e:a");
    expect(lines.map(rails)).toEqual(["g1^", "g1,g2^", "g1,g2", "g1,g2$", "g1$"]);
  });

  test("a folded group is its head alone, bracket and all", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1")];
    const lines = flattenLines(list, new Set(["g1"]));
    expect(keys(lines)).toBe("g:g1 e:a");
    expect(rails(lines[0]!)).toBe("g1^$");
  });

  test("two groups side by side get brackets of their own", () => {
    const list = [el("a", "g1"), el("b", "g1"), el("c", "g2"), el("d", "g2")];
    const lines = flattenLines(list, new Set());
    expect(lines.map(rails)).toEqual(["g2^", "g2", "g2$", "g1^", "g1", "g1$"]);
  });

  test("rows point back at their element", () => {
    const lines = flattenLines([el("a"), el("b")], new Set());
    expect(lines.map((l) => (l.kind === "row" ? l.index : -1))).toEqual([1, 0]);
  });
});

describe("visibleRange", () => {
  const offsets = lineOffsets([10, 10, 10, 10, 10]); // 0 10 20 30 40 50

  test("the lines overlapping the window", () => {
    expect(visibleRange(offsets, 15, 35, 0)).toEqual({ start: 1, end: 4 });
    expect(visibleRange(offsets, 10, 20, 0)).toEqual({ start: 1, end: 2 });
  });

  test("overscan widens it, clamped to the list", () => {
    expect(visibleRange(offsets, 15, 35, 10)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(offsets, -100, 1000, 0)).toEqual({ start: 0, end: 5 });
  });

  test("a window past either end holds nothing", () => {
    expect(visibleRange(offsets, 60, 90, 0)).toEqual({ start: 5, end: 5 });
    expect(visibleRange(offsets, -30, -10, 0)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(lineOffsets([]), 0, 100, 0)).toEqual({ start: 0, end: 0 });
  });

  test("uneven heights, as an expanded row makes", () => {
    const uneven = lineOffsets([10, 200, 10]); // 0 10 210 220
    expect(visibleRange(uneven, 50, 60, 0)).toEqual({ start: 1, end: 2 });
  });
});
