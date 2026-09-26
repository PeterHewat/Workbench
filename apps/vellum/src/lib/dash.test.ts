import { describe, expect, test } from "bun:test";
import { dashPreset, dashStyleOf, keepDashStyle } from "./dash.js";

describe("dash styles", () => {
  const round = { strokeWidth: 2, linecap: "round" as const };
  const butt = { strokeWidth: 2, linecap: "butt" as const };

  test("follow the stroke's width, and its cap for dots", () => {
    expect(dashPreset("dashed", round)).toEqual([8, 6]);
    expect(dashPreset("dotted", round)).toEqual([0, 4]);
    expect(dashPreset("dotted", butt)).toEqual([2, 2]);
    expect(dashPreset("dash-dot", butt)).toEqual([8, 4, 2, 4]);
    expect(dashPreset("solid", round)).toBeUndefined();
  });

  test("are read back from the numbers", () => {
    expect(dashStyleOf(round)).toBe("solid");
    expect(dashStyleOf({ ...round, dash: [8, 6] })).toBe("dashed");
    expect(dashStyleOf({ ...round, dash: [0, 4] })).toBe("dotted");
    expect(dashStyleOf({ ...round, dash: [5, 1] })).toBe("custom");
  });

  test("a named style is kept when the width changes; custom numbers are left alone", () => {
    const dashed = { strokeWidth: 3, linecap: "round" as const, dash: [8, 6] };
    keepDashStyle(dashed, round);
    expect(dashed.dash).toEqual([12, 9]);
    const custom = { strokeWidth: 3, linecap: "round" as const, dash: [5, 1] };
    keepDashStyle(custom, round);
    expect(custom.dash).toEqual([5, 1]);
  });
});
