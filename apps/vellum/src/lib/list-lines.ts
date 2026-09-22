/**
 * The Primitives list as a flat run of lines, and which of them are on screen.
 *
 * The list is a tree - groups hold shapes and other groups - but only the lines in view are
 * built, so it is laid out flat: one line per group head and per shape, each knowing which
 * group brackets run down its left edge. A document of a thousand shapes then costs a few dozen
 * rows to draw instead of a thousand, which is what made selecting a shape take most of a second.
 */

import { childBlocks, groupsOf, type Block } from "./groups.js";
import type { SceneElement } from "./types.js";

/** One group bracket passing a line: whether the bracket starts or ends on this line. */
export interface Rail {
  gid: string;
  first: boolean;
  last: boolean;
}

export type ListLine =
  | { kind: "group"; key: string; gid: string; rails: Rail[] }
  | { kind: "row"; key: string; index: number; rails: Rail[] };

/**
 * The lines in display order: back to front, as a layers panel reads, so the shape drawn last
 * heads the list. A group's head comes first inside its own bracket; a folded group is its head
 * alone. `rails` are the enclosing brackets, outermost first - for a head, its own is the last.
 */
export function flattenLines(
  elements: readonly SceneElement[],
  collapsed: ReadonlySet<string>
): ListLine[] {
  const out: { line: ListLine; chain: string[] }[] = [];
  const walk = (range: Block, depth: number, chain: string[]) => {
    for (const block of childBlocks(elements, range, depth).reverse()) {
      const gid = groupsOf(elements[block.start])[depth];
      if (gid == null) {
        const el = elements[block.start]!;
        out.push({
          line: { kind: "row", key: `e:${el.id}`, index: block.start, rails: [] },
          chain,
        });
        continue;
      }
      const inner = [...chain, gid];
      out.push({ line: { kind: "group", key: `g:${gid}`, gid, rails: [] }, chain: inner });
      if (!collapsed.has(gid)) walk(block, depth + 1, inner);
    }
  };
  walk({ start: 0, end: elements.length }, 0, []);

  // A bracket starts on the line where it first appears and ends where the next line leaves it.
  return out.map(({ line, chain }, i) => {
    const prev = out[i - 1]?.chain ?? [];
    const next = out[i + 1]?.chain ?? [];
    line.rails = chain.map((gid, d) => ({
      gid,
      first: prev[d] !== gid,
      last: next[d] !== gid,
    }));
    return line;
  });
}

/** Where each line starts, from the heights of the lines: `offsets[i]`, and the total last. */
export function lineOffsets(heights: readonly number[]): number[] {
  const offsets = [0];
  for (const h of heights) offsets.push(offsets[offsets.length - 1]! + h);
  return offsets;
}

/**
 * The lines that overlap `[top, bottom)`, widened by `overscan` pixels each way so a short
 * scroll does not show an empty strip before the next render. `end` is exclusive.
 */
export function visibleRange(
  offsets: readonly number[],
  top: number,
  bottom: number,
  overscan: number
): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  // The first line whose end lies below the top edge, and the first that starts past the bottom.
  const firstEndingAfter = (y: number) => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1]! <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const firstStartingAt = (y: number) => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid]! < y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    start: firstEndingAfter(top - overscan),
    end: Math.max(firstEndingAfter(top - overscan), firstStartingAt(bottom + overscan)),
  };
}
