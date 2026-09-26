/**
 * Moving, stretching and turning several shapes as one - a group, or any selection of more than
 * one shape.
 *
 * A group stores nothing but its members' shared id, so none of this is kept on the group: each
 * change is baked into the members' own coordinates, as the X/Y/W/H fields already do for a
 * single shape. The file stays plain SVG with no `<g transform>`, and editing a member afterwards
 * works on the coordinates you see. What that costs: an angle is a turn by so many degrees, not
 * a stored value; a rotated rect or ellipse stretched off its own axes becomes a path, and a
 * circle stretched unevenly an ellipse; stroke widths stay as they are.
 */

import { elementBBox, rotateElementCopy, translateElement } from "./model.js";
import { scaleAbout, transformElement } from "./transform.js";
import type { BBox, Point, SceneElement } from "./types.js";

/** The box around every one of `elements`, or null when none has any extent. */
export function unionBox(elements: readonly SceneElement[]): BBox | null {
  let box: BBox | null = null;
  for (const el of elements) {
    const b = elementBBox(el);
    if (!b) continue;
    if (!box) {
      box = { ...b };
      continue;
    }
    const x = Math.min(box.x, b.x);
    const y = Math.min(box.y, b.y);
    box = {
      x,
      y,
      width: Math.max(box.x + box.width, b.x + b.width) - x,
      height: Math.max(box.y + box.height, b.y + b.height) - y,
    };
  }
  return box;
}

/** Every element moved by (dx, dy), as fresh copies. */
export function translateAll(
  elements: readonly SceneElement[],
  dx: number,
  dy: number
): SceneElement[] {
  return elements.map((el) => {
    const next = structuredClone(el);
    translateElement(next, dx, dy);
    return next;
  });
}

/** Every element scaled by (sx, sy) about (ox, oy). */
export function scaleAll(
  elements: readonly SceneElement[],
  sx: number,
  sy: number,
  ox: number,
  oy: number
): SceneElement[] {
  const m = scaleAbout(sx, sy, ox, oy);
  return elements.map((el) => transformElement(el, m));
}

/** Every element turned by `deg` degrees clockwise about (cx, cy). */
export function rotateAll(
  elements: readonly SceneElement[],
  deg: number,
  cx: number,
  cy: number
): SceneElement[] {
  const angle = (deg * Math.PI) / 180;
  return elements.map((el) => {
    const next = rotateElementCopy(el, angle, cx, cy);
    // A circle looks the same at any angle: only its centre moves.
    if (next.type === "circle") delete next.rotation;
    return next;
  });
}

/** The box roles, one per corner of a bounding box. */
export const BOX_ROLES = ["box-tl", "box-tr", "box-bl", "box-br"] as const;

/** The corner of `box` a box role names, and the corner opposite it. */
export function boxCorners(box: BBox, role: string): { corner: Point; fixed: Point } {
  const left = role.endsWith("-tl") || role.endsWith("-bl");
  const top = role.endsWith("-tl") || role.endsWith("-tr");
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  return {
    corner: { x: left ? x0 : x1, y: top ? y0 : y1 },
    fixed: { x: left ? x1 : x0, y: top ? y1 : y0 },
  };
}

/**
 * Scales `elements` so the dragged corner of their shared box lands on `at` while the opposite
 * corner stays put. `uniform` keeps the proportions. A side with no extent (a vertical line's
 * width) stays as it is; dragging past the fixed corner mirrors them, as it would on paper.
 */
export function scaleAllByCorner(
  elements: readonly SceneElement[],
  role: string,
  at: Point,
  uniform: boolean
): SceneElement[] {
  const box = unionBox(elements);
  if (!box) return [...elements];
  const { corner, fixed } = boxCorners(box, role);
  const ratio = (to: number, from: number, pivot: number) =>
    from === pivot ? null : (to - pivot) / (from - pivot);
  let sx = ratio(at.x, corner.x, fixed.x);
  let sy = ratio(at.y, corner.y, fixed.y);
  if (uniform || sx == null || sy == null) {
    const s = Math.max(Math.abs(sx ?? 0), Math.abs(sy ?? 0));
    sx = sx == null ? 1 : Math.sign(sx || 1) * s;
    sy = sy == null ? 1 : Math.sign(sy || 1) * s;
  }
  // A shape squashed flat cannot be scaled back out of it.
  const tiny = 1e-3;
  if (Math.abs(sx) < tiny) sx = Math.sign(sx || 1) * tiny;
  if (Math.abs(sy) < tiny) sy = Math.sign(sy || 1) * tiny;
  return scaleAll(elements, sx, sy, fixed.x, fixed.y);
}

/**
 * The elements with one edge of their shared box set to a typed value: X or Y moves them, W or
 * H stretches them from the top-left corner. Null when the value changes nothing or cannot apply
 * (a width for a selection with none).
 */
export function setBoxField(
  elements: readonly SceneElement[],
  field: "x" | "y" | "width" | "height",
  value: number
): SceneElement[] | null {
  const box = unionBox(elements);
  if (!box || !Number.isFinite(value)) return null;
  if (field === "x" || field === "y") {
    const d = value - box[field];
    if (!d) return null;
    return translateAll(elements, field === "x" ? d : 0, field === "y" ? d : 0);
  }
  const from = box[field];
  if (from <= 0 || value <= 0 || value === from) return null;
  const f = value / from;
  return field === "width"
    ? scaleAll(elements, f, 1, box.x, box.y)
    : scaleAll(elements, 1, f, box.x, box.y);
}
