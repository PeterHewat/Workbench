/**
 * Align and distribute.
 *
 * What moves is the selection's blocks, not its shapes one by one: a group selected whole moves
 * as one, keeping its own layout, and a shape on its own is a block of one. Several blocks line
 * up with the box they share; a single one lines up with the artboard, which is how an icon is
 * centred. Picked points line up and spread the same way, one by one.
 */

import { groupsOf, selectionContext } from "./groups.js";
import { hasPoint, translatePoint } from "./model.js";
import { translateAll, unionBox } from "./selection-transform.js";
import { byShape } from "./points.js";
import { deepClone } from "./utils.js";
import type { BBox, PointRef, SceneElement } from "./types.js";

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type Axis = "x" | "y";

/** The selection's blocks: each group selected whole at the selection's level, or a lone shape. */
export function blocksOf(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): SceneElement[][] {
  const depth = selectionContext(elements, selected).length;
  const blocks = new Map<string, SceneElement[]>();
  for (const el of elements) {
    if (!selected.has(el.id)) continue;
    const key = groupsOf(el)[depth] ?? `el:${el.id}`;
    blocks.set(key, [...(blocks.get(key) ?? []), el]);
  }
  return [...blocks.values()];
}

/** Where `mode` puts an edge or centre of `box` against `target`: the move that lines them up. */
function shiftFor(mode: AlignMode, box: BBox, target: BBox): { dx: number; dy: number } {
  switch (mode) {
    case "left":
      return { dx: target.x - box.x, dy: 0 };
    case "right":
      return { dx: target.x + target.width - (box.x + box.width), dy: 0 };
    case "hcenter":
      return { dx: target.x + target.width / 2 - (box.x + box.width / 2), dy: 0 };
    case "top":
      return { dx: 0, dy: target.y - box.y };
    case "bottom":
      return { dx: 0, dy: target.y + target.height - (box.y + box.height) };
    case "vcenter":
      return { dx: 0, dy: target.y + target.height / 2 - (box.y + box.height / 2) };
  }
}

/**
 * The blocks lined up by `mode`: against the box they share, or, for a single block, against
 * `artboard`. Returns the moved shapes only.
 */
export function alignBlocks(
  blocks: readonly SceneElement[][],
  mode: AlignMode,
  artboard: BBox
): SceneElement[] {
  const target = blocks.length > 1 ? unionBox(blocks.flat()) : artboard;
  if (!target) return [];
  return blocks.flatMap((block) => {
    const box = unionBox(block);
    if (!box) return [];
    const { dx, dy } = shiftFor(mode, box, target);
    return dx || dy ? translateAll(block, dx, dy) : [];
  });
}

/**
 * Three or more blocks spaced evenly along `axis`: the first and last stay where they are, and
 * the ones between move so the gaps between neighbouring boxes are all the same.
 */
export function distributeBlocks(blocks: readonly SceneElement[][], axis: Axis): SceneElement[] {
  const boxed = blocks
    .map((block) => ({ block, box: unionBox(block) }))
    .filter((b): b is { block: SceneElement[]; box: BBox } => !!b.box);
  if (boxed.length < 3) return [];
  const start = (b: BBox) => (axis === "x" ? b.x : b.y);
  const size = (b: BBox) => (axis === "x" ? b.width : b.height);
  boxed.sort((a, b) => start(a.box) + size(a.box) / 2 - (start(b.box) + size(b.box) / 2));
  const first = boxed[0]!.box;
  const last = boxed[boxed.length - 1]!.box;
  const span = start(last) + size(last) - start(first);
  const filled = boxed.reduce((sum, b) => sum + size(b.box), 0);
  const gap = (span - filled) / (boxed.length - 1);
  const out: SceneElement[] = [];
  let at = start(first) + size(first) + gap;
  for (const { block, box } of boxed.slice(1, -1)) {
    const d = at - start(box);
    if (d) out.push(...translateAll(block, axis === "x" ? d : 0, axis === "x" ? 0 : d));
    at += size(box) + gap;
  }
  return out;
}

/** Where point `index` of a shape is. */
function pointAt(el: SceneElement, index: number): { x: number; y: number } | null {
  if (el.type === "line") return index === 0 ? { x: el.x1, y: el.y1 } : { x: el.x2, y: el.y2 };
  return "points" in el ? (el.points[index] ?? null) : null;
}

/**
 * Picked points lined up: left, centre and right set every point's x to the leftmost, the middle
 * or the rightmost of them; top, middle and bottom do the same with y. A point takes its handles
 * with it. Returns the changed shapes.
 */
export function alignPoints(
  elements: readonly SceneElement[],
  refs: readonly PointRef[],
  mode: AlignMode
): SceneElement[] {
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  const spots = refs
    .map((r) => {
      const el = byId.get(r.pathId);
      const p = el ? pointAt(el, r.index) : null;
      return p ? { ref: r, p } : null;
    })
    .filter((s): s is { ref: PointRef; p: { x: number; y: number } } => !!s);
  if (spots.length < 2) return [];
  const horizontal = mode === "left" || mode === "hcenter" || mode === "right";
  const values = spots.map((s) => (horizontal ? s.p.x : s.p.y));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const goal =
    mode === "left" || mode === "top"
      ? lo
      : mode === "right" || mode === "bottom"
        ? hi
        : (lo + hi) / 2;
  return moveEach(byId, spots, (p) =>
    horizontal ? { dx: goal - p.x, dy: 0 } : { dx: 0, dy: goal - p.y }
  );
}

/** Picked points spread evenly along `axis`, between the two furthest apart, in their order. */
export function distributePoints(
  elements: readonly SceneElement[],
  refs: readonly PointRef[],
  axis: Axis
): SceneElement[] {
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  const spots = refs
    .map((r) => {
      const el = byId.get(r.pathId);
      const p = el ? pointAt(el, r.index) : null;
      return p ? { ref: r, p: { x: p.x, y: p.y } } : null;
    })
    .filter((s): s is { ref: PointRef; p: { x: number; y: number } } => !!s);
  if (spots.length < 3) return [];
  spots.sort((a, b) => a.p[axis] - b.p[axis]);
  const lo = spots[0]!.p[axis];
  const step = (spots[spots.length - 1]!.p[axis] - lo) / (spots.length - 1);
  const goals = new Map(spots.map((s, i) => [s, lo + step * i] as const));
  return moveEach(byId, spots, (p, s) => {
    const d = goals.get(s)! - p[axis];
    return axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
  });
}

function moveEach<S extends { ref: PointRef; p: { x: number; y: number } }>(
  byId: ReadonlyMap<string, SceneElement>,
  spots: readonly S[],
  shift: (p: { x: number; y: number }, spot: S) => { dx: number; dy: number }
): SceneElement[] {
  const copies = new Map<string, SceneElement>();
  const refs = spots.map((s) => s.ref);
  for (const id of byShape(refs).keys()) {
    const el = byId.get(id);
    if (el) copies.set(id, deepClone(el));
  }
  for (const s of spots) {
    const el = copies.get(s.ref.pathId);
    if (!el || !hasPoint(el, s.ref.index)) continue;
    const { dx, dy } = shift(s.p, s);
    if (dx || dy) translatePoint(el, s.ref.index, dx, dy);
  }
  return [...copies.values()];
}
