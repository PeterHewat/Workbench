/**
 * Several points picked at once: the picked point the bar sits beside (`pathEdit`) and the
 * others picked with it (`points`), moved, nudged and deleted together.
 */

import { hasPoint, translatePoint } from "./model.js";
import { deepClone } from "./utils.js";
import type { Marquee, PointRef, SceneElement, Selection } from "./types.js";

const same = (a: PointRef, b: PointRef) => a.pathId === b.pathId && a.index === b.index;

/** Every picked point, the one picked last first. */
export function pickedPoints(sel: Selection): PointRef[] {
  const out: PointRef[] = sel.pathEdit
    ? [{ pathId: sel.pathEdit.pathId, index: sel.pathEdit.index }]
    : [];
  for (const p of sel.points ?? []) if (!out.some((q) => same(p, q))) out.push(p);
  return out;
}

export function isPicked(sel: Selection, ref: PointRef): boolean {
  return pickedPoints(sel).some((p) => same(p, ref));
}

/**
 * The selection with `refs` picked, the first of them leading: the shapes they belong to stay
 * selected with whatever else was, so their points stay on show.
 */
export function pickPoints(sel: Selection, refs: readonly PointRef[]): Selection {
  const [first, ...rest] = refs;
  if (!first) return { elementIds: sel.elementIds, pathEdit: null };
  const ids = [...new Set([...sel.elementIds, ...refs.map((r) => r.pathId)])];
  const next: Selection = {
    elementIds: ids,
    pathEdit: { pathId: first.pathId, kind: "anchor", index: first.index },
  };
  if (rest.length) next.points = rest;
  return next;
}

/** The selection with `ref` added to the picked points, or taken out if it was picked. */
export function togglePoint(sel: Selection, ref: PointRef): Selection {
  const picked = pickedPoints(sel);
  if (picked.some((p) => same(p, ref)))
    return pickPoints(
      sel,
      picked.filter((p) => !same(p, ref))
    );
  return pickPoints(sel, [ref, ...picked]);
}

/** The movable points of `el`, by index: a path's, polyline's or polygon's points, a line's ends. */
function pointsOf(el: SceneElement): { index: number; x: number; y: number }[] {
  if (el.type === "line") {
    return [
      { index: 0, x: el.x1, y: el.y1 },
      { index: 1, x: el.x2, y: el.y2 },
    ];
  }
  if (el.type === "path" || el.type === "polyline" || el.type === "polygon") {
    return el.points.map((p, index) => ({ index, x: p.x, y: p.y }));
  }
  return [];
}

/** The points of the shapes `ids` inside a marquee, in document order. */
export function pointsInMarquee(
  elements: readonly SceneElement[],
  ids: ReadonlySet<string>,
  m: Marquee
): PointRef[] {
  const x1 = Math.min(m.x1, m.x2);
  const x2 = Math.max(m.x1, m.x2);
  const y1 = Math.min(m.y1, m.y2);
  const y2 = Math.max(m.y1, m.y2);
  const out: PointRef[] = [];
  for (const el of elements) {
    // A locked shape shows no points, so none of its are picked.
    if (!ids.has(el.id) || el.hidden || el.locked) continue;
    for (const p of pointsOf(el)) {
      if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2)
        out.push({ pathId: el.id, index: p.index });
    }
  }
  return out;
}

/** Picked points grouped by the shape they belong to. */
export function byShape(refs: readonly PointRef[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of refs) out.set(r.pathId, [...(out.get(r.pathId) ?? []), r.index]);
  return out;
}

/** Copies of `bases` with every point in `refs` moved by (dx, dy), and nothing else changed. */
export function movePoints(
  bases: ReadonlyMap<string, SceneElement>,
  refs: readonly PointRef[],
  dx: number,
  dy: number
): SceneElement[] {
  const out: SceneElement[] = [];
  for (const [id, indices] of byShape(refs)) {
    const base = bases.get(id);
    if (!base) continue;
    const next = deepClone(base);
    for (const i of indices) if (hasPoint(next, i)) translatePoint(next, i, dx, dy);
    out.push(next);
  }
  return out;
}

/**
 * One point picked, and no other: the shapes selected with its own stay selected, so a point on
 * any of them can be added next; a point on a shape outside the selection narrows it to that one.
 */
export function onePoint(sel: Selection, pe: NonNullable<Selection["pathEdit"]>): Selection {
  return {
    elementIds: sel.elementIds.includes(pe.pathId) ? sel.elementIds : [pe.pathId],
    pathEdit: pe,
  };
}
