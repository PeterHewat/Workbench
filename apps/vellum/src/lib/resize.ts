import { getState } from "./state.js";
import { elementBBox, translateElement, localBBox, toLocalPoint, toWorldPoint } from "./model.js";
import { scaleAbout, transformElement } from "./transform.js";
import { cornerHandleInset } from "./pointer.js";
import { dist } from "./utils.js";
import { type BBox, type Point, type SceneElement } from "./types.js";
import { pointIndexForRole } from "./ops.js";

/**
 * Puts the corner that a resize is supposed to hold still back where it was. Resizing changes
 * the shape's centre, and a stored rotation turns about that centre, so without this the
 * anchored corner of a rotated shape slides while it is dragged.
 */
function reanchor(el: SceneElement, base: SceneElement, anchorLocal: Point): void {
  if (!el.rotation) return;
  const want = toWorldPoint(base, anchorLocal);
  const now = toWorldPoint(el, anchorLocal);
  translateElement(el, want.x - now.x, want.y - now.y);
}

/** The box roles, one per corner of a shape's bounding box. */
export const BOX_ROLES = ["box-tl", "box-tr", "box-bl", "box-br"] as const;

/**
 * Whether a shape is sized by box handles: the shapes whose only handles are their own points,
 * so without these a width or a height could only be typed.
 */
export function hasBoxHandles(el: SceneElement): boolean {
  if (el.type !== "path" && el.type !== "polyline" && el.type !== "polygon") return false;
  const box = elementBBox(el);
  return !!box && (box.width > 0 || box.height > 0);
}

/** The corner of the bounding box a box role names, and the corner opposite it. */
export function boxCorners(box: BBox, role: string): { corner: Point; fixed: Point } {
  const left = role === "box-tl" || role === "box-bl";
  const top = role === "box-tl" || role === "box-tr";
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
 * Scales `base` so the dragged corner of its bounding box lands on `at` while the opposite one
 * stays put. `uniform` keeps the proportions. A side with no extent (a vertical line's width)
 * stays as it is; dragging past the fixed corner mirrors the shape, as it would on paper.
 */
export function scaleByCorner(
  base: SceneElement,
  role: string,
  at: Point,
  uniform: boolean
): SceneElement {
  const box = elementBBox(base);
  if (!box) return base;
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
  return transformElement(base, scaleAbout(sx, sy, fixed.x, fixed.y));
}

export function applyResize(
  el: SceneElement,
  role: string,
  rawWorld: Point,
  base: SceneElement,
  alt: boolean,
  shift = false
): void {
  // Geometry lives in the shape's own unrotated frame, so the pointer is taken there first
  // and the result is turned back. Without this, dragging a corner of a rotated rect would
  // resize it along the artboard's axes rather than its own.
  const world = el.rotation ? toLocalPoint(base, rawWorld) : rawWorld;
  if (role === "grad-from" || role === "grad-to") {
    const box = localBBox(el);
    if (!box) return;
    // Back into fractions of the bounding box, which is how the gradient is stored.
    const point = {
      x: (world.x - box.x) / (box.width || 1),
      y: (world.y - box.y) / (box.height || 1),
    };
    if (role === "grad-from") el.gradFrom = point;
    else el.gradTo = point;
    return;
  }
  if (role.startsWith("box-")) {
    const scaled = scaleByCorner(base, role, rawWorld, shift);
    if ("points" in el && "points" in scaled) el.points = scaled.points;
    return;
  }
  switch (el.type) {
    case "rect": {
      if (base.type !== "rect") return;
      if (role === "uniform") {
        // The top-left corner stays put and the rect stays square. The handle rides on the
        // diagonal a fixed distance outside the bottom-right corner, so the side is the
        // pointer's distance along that diagonal less the offset. Taking the larger of the two
        // axes instead made the rect jump, most visibly once it was rotated.
        const off = cornerHandleInset() / getState().viewport.zoom;
        const along = (world.x - base.x + (world.y - base.y)) / 2;
        const side = Math.max(0.5, along - off);
        // Start from the press-time corner: the last move's re-anchoring shifted el.x/el.y, and
        // anchoring against that drifted the shape a little further on every move.
        el.x = base.x;
        el.y = base.y;
        el.width = side;
        el.height = side;
        reanchor(el, base, { x: base.x, y: base.y });
        break;
      }
      if (role === "corner") {
        const off = cornerHandleInset() / getState().viewport.zoom;
        const rx = Math.min(Math.max(el.x + el.width - off - world.x, 0), el.width / 2);
        const ry = Math.min(Math.max(world.y - el.y - off, 0), el.height / 2);
        if (alt) {
          el.rx = rx;
          el.ry = ry;
        } else {
          el.rx = Math.max(rx, ry);
          delete el.ry;
        }
        break;
      }
      // The corner opposite the one being dragged stays put.
      const fixedX = role === "tl" || role === "bl" ? base.x + base.width : base.x;
      const fixedY = role === "tl" || role === "tr" ? base.y + base.height : base.y;
      el.x = Math.min(fixedX, world.x);
      el.y = Math.min(fixedY, world.y);
      el.width = Math.abs(world.x - fixedX);
      el.height = Math.abs(world.y - fixedY);
      reanchor(el, base, { x: fixedX, y: fixedY });
      break;
    }
    case "circle":
      el.r = Math.max(0.5, dist({ x: el.cx, y: el.cy }, world));
      break;
    case "ellipse": {
      if (role === "uniform") {
        // Both radii follow the diagonal together: a circle without holding anything down.
        const d = Math.SQRT1_2;
        const r = Math.max(0.5, (Math.abs(world.x - el.cx) + Math.abs(world.y - el.cy)) / 2 / d);
        el.rx = r;
        el.ry = r;
        break;
      }
      if (role === "rx") el.rx = Math.max(0.5, Math.abs(world.x - el.cx));
      else el.ry = Math.max(0.5, Math.abs(world.y - el.cy));
      break;
    }
    case "line":
      if (role === "p1") {
        el.x1 = world.x;
        el.y1 = world.y;
      } else {
        el.x2 = world.x;
        el.y2 = world.y;
      }
      break;
    case "polyline":
    case "polygon": {
      const idx = pointIndexForRole(role);
      const pt = idx == null ? undefined : el.points[idx];
      if (pt) {
        pt.x = world.x;
        pt.y = world.y;
      }
      break;
    }
  }
}
