import { describe, expect, test } from "bun:test";
import {
  cleanTags,
  docStats,
  findRanges,
  markHtml,
  matchesSearch,
  searchWords,
  sizeText,
  statsText,
  tagsHit,
} from "./doc-list.js";
import { createLine, createPath, createRect } from "./model.js";
import type { Anchor } from "./types.js";

const anchor = (x: number, y: number) => ({ x, y, smooth: false, hIn: null, hOut: null }) as Anchor;

describe("tags", () => {
  test("typed with commas: trimmed, spaced once, no empties or repeats", () => {
    expect(cleanTags(" icons,  Arrows  left ,, icons, ARROWS left ")).toEqual([
      "icons",
      "Arrows left",
    ]);
  });

  test("read from a file: only strings, clipped", () => {
    expect(cleanTags(["a", 3, null, "b".repeat(40)])).toEqual(["a", "b".repeat(32)]);
    expect(cleanTags({ tags: "a" })).toEqual([]);
  });
});

describe("stats", () => {
  test("count shapes, groups, points and images", () => {
    const rect = createRect(0, 0, 10, 10);
    const path = createPath([anchor(0, 0), anchor(10, 0), anchor(10, 10)], true);
    const line = createLine(0, 0, 5, 5);
    rect.groups = ["g1"];
    path.groups = ["g1", "g2"];
    const s = docStats({
      elements: [rect, path, line],
      images: [],
      artboard: { width: 512, height: 320 },
    });
    expect(s).toEqual({ shapes: 3, groups: 2, points: 5, images: 0, width: 512, height: 320 });
    expect(statsText(s)).toBe("3 shapes · 2 groups · 5 points · 512 × 320");
  });

  test("an empty document", () => {
    expect(
      statsText(docStats({ elements: [], images: [], artboard: { width: 64, height: 64 } }))
    ).toBe("0 shapes · 64 × 64");
  });
});

describe("file size", () => {
  test("bytes, then kilobytes and megabytes to one decimal", () => {
    expect(sizeText(850)).toBe("850B");
    expect(sizeText(6861)).toBe("6.7KB");
    expect(sizeText(2048)).toBe("2KB");
    expect(sizeText(3 * 1024 * 1024)).toBe("3MB");
  });
});

describe("search", () => {
  const doc = { name: "Arrow set", tags: ["icons", "Navigation"] };

  test("every word is found in the name or a tag, ignoring case", () => {
    expect(matchesSearch(doc, "")).toBe(true);
    expect(matchesSearch(doc, "arr")).toBe(true);
    expect(matchesSearch(doc, "NAV")).toBe(true);
    expect(matchesSearch(doc, "arrow icons")).toBe(true);
    expect(matchesSearch(doc, "arrow logo")).toBe(false);
  });

  test("commas separate alternatives", () => {
    expect(matchesSearch(doc, "logo, nav")).toBe(true);
    expect(matchesSearch(doc, "logo, brand")).toBe(false);
    expect(matchesSearch(doc, "logo,")).toBe(false);
    expect(matchesSearch(doc, " , ")).toBe(true);
    expect(searchWords("Arrow icons, arrow")).toEqual(["arrow", "icons"]);
  });

  test("found stretches are merged and marked, the rest escaped", () => {
    expect(findRanges("Arrow arrowhead", ["arrow", "rowh"])).toEqual([
      [0, 5],
      [6, 12],
    ]);
    expect(markHtml("A<b> arrow", ["arrow"])).toBe("A&lt;b&gt; <mark>arrow</mark>");
    expect(tagsHit(["icons", "Navigation"], ["nav"])).toEqual(["Navigation"]);
  });
});
