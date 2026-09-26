/**
 * Dash styles: the named patterns the Dash menu offers, worked out from the stroke so they look
 * the same on a hairline and on a thick line. A style is not stored - the document keeps only
 * the numbers (`dash`) - so it is read back by matching them against what each style gives.
 */

import type { LineCap } from "./types.js";

export type DashStyle = "solid" | "dashed" | "dotted" | "dash-dot" | "custom";

export const DASH_STYLES: readonly [DashStyle, string][] = [
  ["solid", "Solid"],
  ["dashed", "Dashed"],
  ["dotted", "Dotted"],
  ["dash-dot", "Dash-dot"],
  ["custom", "Custom"],
];

interface Stroke {
  dash?: number[];
  strokeWidth: number;
  linecap: LineCap;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The pattern of a named style. A round or square cap draws a dash of length 0 as a dot one
 * stroke wide, and stretches every dash by half a width at each end, which the gaps allow for;
 * a butt cap draws exactly the lengths, so its dots are a width long.
 */
export function dashPreset(style: DashStyle, stroke: Stroke): number[] | undefined {
  const w = Math.max(stroke.strokeWidth, 0.5);
  const butt = stroke.linecap === "butt";
  const pattern: Record<DashStyle, number[] | undefined> = {
    solid: undefined,
    custom: stroke.dash,
    dashed: [4 * w, 3 * w],
    dotted: butt ? [w, w] : [0, 2 * w],
    "dash-dot": butt ? [4 * w, 2 * w, w, 2 * w] : [4 * w, 3 * w, 0, 3 * w],
  };
  return pattern[style]?.map(round);
}

/** Which style a stroke's numbers are: a named one when they match it, else custom. */
export function dashStyleOf(stroke: Stroke): DashStyle {
  if (!stroke.dash?.length) return "solid";
  const same = (p: number[] | undefined) =>
    !!p && p.length === stroke.dash!.length && p.every((n, i) => n === stroke.dash![i]);
  for (const style of ["dashed", "dotted", "dash-dot"] as const) {
    if (same(dashPreset(style, stroke))) return style;
  }
  return "custom";
}

/**
 * After the width or the cap changed from `before`: a named style is worked out again for the new
 * stroke, so a dashed line stays dashed rather than turning into odd numbers. Custom stays as is.
 */
export function keepDashStyle<T extends Stroke>(el: T, before: Stroke): void {
  const style = dashStyleOf({ ...before, dash: el.dash });
  if (style === "solid" || style === "custom") return;
  el.dash = dashPreset(style, el);
}
