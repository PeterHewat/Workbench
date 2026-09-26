import { describe, expect, test } from "bun:test";
import { columnsFor } from "./actionbar.js";

describe("the bar's rows", () => {
  test("up to seven buttons stay on one row", () => {
    expect(columnsFor(1)).toBe(1);
    expect(columnsFor(7)).toBe(7);
  });

  test("a longer set splits into rows as even as can be", () => {
    expect(columnsFor(8)).toBe(4);
    expect(columnsFor(9)).toBe(5);
    expect(columnsFor(14)).toBe(7);
    expect(columnsFor(15)).toBe(5);
  });

  test("a pair stays in one row", () => {
    // Eight as four and four would end the first row between buttons 3 and 4.
    expect(columnsFor(8, 7, [3])).toBe(5);
    expect(columnsFor(8, 7, [2])).toBe(4);
    // Nothing fits in two rows without a split, so a third row it is.
    expect(columnsFor(6, 3, [2])).toBe(2);
  });
});
