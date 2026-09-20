import { deepClone, isDefaultName, isElementType, uid } from "./utils.js";
import type {
  Anchor,
  BBox,
  CircleElement,
  ElementType,
  EllipseElement,
  LineElement,
  PathElement,
  Point,
  PointsElement,
  PolygonElement,
  PolylineElement,
  RectElement,
  ReferenceImage,
  SceneElement,
  StyleCarrier,
  StyleProps,
  TextElement,
} from "./types.js";

export const DEFAULT_STROKE: StyleProps = {
  stroke: "#000000",
  strokeOpacity: 1,
  strokeWidth: 2,
  linecap: "round",
  linejoin: "round",
  fillEnabled: false,
  fillType: "solid",
  fill: "#000000",
  fillOpacity: 1,
  fill2: "#ffffff",
  fill2Opacity: 1,
  gradAngle: 0,
  markerStart: "none",
  markerEnd: "none",
};

/** Keys copied when an element is converted from one type to another: identity plus every style. */
const STYLE_KEYS: readonly string[] = ["name", "groupId", ...Object.keys(DEFAULT_STROKE)];

export function styleOf(el: SceneElement): StyleCarrier {
  const src = el as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out as StyleCarrier;
}

export const MARKER_TYPES: readonly ElementType[] = ["line", "polyline", "path"];
export const MARKER_SHAPES = ["none", "arrow", "dot", "square", "diamond"] as const;

export type AttrMap = Record<string, string | number | null | undefined>;

export interface Geometry {
  tag: string;
  attrs: AttrMap;
  text?: string;
}

/** Identity plus a full style set, shared by every element constructor. */
function base<T extends ElementType>(
  type: T,
  style: StyleCarrier
): { id: string; type: T; name: string; groupId?: string } & StyleProps {
  const { id, ...rest } = style;
  return {
    id: id ?? uid(type),
    type,
    name: "",
    ...DEFAULT_STROKE,
    ...rest,
  } as { id: string; type: T; name: string; groupId?: string } & StyleProps;
}

/** Corner radius clamped so it can never exceed half the rect's shorter side. */
export function cornerRadius(el: RectElement): number {
  const limit = el.ry === undefined ? Math.min(el.width, el.height) / 2 : el.width / 2;
  return Math.max(0, Math.min(el.rx || 0, limit));
}

/** Vertical corner radius; follows the horizontal one until it is set separately. */
export function cornerRadiusY(el: RectElement): number {
  if (el.ry === undefined) return cornerRadius(el);
  return Math.max(0, Math.min(el.ry, el.height / 2));
}

/** A circle's radius read as a pair, so circles and ellipses share one code path. */
function radii(el: CircleElement | EllipseElement): { rx: number; ry: number } {
  return el.type === "circle" ? { rx: el.r, ry: el.r } : { rx: el.rx, ry: el.ry };
}

export function isGradient(el: SceneElement): boolean {
  return !!el.fillEnabled && (el.fillType === "linear" || el.fillType === "radial");
}

/** Value for the SVG `fill` attribute: none, a solid color, or a gradient reference. */
function effectiveFill(el: SceneElement): string {
  if (!el.fillEnabled) return "none";
  if (isGradient(el)) return `url(#grad-${el.id})`;
  return el.fill;
}

export function createPath(
  points: Anchor[] = [],
  closed = false,
  style: StyleCarrier = {}
): PathElement {
  return { ...base("path", style), points, closed };
}

export function createPoint(x: number, y: number, smooth = false): Anchor {
  return {
    x,
    y,
    smooth,
    hOut: smooth ? { x, y } : null,
    hIn: smooth ? { x, y } : null,
  };
}

function syncHandlesForCorner(p: Anchor): void {
  p.hIn = null;
  p.hOut = null;
  p.smooth = false;
}

export function mirrorHandle(anchor: Point, dragged: Point): Point {
  return { x: anchor.x + (anchor.x - dragged.x), y: anchor.y + (anchor.y - dragged.y) };
}

export function createLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: StyleCarrier = {}
): LineElement {
  return { ...base("line", style), x1, y1, x2, y2 };
}

export function createRect(
  x: number,
  y: number,
  width: number,
  height: number,
  style: StyleCarrier = {}
): RectElement {
  return { ...base("rect", style), x, y, width, height, rx: 0 };
}

