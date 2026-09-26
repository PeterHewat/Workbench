import { describe, expect, test } from "bun:test";
import { pngSize } from "./png-export.js";

describe("PNG size", () => {
  test("keeps the artboard's proportions", () => {
    expect(pngSize({ width: 512, height: 320 }, 64)).toEqual({ width: 64, height: 40 });
    expect(pngSize({ width: 512, height: 512 }, 32.4)).toEqual({ width: 32, height: 32 });
  });

  test("never less than one pixel either way", () => {
    expect(pngSize({ width: 1000, height: 1 }, 10)).toEqual({ width: 10, height: 1 });
    expect(pngSize({ width: 10, height: 10 }, 0)).toEqual({ width: 1, height: 1 });
  });
});
