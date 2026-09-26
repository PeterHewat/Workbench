import { describe, expect, test } from "bun:test";
import { pngSize } from "./png-export.js";

describe("PNG size", () => {
  test("is the artboard's, in whole pixels", () => {
    expect(pngSize({ width: 512, height: 320 })).toEqual({ width: 512, height: 320 });
    expect(pngSize({ width: 24.4, height: 23.6 })).toEqual({ width: 24, height: 24 });
  });

  test("never less than one pixel either way", () => {
    expect(pngSize({ width: 0.2, height: 0 })).toEqual({ width: 1, height: 1 });
  });
});