export function createText(
  x: number,
  y: number,
  text = "Text",
  style: StyleCarrier = {}
): TextElement {
  return {
    ...base("text", { fillEnabled: true, strokeWidth: 0, ...style }),
    x,
    y,
    text,
    fontSize: 48,
    fontFamily: "sans-serif",
    anchor: "start",
  };
}

export function createCircle(
  cx: number,
  cy: number,
  r: number,
  style: StyleCarrier = {}
): CircleElement {
  return { ...base("circle", style), cx, cy, r };
}

export function createEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  style: StyleCarrier = {}
): EllipseElement {
  return { ...base("ellipse", style), cx, cy, rx, ry };
}

export function createPolyline(points: Point[], style: StyleCarrier = {}): PolylineElement {
  return { ...base("polyline", style), points };
}

export function createPolygon(points: Point[], style: StyleCarrier = {}): PolygonElement {
  return { ...base("polygon", style), points };
}

export function createImage(dataUrl: string, name: string): ReferenceImage {
  return {
    id: uid("img"),
    name,
    fileName: name,
    dataUrl,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 0.5,
    visible: true,
  };
}

/* ---------- Segments and path geometry ---------- */

interface SegmentInfo {
  curved: boolean;
  c1: Point;
  c2: Point;
}

/** The segment from `a` to `b`: whether it curves, and the two cubic control points. */
function segmentInfo(a: Anchor, b: Anchor): SegmentInfo {
  const off = (h: Point | null, p: Point) => !!h && (h.x !== p.x || h.y !== p.y);
  return { curved: off(a.hOut, a) || off(b.hIn, b), c1: a.hOut ?? a, c2: b.hIn ?? b };
}

/** Anchor pairs for every drawn segment, including the closing one on a closed path. */
function pathSegments(path: PathElement): [Anchor, Anchor][] {
  const pts = path.points;
  const segs: [Anchor, Anchor][] = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i]!, pts[i + 1]!]);
  if (path.closed && pts.length > 2) segs.push([pts[pts.length - 1]!, pts[0]!]);
  return segs;
}

export type Formatter = (n: number) => number;

/** `fmt` formats each coordinate (identity for live rendering, Math.round for export). */
function pathToD(path: PathElement, fmt: Formatter = (n) => n): string {
  const pts = path.points;
  if (!pts.length) return "";
  const draw = (a: Anchor, b: Anchor) => {
    const { curved, c1, c2 } = segmentInfo(a, b);
    return curved
      ? ` C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(b.x)} ${fmt(b.y)}`
      : ` L ${fmt(b.x)} ${fmt(b.y)}`;
  };
  let d = `M ${fmt(pts[0]!.x)} ${fmt(pts[0]!.y)}`;
  for (let i = 0; i < pts.length - 1; i++) d += draw(pts[i]!, pts[i + 1]!);
  if (path.closed && pts.length > 2) {
    const last = pts[pts.length - 1]!;
    // A straight closing segment is implied by Z; only a curved one needs its own command.
    if (segmentInfo(last, pts[0]!).curved) d += draw(last, pts[0]!);
    d += " Z";
  }
  return d;
}

/** True if every segment of `path` is a straight line (no Bezier curvature). */
function pathIsStraight(path: PathElement): boolean {
  return pathSegments(path).every(([a, b]) => !segmentInfo(a, b).curved);
}

/**
 * Every point that defines a shape's geometry: anchors, plus Bezier handles for paths.
 * For paths/polylines/polygons the returned objects are the live ones (so they can be moved);
 * `skipIndex` drops one anchor and its handles.
 */
function geometryPoints(el: SceneElement, skipIndex = -1): Point[] {
  switch (el.type) {
    case "path": {
      const out: Point[] = [];
      el.points.forEach((p, i) => {
        if (i === skipIndex) return;
        out.push(p);
        if (p.hIn) out.push(p.hIn);
        if (p.hOut) out.push(p.hOut);
      });
      return out;
    }
    case "polyline":
    case "polygon":
      return el.points.filter((_, i) => i !== skipIndex);
    case "line":
      return [
        { x: el.x1, y: el.y1 },
        { x: el.x2, y: el.y2 },
      ];
    case "rect":
      // Perimeter order (TL, TR, BR, BL) so tracing these as a path gives the rectangle back.
      return [
        { x: el.x, y: el.y },
        { x: el.x + el.width, y: el.y },
        { x: el.x + el.width, y: el.y + el.height },
        { x: el.x, y: el.y + el.height },
      ];
    case "circle":
    case "ellipse":
      return [{ x: el.cx, y: el.cy }];
    case "text":
      return [{ x: el.x, y: el.y }];
    default:
      return [];
  }
}

