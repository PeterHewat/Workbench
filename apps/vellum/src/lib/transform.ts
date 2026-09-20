/**
 * SVG transform matrices, used to bake an imported `transform` into plain coordinates.
 *
 * Vellum's scene graph has no transform of its own: an element is its coordinates, which is what
 * keeps the exported file readable and the editing model simple. So a `transform` on an imported
 * element or on a `<g>` around it is applied to the geometry once, at import, and then forgotten.
 */

import { keepsRotation, rotationCentre, toPathElement, translateElement } from "./model.js";
import type { Point, SceneElement } from "./types.js";

/** `[a, b, c, d, e, f]`, as in SVG: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** True when the matrix maps horizontals to horizontals, so boxes and ellipses stay themselves. */
export function isAxisAligned(m: Matrix): boolean {
  return Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

const deg = (a: number) => (a * Math.PI) / 180;

/** The rotation the matrix applies, in degrees. */
export function rotationOf(m: Matrix): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}

/** How much the matrix scales lengths, averaged over the two axes. */
export function scaleOf(m: Matrix): number {
  return (Math.hypot(m[0], m[1]) + Math.hypot(m[2], m[3])) / 2;
}

/** Parses an SVG `transform` list. Unknown functions are skipped rather than failing the import. */
export function parseTransform(value: string | null | undefined): Matrix {
  let out: Matrix = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value ?? ""))) {
    const args = match[2]!
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    const [p0 = 0, p1 = 0, p2 = 0] = args;
    switch (match[1]!.toLowerCase()) {
      case "matrix":
        if (args.length >= 6) out = multiply(out, args.slice(0, 6) as Matrix);
        break;
      case "translate":
        out = multiply(out, [1, 0, 0, 1, p0, args.length > 1 ? p1 : 0]);
        break;
      case "scale":
        out = multiply(out, [p0, 0, 0, args.length > 1 ? p1 : p0, 0, 0]);
        break;
      case "rotate": {
        const c = Math.cos(deg(p0));
        const s = Math.sin(deg(p0));
        const rot: Matrix = [c, s, -s, c, 0, 0];
        if (args.length >= 3) {
          out = multiply(out, [1, 0, 0, 1, p1, p2]);
          out = multiply(out, rot);
          out = multiply(out, [1, 0, 0, 1, -p1, -p2]);
        } else {
          out = multiply(out, rot);
        }
        break;
      }
      case "skewx":
        out = multiply(out, [1, 0, Math.tan(deg(p0)), 1, 0, 0]);
        break;
      case "skewy":
        out = multiply(out, [1, Math.tan(deg(p0)), 0, 1, 0, 0]);
        break;
      default:
        break;
    }
  }
  return out;
}

/** A matrix that scales about a fixed point, which is what resizing by a typed number needs. */
export function scaleAbout(sx: number, sy: number, ox: number, oy: number): Matrix {
  return [sx, 0, 0, sy, ox * (1 - sx), oy * (1 - sy)];
}

function movePoint(m: Matrix, p: Point): void {
  const next = applyMatrix(m, p);
  p.x = next.x;
  p.y = next.y;
}

/**
 * True when the matrix is a rotation, a uniform scale and a translation, and nothing else. Such
 * a transform turns a rect into a rect, so it can be stored as an angle instead of flattening
 * the shape into a path.
 */
function isSimilarity(m: Matrix): boolean {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  if (!sx || !sy) return false;
  const orthogonal = Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * sx * sy;
  return orthogonal && Math.abs(sx - sy) < 1e-6 * sx;
}

/** Applies a similarity to a shape that carries its own angle, keeping its type. */
function transformKeepingRotation(el: SceneElement, m: Matrix): SceneElement {
  const scale = scaleOf(m);
  const angle = rotationOf(m);
  const centre = rotationCentre(el);
  const next = { ...el } as SceneElement;
  // Scale about the centre first, then move the centre to where the matrix sends it.
  if (Math.abs(scale - 1) > 1e-9) {
    const scaled = transformElement(
      { ...next, rotation: undefined },
      scaleAbout(scale, scale, centre.x, centre.y)
    );
    Object.assign(next, scaled);
  }
  const moved = applyMatrix(m, centre);
  const now = rotationCentre(next);
  translateElement(next, moved.x - now.x, moved.y - now.y);
  const total = ((((el.rotation ?? 0) + angle) % 360) + 360) % 360;
  if (total) next.rotation = total;
  else delete next.rotation;
  return next;
}

/**
 * Bakes `m` into an element's geometry. A rect or ellipse that the matrix would shear or rotate
 * becomes a path first, because the SVG element itself cannot express that without a transform.
 */
export function transformElement(el: SceneElement, m: Matrix): SceneElement {
  if (isIdentity(m)) return el;
  // A shape that can carry an angle keeps its type whenever the transform is one it can express.
  if (keepsRotation(el) && (el.rotation || !isAxisAligned(m)) && isSimilarity(m)) {
    return transformKeepingRotation(el, m);
  }
  if (el.type === "text") {
    const at = applyMatrix(m, { x: el.x, y: el.y });
    return { ...el, x: at.x, y: at.y, fontSize: el.fontSize * scaleOf(m) };
  }
  if (!isAxisAligned(m) && (el.type === "rect" || el.type === "ellipse" || el.type === "circle")) {
    return transformElement(toPathElement(el), m);
  }

  const next = { ...el } as SceneElement;
  switch (next.type) {
    case "rect": {
      const a = applyMatrix(m, { x: next.x, y: next.y });
      const b = applyMatrix(m, { x: next.x + next.width, y: next.y + next.height });
      next.x = Math.min(a.x, b.x);
      next.y = Math.min(a.y, b.y);
      next.width = Math.abs(b.x - a.x);
      next.height = Math.abs(b.y - a.y);
      next.rx = next.rx * Math.abs(m[0]);
      if (next.ry != null) next.ry *= Math.abs(m[3]);
      else if (Math.abs(m[0]) !== Math.abs(m[3])) next.ry = next.rx * Math.abs(m[3] / m[0] || 1);
      return next;
    }
    case "circle": {
      const c = applyMatrix(m, { x: next.cx, y: next.cy });
      const rx = next.r * Math.abs(m[0]);
      const ry = next.r * Math.abs(m[3]);
      if (Math.abs(rx - ry) < 1e-9) return { ...next, cx: c.x, cy: c.y, r: rx };
      const { r: _r, ...rest } = next;
      return { ...rest, type: "ellipse", cx: c.x, cy: c.y, rx, ry };
    }
    case "ellipse": {
      const c = applyMatrix(m, { x: next.cx, y: next.cy });
      return {
        ...next,
        cx: c.x,
        cy: c.y,
        rx: next.rx * Math.abs(m[0]),
        ry: next.ry * Math.abs(m[3]),
      };
    }
    case "line": {
      const a = applyMatrix(m, { x: next.x1, y: next.y1 });
      const b = applyMatrix(m, { x: next.x2, y: next.y2 });
      return { ...next, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case "path":
      next.points = next.points.map((p) => {
        const moved = { ...p, hIn: p.hIn && { ...p.hIn }, hOut: p.hOut && { ...p.hOut } };
        movePoint(m, moved);
        if (moved.hIn) movePoint(m, moved.hIn);
        if (moved.hOut) movePoint(m, moved.hOut);
        return moved;
      });
      return next;
    case "polyline":
    case "polygon":
      next.points = next.points.map((p) => applyMatrix(m, p));
      return next;
    default:
      return next;
  }
}
