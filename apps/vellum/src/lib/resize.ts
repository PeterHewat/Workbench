import { getState } from "./state.js";
import { translateElement, localBBox, toLocalPoint, toWorldPoint } from "./model.js";
import { cornerHandleInset } from "./pointer.js";
import { dist } from "./utils.js";
import { type Point, type SceneElement } from "./types.js";
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

export function applyResize(
  el: SceneElement,
  role: string,
  rawWorld: Point,
  base: SceneElement,
  alt: boolean
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
