import { setState, selectOnly } from "./state.js";
import { createRect, createEllipse } from "./model.js";
import { pushUndo } from "./undo.js";
import { type PathElement, type Point } from "./types.js";
import { setDrawing } from "./ops.js";

/** The tools that are drawn by dragging a shape out on the canvas. */
export type ShapeTool = "rect" | "ellipse";

/** Geometry of a rect/ellipse dragged from `start` to `end`, as SVG attributes. */
function shapeGeometry(tool: ShapeTool, start: Point, end: Point): Record<string, number> {
  if (tool === "rect") {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
  }
  return {
    cx: start.x,
    cy: start.y,
    rx: Math.abs(end.x - start.x),
    ry: Math.abs(end.y - start.y),
  };
}

export function updatePenPreview(path: PathElement, world: Point): void {
  const last = path.points[path.points.length - 1];
  if (!last) return;
  setState((s) => ({
    ...s,
    drawing: {
      ...s.drawing,
      preview: {
        type: "rubber",
        x1: last.x,
        y1: last.y,
        x2: world.x,
        y2: world.y,
        stroke: path.stroke,
        strokeWidth: path.strokeWidth,
      },
    },
  }));
}

/** Hold Shift to constrain: rect becomes a square, ellipse becomes a circle. */
function constrainShapeEnd(start: Point, current: Point, shift: boolean): Point {
  if (!shift) return current;
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + Math.sign(dx || 1) * s, y: start.y + Math.sign(dy || 1) * s };
}

export function updateShapePreview(
  tool: ShapeTool,
  start: Point,
  rawCurrent: Point,
  shift: boolean
): void {
  const current = constrainShapeEnd(start, rawCurrent, shift);
  setDrawing({
    shapeStart: start,
    preview: { type: "shape", tag: tool, nodeAttrs: shapeGeometry(tool, start, current) },
  });
}

export function finalizeShape(tool: ShapeTool, start: Point, rawEnd: Point, shift: boolean): void {
  const end = constrainShapeEnd(start, rawEnd, shift);
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.5) return;
  // The undo step belongs to the finished shape, not to the press that began it.
  pushUndo();
  const g = shapeGeometry(tool, start, end);
  const el =
    tool === "rect"
      ? createRect(g.x!, g.y!, g.width!, g.height!)
      : createEllipse(g.cx!, g.cy!, g.rx!, g.ry!);
  setState((s) => ({
    ...s,
    elements: [...s.elements, el],
    selection: selectOnly([el.id]),
  }));
}