function boundsOf(points: readonly Point[]): BBox | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/* ---------- Rendering / export geometry ---------- */

let measureCtx: CanvasRenderingContext2D | null = null;

function textWidth(el: TextElement): number {
  if (!measureCtx && typeof document !== "undefined") {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  const fontSize = el.fontSize || 48;
  if (!measureCtx) return (el.text || "").length * fontSize * 0.6;
  measureCtx.font = `${fontSize}px ${el.fontFamily || "sans-serif"}`;
  return measureCtx.measureText(el.text || "").width;
}

export function elementBBox(el: SceneElement): BBox | null {
  switch (el.type) {
    case "rect":
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    case "circle":
    case "ellipse": {
      const { rx, ry } = radii(el);
      return { x: el.cx - rx, y: el.cy - ry, width: rx * 2, height: ry * 2 };
    }
    case "text": {
      const w = textWidth(el);
      const h = (el.fontSize || 48) * 1.1;
      const x = el.anchor === "middle" ? el.x - w / 2 : el.anchor === "end" ? el.x - w : el.x;
      const y = el.y - (el.fontSize || 48) * 0.85;
      if (!el.rotation) return { x, y, width: w, height: h };
      const a = (el.rotation * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const corners = (
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ] as const
      ).map(([px, py]) => {
        const dx = px - el.x;
        const dy = py - el.y;
        return { x: el.x + dx * cos - dy * sin, y: el.y + dx * sin + dy * cos };
      });
      return boundsOf(corners);
    }
    default:
      return boundsOf(geometryPoints(el));
  }
}

/**
 * Tag and geometry attributes for an element, shared by the canvas renderer and the SVG
 * exporter so the two can never drift. `fmt` formats coordinates (identity on canvas,
 * Math.round for export); `text` is present only for `<text>`. Null attributes are dropped.
 */
export function geometryOf(el: SceneElement, fmt: Formatter = (n) => n): Geometry | null {
  switch (el.type) {
    case "path":
      return { tag: "path", attrs: { d: pathToD(el, fmt) } };
    case "line":
      return {
        tag: "line",
        attrs: { x1: fmt(el.x1), y1: fmt(el.y1), x2: fmt(el.x2), y2: fmt(el.y2) },
      };
    case "rect": {
      const rx = fmt(cornerRadius(el));
      const ry = fmt(cornerRadiusY(el));
      const rounded = rx > 0 || ry > 0;
      return {
        tag: "rect",
        attrs: {
          x: fmt(el.x),
          y: fmt(el.y),
          width: fmt(el.width),
          height: fmt(el.height),
          rx: rounded ? rx : null,
          // `rx` alone already implies an equal `ry`.
          ry: rounded && ry !== rx ? ry : null,
        },
      };
    }
    case "circle":
      return { tag: "circle", attrs: { cx: fmt(el.cx), cy: fmt(el.cy), r: fmt(el.r) } };
    case "ellipse":
      return {
        tag: "ellipse",
        attrs: { cx: fmt(el.cx), cy: fmt(el.cy), rx: fmt(el.rx), ry: fmt(el.ry) },
      };
    case "polyline":
    case "polygon":
      return {
        tag: el.type,
        attrs: { points: el.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ") },
      };
    case "text":
      return {
        tag: "text",
        attrs: {
          x: fmt(el.x),
          y: fmt(el.y),
          "font-family": el.fontFamily || "sans-serif",
          "font-size": fmt(el.fontSize || 48),
          "text-anchor": el.anchor && el.anchor !== "start" ? el.anchor : null,
          transform: el.rotation
            ? `rotate(${Math.round(el.rotation * 10) / 10} ${fmt(el.x)} ${fmt(el.y)})`
            : null,
        },
        text: el.text || "",
      };
    default:
      return null;
  }
}

/**
 * Presentation attributes, shared by the canvas renderer and the SVG exporter. Opacity is
 * emitted only when not fully opaque, and a zero-width stroke exports as `stroke="none"`,
 * so the markup stays minimal and the canvas matches the file.
 */
export function styleAttrs(el: SceneElement): AttrMap {
  const attrs: AttrMap = {};
  if (el.strokeWidth === 0) {
    attrs.stroke = "none";
  } else {
    attrs.stroke = el.stroke;
    attrs["stroke-width"] = el.strokeWidth;
    attrs["stroke-linecap"] = el.linecap;
    attrs["stroke-linejoin"] = el.linejoin;
    if (el.strokeOpacity != null && el.strokeOpacity !== 1) {
      attrs["stroke-opacity"] = el.strokeOpacity;
    }
  }
  attrs.fill = effectiveFill(el);
  if (el.fillEnabled && !isGradient(el) && el.fillOpacity != null && el.fillOpacity !== 1) {
    attrs["fill-opacity"] = el.fillOpacity;
  }
  if (MARKER_TYPES.includes(el.type)) {
    if (el.markerStart && el.markerStart !== "none") {
      attrs["marker-start"] = `url(#mk-${el.id}-start)`;
    }
    if (el.markerEnd && el.markerEnd !== "none") {
      attrs["marker-end"] = `url(#mk-${el.id}-end)`;
    }
  }
  return attrs;
}

/* ---------- Transforms ---------- */

export function translateElement(el: SceneElement, dx: number, dy: number): void {
  switch (el.type) {
    case "path":
    case "polyline":
    case "polygon":
      for (const p of geometryPoints(el)) {
        p.x += dx;
        p.y += dy;
      }
      break;
    case "line":
      el.x1 += dx;
      el.y1 += dy;
      el.x2 += dx;
      el.y2 += dy;
      break;
    case "rect":
    case "text":
      el.x += dx;
      el.y += dy;
      break;
    case "circle":
    case "ellipse":
      el.cx += dx;
      el.cy += dy;
      break;
  }
}

export interface AlignOptions {
  excludeElementIds?: Set<string>;
  excludePoint?: { elementId: string; index: number };
}

/**
 * Candidate points for Alt-key alignment snapping. `excludeElementIds` drops whole elements
 * (e.g. the ones being dragged); `excludePoint` drops a single anchor (the one being dragged).
 */
export function collectAlignPoints(
  elements: readonly SceneElement[],
  opts: AlignOptions = {}
): Point[] {
  const pts: Point[] = [];
  for (const el of elements) {
    if (opts.excludeElementIds?.has(el.id)) continue;
    const skip = opts.excludePoint?.elementId === el.id ? opts.excludePoint.index : -1;
    for (const p of geometryPoints(el, skip)) pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

export interface AlignResult extends Point {
  guideX: number | null;
  guideY: number | null;
}

/**
 * Snaps `p` to the nearest x and/or y among `points` if within `tol` (world units),
 * independently per axis. Returns the adjusted point plus the matched guide coordinates.
 */
export function alignToPoints(p: Point, points: readonly Point[], tol: number): AlignResult {
  let x = p.x;
  let y = p.y;
  let guideX: number | null = null;
  let guideY: number | null = null;
  let bestDx = tol;
  let bestDy = tol;
  for (const pt of points) {
    const dx = Math.abs(pt.x - p.x);
    if (dx < bestDx) {
      bestDx = dx;
      x = pt.x;
      guideX = pt.x;
    }
    const dy = Math.abs(pt.y - p.y);
    if (dy < bestDy) {
      bestDy = dy;
      y = pt.y;
      guideY = pt.y;
    }
  }
  return { x, y, guideX, guideY };
}

/**
 * When a freshly drawn path turns out to have no curves, replace it with the more specific
 * primitive it's equivalent to: a 2-point open path becomes a line, a straight closed path a
 * polygon, any other straight open path a polyline. Keeps the same id so selection/undo
 * references stay valid.
 */
export function simplifyPathIfStraight(path: SceneElement): SceneElement {
  if (path.type !== "path" || path.points.length < 2 || !pathIsStraight(path)) return path;
  const pts = path.points.map((p) => ({ x: p.x, y: p.y }));
  const style = { ...styleOf(path), id: path.id };
  if (path.closed && pts.length >= 3) return createPolygon(pts, style);
  if (pts.length === 2) return createLine(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y, style);
  return createPolyline(pts, style);
}

const KAPPA = 0.5522847498;

function ellipseToPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  style: StyleCarrier
): PathElement {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const mk = (x: number, y: number, hIn: Point, hOut: Point): Anchor => ({
    x,
    y,
    smooth: true,
    hIn,
    hOut,
  });
  return createPath(
    [
      mk(cx + rx, cy, { x: cx + rx, y: cy - ky }, { x: cx + rx, y: cy + ky }),
      mk(cx, cy + ry, { x: cx + kx, y: cy + ry }, { x: cx - kx, y: cy + ry }),
      mk(cx - rx, cy, { x: cx - rx, y: cy + ky }, { x: cx - rx, y: cy - ky }),
      mk(cx, cy - ry, { x: cx - kx, y: cy - ry }, { x: cx + kx, y: cy - ry }),
    ],
    true,
    style
  );
}

/** Converts any geometric primitive to an equivalent editable path (same id and style). */
export function toPathElement(el: SceneElement): SceneElement {
  if (el.type === "path") return el;
  const style = { ...styleOf(el), id: el.id };
  const corner = (p: Point) => createPoint(p.x, p.y, false);
  switch (el.type) {
    case "line":
      return createPath(
        [corner({ x: el.x1, y: el.y1 }), corner({ x: el.x2, y: el.y2 })],
        false,
        style
      );
    case "polyline":
      return createPath(el.points.map(corner), false, style);
    case "polygon":
      return createPath(el.points.map(corner), true, style);
    case "rect":
      return createPath(geometryPoints(el).map(corner), true, style);
    case "circle":
    case "ellipse": {
      const { rx, ry } = radii(el);
      return ellipseToPath(el.cx, el.cy, rx, ry, style);
    }
    default:
      return el;
  }
}

/** Everything but a circle, which looks the same at any angle. */
export function canRotate(el: SceneElement): boolean {
  return el.type !== "circle" && isElementType(el.type);
}

/** The element to rotate: rects become polygons, ellipses become paths, others are unchanged. */
export function rotationBase(el: SceneElement): SceneElement {
  if (el.type === "rect") return simplifyPathIfStraight(toPathElement(el));
  if (el.type === "ellipse" || el.type === "circle") return toPathElement(el);
  return el;
}

/** Returns a rotated deep copy of `src` (a path/line/polyline/polygon/text) about (cx, cy). */
export function rotateElementCopy(
  src: SceneElement,
  angle: number,
  cx: number,
  cy: number
): SceneElement {
  const c = deepClone(src);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rot = (p: Point) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    p.x = cx + dx * cos - dy * sin;
    p.y = cy + dx * sin + dy * cos;
  };
  if (c.type === "text") {
    rot(c);
    const prev = src.type === "text" ? (src.rotation ?? 0) : 0;
    c.rotation = (((prev + (angle * 180) / Math.PI) % 360) + 360) % 360;
  } else if (c.type === "line") {
    const a = { x: c.x1, y: c.y1 };
    const b = { x: c.x2, y: c.y2 };
    rot(a);
    rot(b);
    c.x1 = a.x;
    c.y1 = a.y;
    c.x2 = b.x;
    c.y2 = b.y;
  } else {
    geometryPoints(c).forEach(rot);
  }
  return c;
}

/* ---------- Point editing ---------- */

function bezierAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

export interface NearestHit {
  index: number;
  t: number;
  dist: number;
}

/**
 * Finds the closest point on a path/line/polyline/polygon outline to `p`.
 * Returns {index, t, dist}: the segment from points[index] to points[index+1]
 * (wrapping for closed shapes) and the parameter along it.
 */
export function nearestOnElement(el: SceneElement, p: Point): NearestHit | null {
  const segs: { i: number; a: Point; b: Point }[] = [];
  if (el.type === "line") {
    segs.push({ i: 0, a: { x: el.x1, y: el.y1 }, b: { x: el.x2, y: el.y2 } });
  } else if ("points" in el) {
    const pts: Point[] = el.points;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) segs.push({ i, a: pts[i]!, b: pts[i + 1]! });
    const closed = el.type === "polygon" || (el.type === "path" && el.closed && n > 2);
    if (closed && n > 1) segs.push({ i: n - 1, a: pts[n - 1]!, b: pts[0]! });
  }
  let best: NearestHit | null = null;
  const consider = (i: number, t: number, d: number) => {
    if (!best || d < best.dist) best = { index: i, t, dist: d };
  };
  for (const s of segs) {
    const info =
      el.type === "path"
        ? segmentInfo(s.a as Anchor, s.b as Anchor)
        : { curved: false, c1: s.a, c2: s.b };
    if (!info.curved) {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      consider(s.i, t, Math.hypot(p.x - (s.a.x + dx * t), p.y - (s.a.y + dy * t)));
    } else {
      const N = 48;
      const distAt = (t: number) => {
        const q = bezierAt(s.a, info.c1, info.c2, s.b, t);
        return Math.hypot(p.x - q.x, p.y - q.y);
      };
      let bt = 0;
      let bd = Infinity;
      for (let k = 0; k <= N; k++) {
        const d = distAt(k / N);
        if (d < bd) {
          bd = d;
          bt = k / N;
        }
      }
      let lo = Math.max(0, bt - 1 / N);
      let hi = Math.min(1, bt + 1 / N);
      for (let it = 0; it < 14; it++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (distAt(m1) < distAt(m2)) hi = m2;
        else lo = m1;
      }
      const t = (lo + hi) / 2;
      consider(s.i, t, distAt(t));
    }
  }
  return best;
}

/**
 * Inserts a vertex on segment `index` at parameter `t`. Curved path segments are split so the
 * shape doesn't change. A line becomes a 3-point polyline (returned as a replacement element);
 * other types are edited in place.
 */
export function insertPointAt(el: SceneElement, index: number, t: number): SceneElement {
  if (el.type === "line") {
    const mid = { x: el.x1 + (el.x2 - el.x1) * t, y: el.y1 + (el.y2 - el.y1) * t };
    return createPolyline([{ x: el.x1, y: el.y1 }, mid, { x: el.x2, y: el.y2 }], {
      ...styleOf(el),
      id: el.id,
    });
  }
  if (el.type === "polyline" || el.type === "polygon") {
    const n = el.points.length;
    const a = el.points[index]!;
    const b = el.points[(index + 1) % n]!;
    el.points.splice(index + 1, 0, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    return el;
  }
  if (el.type === "path") {
    const pts = el.points;
    const a = pts[index]!;
    const b = pts[(index + 1) % pts.length]!;
    const info = segmentInfo(a, b);
    if (!info.curved) {
      pts.splice(index + 1, 0, createPoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, false));
      return el;
    }
    // de Casteljau: split the cubic at t so both halves trace the original curve.
    const lerp = (p: Point, q: Point): Point => ({
      x: p.x + (q.x - p.x) * t,
      y: p.y + (q.y - p.y) * t,
    });
    const p01 = lerp(a, info.c1);
    const p12 = lerp(info.c1, info.c2);
    const p23 = lerp(info.c2, b);
    const p012 = lerp(p01, p12);
    const p123 = lerp(p12, p23);
    const m = lerp(p012, p123);
    a.hOut = p01;
    b.hIn = p23;
    pts.splice(index + 1, 0, { x: m.x, y: m.y, smooth: true, hIn: p012, hOut: p123 });
  }
  return el;
}

/** Toggles a path anchor between corner (no handles) and smooth (symmetric generated handles). */
export function togglePointSmooth(path: SceneElement, i: number): void {
  if (path.type !== "path") return;
  const p = path.points[i];
  if (!p) return;
  const off = (h: Point | null) => h && (h.x !== p.x || h.y !== p.y);
  if (off(p.hIn) || off(p.hOut)) {
    syncHandlesForCorner(p);
    return;
  }
  const n = path.points.length;
  const closed = path.closed && n > 2;
  const prev = path.points[i - 1] ?? (closed ? path.points[n - 1] : undefined);
  const next = path.points[i + 1] ?? (closed ? path.points[0] : undefined);
  let tx: number;
  let ty: number;
  let len: number;
  if (prev && next) {
    tx = next.x - prev.x;
    ty = next.y - prev.y;
    len =
      Math.min(Math.hypot(p.x - prev.x, p.y - prev.y), Math.hypot(next.x - p.x, next.y - p.y)) / 3;
  } else if (next) {
    tx = next.x - p.x;
    ty = next.y - p.y;
    len = Math.hypot(tx, ty) / 3;
  } else if (prev) {
    tx = p.x - prev.x;
    ty = p.y - prev.y;
    len = Math.hypot(tx, ty) / 3;
  } else {
    return;
  }
  const m = Math.hypot(tx, ty) || 1;
  const ux = tx / m;
  const uy = ty / m;
  p.smooth = true;
  p.hOut = next ? { x: p.x + ux * len, y: p.y + uy * len } : { x: p.x, y: p.y };
  p.hIn = prev ? { x: p.x - ux * len, y: p.y - uy * len } : { x: p.x, y: p.y };
}

const cloneHandle = (h: Point | null | undefined): Point | null => (h ? { x: h.x, y: h.y } : null);

/* ---------- Topology ---------- */

/** Whether an element is a polyline/polygon/path whose closed state can be changed. */
export function canToggleClosed(el: SceneElement): el is PointsElement {
  return el.type === "path" || el.type === "polyline" || el.type === "polygon";
}

export function isClosedShape(el: SceneElement): boolean {
  return el.type === "polygon" || (el.type === "path" && !!el.closed);
}

/** Closes or opens a shape (polyline <-> polygon, path.closed). Returns the replacement element. */
export function setClosed(el: SceneElement, closed: boolean): SceneElement {
  if (!canToggleClosed(el) || isClosedShape(el) === closed) return el;
  const n = el.points.length;
  if (closed && n < 3) return el;
  if (el.type === "path") {
    el.closed = closed;
    return el;
  }
  const pts = el.points.map((p) => ({ x: p.x, y: p.y }));
  const style = { ...styleOf(el), id: el.id };
  return closed ? createPolygon(pts, style) : createPolyline(pts, style);
}

/**
 * When the endpoint `index` of an open shape has been dragged onto its opposite endpoint,
 * merges the two into one point and closes the shape. Returns the replacement element or null.
 */
export function closeByMerge(el: SceneElement, index: number, tol: number): SceneElement | null {
  if (el.type !== "path" && el.type !== "polyline") return null;
  if (el.type === "path" && el.closed) return null;
  const n = el.points.length;
  if (n < 4 && !(el.type === "path" && n >= 3)) return null;
  if (index !== 0 && index !== n - 1) return null;
  const other = index === 0 ? n - 1 : 0;
  const a = el.points[index]!;
  const b = el.points[other]!;
  if (Math.hypot(a.x - b.x, a.y - b.y) > tol) return null;
  if (el.type === "polyline") {
    const rest = el.points.filter((_, i) => i !== index).map((p) => ({ x: p.x, y: p.y }));
    return createPolygon(rest, { ...styleOf(el), id: el.id });
  }
  const pts = el.points;
  if (index === n - 1) {
    const first = pts[0]!;
    const last = pts[n - 1]!;
    if (last.hIn) first.hIn = cloneHandle(last.hIn);
    first.smooth = first.smooth || last.smooth;
    pts.pop();
  } else {
    const first = pts[0]!;
    const last = pts[n - 1]!;
    if (first.hOut) last.hOut = cloneHandle(first.hOut);
    last.smooth = last.smooth || first.smooth;
    pts.shift();
  }
  el.closed = true;
  return el;
}

/**
 * Cuts a shape at anchor `i`. A closed shape becomes one open path that starts and ends at the
 * cut; an open shape becomes two paths. Returns the replacement elements (first keeps the id),
 * or null if the cut is not possible (endpoints, lines, too few points).
 */
export function splitAt(el: SceneElement, i: number): SceneElement[] | null {
  if (!canToggleClosed(el)) return null;
  const path = el.type === "path" ? el : (toPathElement(el) as PathElement);
  const pts = path.points;
  const n = pts.length;
  const closed = !!path.closed && n > 2;
  const style = { ...styleOf(path) };
  const copy = (p: Anchor, hIn: Point | null, hOut: Point | null): Anchor => ({
    x: p.x,
    y: p.y,
    smooth: p.smooth,
    hIn: cloneHandle(hIn),
    hOut: cloneHandle(hOut),
  });
  if (closed) {
    const ordered: Anchor[] = [];
    for (let k = 0; k < n; k++) ordered.push(pts[(i + k) % n]!);
    const out = ordered.map((p) => copy(p, p.hIn, p.hOut));
    out[0]!.hIn = null;
    out.push(copy(pts[i]!, pts[i]!.hIn, null));
    return [simplifyPathIfStraight(createPath(out, false, { ...style, id: el.id }))];
  }
  if (i <= 0 || i >= n - 1) return null;
  const a = pts.slice(0, i + 1).map((p) => copy(p, p.hIn, p.hOut));
  a[a.length - 1]!.hOut = null;
  const b = pts.slice(i).map((p) => copy(p, p.hIn, p.hOut));
  b[0]!.hIn = null;
  return [
    simplifyPathIfStraight(createPath(a, false, { ...style, id: el.id })),
    simplifyPathIfStraight(createPath(b, false, style)),
  ];
}

function reversedPoints(points: readonly Anchor[]): Anchor[] {
  return points
    .map((p) => ({ ...p, hIn: cloneHandle(p.hOut), hOut: cloneHandle(p.hIn) }))
    .reverse();
}

/** Open, single-subpath shapes that can be joined end to end (as paths). */
export function canJoin(el: SceneElement): boolean {
  if (el.type === "line" || el.type === "polyline") return true;
  return el.type === "path" && !el.closed;
}

/**
 * Joins the closest pair of end points of two open shapes into one path (style and id of `a`).
 * Ends within `mergeTol` become one point; farther ends get a straight segment between them.
 * Returns null if either shape is not joinable, or the closest ends are farther apart than `maxDist`.
 */
export function joinPaths(
  a: SceneElement,
  b: SceneElement,
  mergeTol = 0.5,
  maxDist = Infinity
): SceneElement | null {
  if (!canJoin(a) || !canJoin(b)) return null;
  const pa = (toPathElement(a) as PathElement).points.map((p) => ({ ...p }));
  const pb = (toPathElement(b) as PathElement).points.map((p) => ({ ...p }));
  if (!pa.length || !pb.length) return null;
  const ends = (pts: Anchor[]) => [pts[0]!, pts[pts.length - 1]!];
  let best: { d: number; aStart: boolean; bEnd: boolean } | null = null;
  ends(pa).forEach((p, i) =>
    ends(pb).forEach((q, j) => {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) best = { d, aStart: i === 0, bEnd: j === 1 };
    })
  );
  if (!best) return null;
  const pick = best as { d: number; aStart: boolean; bEnd: boolean };
  if (pick.d > maxDist) return null;
  const first = pick.aStart ? reversedPoints(pa) : pa;
  const second = pick.bEnd ? reversedPoints(pb) : pb;
  const last = first[first.length - 1]!;
  const head = second[0]!;
  let points: Anchor[];
  if (pick.d <= mergeTol) {
    const mx = (last.x + head.x) / 2;
    const my = (last.y + head.y) / 2;
    const shift = (h: Point | null, from: Point) =>
      h ? { x: h.x + mx - from.x, y: h.y + my - from.y } : null;
    const merged: Anchor = {
      x: mx,
      y: my,
      smooth: !!(last.smooth || head.smooth),
      hIn: shift(last.hIn, last),
      hOut: shift(head.hOut, head),
    };
    points = [...first.slice(0, -1), merged, ...second.slice(1)];
  } else {
    points = [...first, ...second];
  }
  const path = createPath(points, false, { ...styleOf(a), id: a.id });
  // Joined shapes keep both custom names ("foo" + "bar" = "foo bar"); default names renumber.
  const names = [a.name, b.name].filter((n) => !isDefaultName(n));
  if (names.length) path.name = names.join(" ");
  return simplifyPathIfStraight(path);
}

export function duplicateElement(el: SceneElement): SceneElement {
  const copy = deepClone(el);
  copy.id = uid(el.type);
  return copy;
}
