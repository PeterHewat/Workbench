/**
 * Guides: lines dragged out of the rulers to line things up against. A vertical one comes out
 * of the left ruler and sits at an x; a horizontal one comes out of the top ruler and sits at a
 * y. They belong to the document, like the grid, and are never exported.
 *
 * A point being drawn or dragged lands on a guide it comes near, and a shape being moved lines
 * its edges or centre up with one, whenever snapping is on. Dragging a guide back onto its ruler,
 * or double-clicking it, takes it away.
 */

import type { BBox, Guides } from "./types.js";

export type GuideAxis = "x" | "y";

/** The guide nearest `value` within `tol`, or null. */
export function nearestGuide(value: number, at: readonly number[], tol: number): number | null {
  let best: number | null = null;
  let bestD = tol;
  for (const g of at) {
    const d = Math.abs(g - value);
    if (d <= bestD) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

/**
 * The move that puts a box's nearest edge or centre on a guide, on each axis, when one is within
 * `tol`; zero on an axis with none in reach.
 */
export function boxToGuides(box: BBox, guides: Guides, tol: number): { dx: number; dy: number } {
  const along = (lines: readonly number[], lo: number, size: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (const edge of [lo, lo + size / 2, lo + size]) {
      const g = nearestGuide(edge, lines, tol);
      if (g != null && Math.abs(g - edge) < bestD) {
        best = g - edge;
        bestD = Math.abs(best);
      }
    }
    return best;
  };
  return { dx: along(guides.x, box.x, box.width), dy: along(guides.y, box.y, box.height) };
}

/** `guides` with one more on `axis`, at `at`. */
export function withGuide(guides: Guides, axis: GuideAxis, at: number): Guides {
  return { ...guides, [axis]: [...guides[axis], at] };
}

/** `guides` with guide `index` on `axis` moved to `at`, or taken away when `at` is null. */
export function movedGuide(
  guides: Guides,
  axis: GuideAxis,
  index: number,
  at: number | null
): Guides {
  const list = [...guides[axis]];
  if (at == null) list.splice(index, 1);
  else list[index] = at;
  return { ...guides, [axis]: list };
}
