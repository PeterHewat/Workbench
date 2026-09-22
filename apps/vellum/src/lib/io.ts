import {
  elementBBox,
  createPath,
  createLine,
  createRect,
  createCircle,
  createEllipse,
  createPolyline,
  createPolygon,
  createText,
  MARKER_TYPES,
  isGradient,
  gradientStops,
  geometryOf,
  styleAttrs,
} from "./model.js";
import { ELEMENT_SELECTOR, escapeAttr, escapeXml, uid } from "./utils.js";
import { groupsOf, normalizeGroups, pruneGroups } from "./groups.js";
import { arcToCubics } from "./arc.js";
import {
  IDENTITY,
  isIdentity,
  multiply,
  parseTransform,
  transformElement,
  type Matrix,
} from "./transform.js";
import { replaceState, createInitialState, selectOnly } from "./state.js";
import type {
  Anchor,
  BackgroundPaint,
  EditorState,
  MarkerShape,
  ProjectFile,
  Point,
  SceneElement,
  StyleCarrier,
} from "./types.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * The id the artboard background is exported under. It is a plain `<rect>` so the file opens
 * anywhere, and the id is what tells the importer - the live SVG panel, mostly - that this rect
 * is the document's background rather than a shape somebody drew.
 */
const BACKGROUND_ID = "background";

/* ---------- Export ---------- */

const n3 = (n: number) => String(+Number(n).toFixed(3));

interface MarkerDef {
  refX: number;
  markup: (fill: string) => string;
}

const MARKER_SHAPE_DEFS: Record<string, MarkerDef> = {
  arrow: { refX: 9, markup: (f) => `<path d="M0,0 L10,5 L0,10 z" ${f}/>` },
  dot: { refX: 5, markup: (f) => `<circle cx="5" cy="5" r="5" ${f}/>` },
  square: { refX: 5, markup: (f) => `<rect width="10" height="10" ${f}/>` },
  diamond: { refX: 5, markup: (f) => `<path d="M5,0 L10,5 L5,10 L0,5 z" ${f}/>` },
};

/**
 * Geometry is stored as floats internally (needed for smooth dragging and Alt-align), but the
 * exported/previewed SVG reads as clean integers. Only coordinates are rounded; style values
 * like stroke-width stay as the user set them.
 */
export function elementToSvgMarkup(el: SceneElement, exportId: string = el.id): string {
  const g = geometryOf(el, Math.round);
  if (!g) return "";
  const attrs = { id: exportId, ...g.attrs, ...styleAttrs(el) };
  const open = Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ");
  return g.text !== undefined
    ? `<${g.tag} ${open}>${escapeXml(g.text)}</${g.tag}>`
    : `<${g.tag} ${open}/>`;
}

interface Line {
  indent: number;
  text: string;
  elId?: string;
}

/** Gradient and marker definitions needed by the elements. */
function buildDefsLines(elements: readonly SceneElement[]): Line[] {
  const lines: Line[] = [];
  for (const el of elements) {
    if (isGradient(el)) {
      const stops = gradientStops(el).map(
        (stop) =>
          `<stop offset="${n3(stop.offset)}" stop-color="${stop.color}" stop-opacity="${n3(stop.opacity)}"/>`
      );
      const from = el.gradFrom;
      const to = el.gradTo;
      if (el.fillType === "radial") {
        const r = n3(Math.hypot(to.x - from.x, to.y - from.y) || 0.5);
        lines.push({
          indent: 0,
          text: `<radialGradient id="grad-${el.id}" cx="${n3(from.x)}" cy="${n3(from.y)}" r="${r}">`,
        });
        stops.forEach((s) => lines.push({ indent: 1, text: s }));
        lines.push({ indent: 0, text: "</radialGradient>" });
      } else {
        lines.push({
          indent: 0,
          text: `<linearGradient id="grad-${el.id}" x1="${n3(from.x)}" y1="${n3(from.y)}" x2="${n3(to.x)}" y2="${n3(to.y)}">`,
        });
        stops.forEach((s) => lines.push({ indent: 1, text: s }));
        lines.push({ indent: 0, text: "</linearGradient>" });
      }
    }
    if (MARKER_TYPES.includes(el.type)) {
      for (const end of ["start", "end"] as const) {
        const shape = MARKER_SHAPE_DEFS[end === "start" ? el.markerStart : el.markerEnd];
        if (!shape) continue;
        const opacity =
          el.strokeOpacity != null && el.strokeOpacity !== 1
            ? ` fill-opacity="${el.strokeOpacity}"`
            : "";
        lines.push({
          indent: 0,
          text: `<marker id="mk-${el.id}-${end}" viewBox="0 0 10 10" refX="${shape.refX}" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">`,
        });
        lines.push({ indent: 1, text: shape.markup(`fill="${el.stroke}"${opacity}`) });
        lines.push({ indent: 0, text: "</marker>" });
      }
    }
  }
  return lines;
}

/** Compact (single-line) defs markup, used for the live canvas. */
export function buildDefsMarkup(elements: readonly SceneElement[]): string {
  return buildDefsLines(elements)
    .map((l) => l.text)
    .join("");
}

const AUTO_ID_SRC = "[a-f][0-9a-f]{7}";
const AUTO_ID = new RegExp(`^${AUTO_ID_SRC}$`);
const NAMED_ID = new RegExp(`^${AUTO_ID_SRC}_(.+)$`);

/** A user-facing name as it appears in an id: spaces become "_", invalid characters dropped. */
export function sanitizeName(name: string | undefined): string {
  return (name || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.-]/g, "");
}

/** The generated-id part of an exported id (`abc12345_name` -> `abc12345`), or null. */
export function elementIdFromSvgId(svgId: string | null | undefined): string | null {
  const m = (svgId || "").match(new RegExp(`^(${AUTO_ID_SRC})(?:_.*)?$`));
  return m ? m[1]! : null;
}

/**
 * Exported id per element: the generated id (always kept, unique) followed by "_" and the
 * user's name. Only the first "_" separates the two, so names may contain underscores.
 */
function exportIds(elements: readonly SceneElement[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of elements) {
    const base = sanitizeName(el.name);
    out.set(el.id, base ? `${el.id}_${base}` : el.id);
  }
  return out;
}

/** What export needs from the document: no selection, no viewport, nothing live. */
export type ExportDoc = Pick<EditorState, "artboard" | "elements"> & {
  background?: BackgroundPaint | null;
  groupNames?: Readonly<Record<string, string>>;
};

/** A group's id in the file: its own id, then "_" and its name when it has one. */
export function groupExportId(gid: string, names: Readonly<Record<string, string>> = {}): string {
  const name = sanitizeName(names[gid]);
  return name ? `${gid}_${name}` : gid;
}

/** A group id as Vellum writes it, optionally followed by "_" and the group's name. */
const GROUP_ID = /^(group-[A-Za-z0-9-]+)(?:_(.+))?$/;

function buildSvgLines(state: ExportDoc): Line[] {
  const ids = exportIds(state.elements);
  const width = Math.round(state.artboard.width);
  const height = Math.round(state.artboard.height);
  const lines: Line[] = [
    {
      indent: 0,
      text: `<svg xmlns="${NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    },
  ];
  const defs = buildDefsLines(state.elements);
  if (defs.length) {
    lines.push({ indent: 1, text: "<defs>" });
    defs.forEach((d) => lines.push({ indent: 2 + d.indent, text: d.text }));
    lines.push({ indent: 1, text: "</defs>" });
  }
  const bg = state.background;
  if (bg && bg.opacity > 0) {
    const alpha = bg.opacity < 1 ? ` fill-opacity="${n3(bg.opacity)}"` : "";
    lines.push({
      indent: 1,
      text: `<rect id="${BACKGROUND_ID}" width="${width}" height="${height}" fill="${bg.color}"${alpha}/>`,
    });
  }
  emitRange(state.elements, 0, state.elements.length, 0, 1, lines, ids, state.groupNames ?? {});
  lines.push({ indent: 0, text: "</svg>" });
  return lines;
}

/**
 * Writes one level of the document, opening a `<g>` for each run of elements that share a group
 * at this depth and recursing into it. Members of a group are contiguous (see groups.ts), so a
 * group is always exactly one `<g>`.
 */
function emitRange(
  els: readonly SceneElement[],
  start: number,
  end: number,
  depth: number,
  indent: number,
  lines: Line[],
  ids: Map<string, string>,
  groupNames: Readonly<Record<string, string>>
): void {
  let i = start;
  while (i < end) {
    const gid = groupsOf(els[i])[depth];
    if (gid) {
      let j = i;
      while (j < end && groupsOf(els[j])[depth] === gid) j++;
      lines.push({ indent, text: `<g id="${groupExportId(gid, groupNames)}">` });
      emitRange(els, i, j, depth + 1, indent + 1, lines, ids, groupNames);
      lines.push({ indent, text: "</g>" });
      i = j;
    } else {
      const el = els[i]!;
      const text = elementToSvgMarkup(el, ids.get(el.id));
      if (text) lines.push({ indent, text, elId: el.id });
      i++;
    }
  }
}

export function formatExportSvg(state: ExportDoc, pretty = false): string {
  const lines = buildSvgLines(state);
  if (pretty) return lines.map((l) => "  ".repeat(l.indent) + l.text).join("\n");
  return lines.map((l) => l.text).join("");
}

export function serializeProject(state: EditorState): ProjectFile {
  return {
    version: 2,
    artboard: state.artboard,
    background: state.background,
    grid: state.grid,
    images: state.images,
    elements: state.elements,
    ...namesInUse(state.elements, state.groupNames),
    ...huesInUse(state.elements, state.groupHues),
    viewport: state.viewport,
    tool: state.tool,
    finalOnly: state.finalOnly,
  };
}

/** The colours of groups that still exist, as the project file's optional `groupHues`. */
function huesInUse(
  elements: readonly SceneElement[],
  hues: Readonly<Record<string, number>>
): { groupHues?: Record<string, number> } {
  const used = new Set(elements.flatMap((e) => groupsOf(e)));
  const kept = Object.entries(hues).filter(([gid]) => used.has(gid));
  return kept.length ? { groupHues: Object.fromEntries(kept) } : {};
}

/** The names of groups that still exist, as the project file's optional `groupNames`. */
function namesInUse(
  elements: readonly SceneElement[],
  names: Readonly<Record<string, string>>
): { groupNames?: Record<string, string> } {
  const used = new Set(elements.flatMap((e) => groupsOf(e)));
  const kept = Object.entries(names).filter(([gid, name]) => used.has(gid) && name);
  return kept.length ? { groupNames: Object.fromEntries(kept) } : {};
}

export function loadProject(json: ProjectFile): void {
  // Greenfield: no migration. A document written by an older build is refused, not rewritten.
  if (json.version !== 2) {
    throw new Error(
      `This document was saved by an incompatible version (v${String(json.version)}). ` +
        "Re-import its SVG, or clear the browser storage for this app."
    );
  }
  const base = createInitialState();
  replaceState({
    ...base,
    artboard: json.artboard,
    background: json.background ?? base.background,
    grid: json.grid,
    images: (json.images || []).map((img) => ({ ...img, visible: img.visible !== false })),
    elements: json.elements || [],
    groupNames: json.groupNames ?? {},
    groupHues: json.groupHues ?? {},
    viewport: json.viewport || base.viewport,
    tool: json.tool || "select",
    finalOnly: json.finalOnly || false,
    selection: selectOnly(),
    drawing: null,
  });
}

/* ---------- Import ---------- */

/**
 * Parses a path's `d` into anchors with cubic handles, which is the only curve the model has.
 *
 * Everything else is converted: quadratics (Q/T) have an exact cubic equivalent, arcs (A) are
 * approximated by up to four cubics per quarter turn, and the shorthands (S/T) reflect the
 * previous control point. Commands also repeat implicitly - `L 1 1 2 2` is two line segments,
 * and a repeated `M` continues as `L` - which is how most tools write their output.
 */
function parsePathD(d: string): { points: Anchor[]; closed: boolean } {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points: Anchor[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let subStart: Point | null = null;
  let command = "";
  let relative = false;
  // The control point the smooth shorthands reflect, and which curve kind set it.
  let lastControl: Point | null = null;
  let lastCurve: "cubic" | "quad" | "" = "";

  const readNum = () => parseFloat(tokens[i++] ?? "0");
  const last = (): Anchor | undefined => points[points.length - 1];
  const isCommand = (t: string | undefined) => !!t && /^[a-zA-Z]$/.test(t);

  const corner = (x: number, y: number) => {
    points.push({ x, y, smooth: false, hIn: null, hOut: null });
    lastControl = null;
    lastCurve = "";
  };

  /** Appends a cubic segment from the current point to (x, y). */
  const cubic = (c1: Point, c2: Point, x: number, y: number, kind: "cubic" | "quad") => {
    const from = last();
    if (from) {
      from.hOut = { x: c1.x, y: c1.y };
      from.smooth = true;
    }
    points.push({ x, y, smooth: true, hIn: { x: c2.x, y: c2.y }, hOut: { x, y } });
    lastControl = c2;
    lastCurve = kind;
  };

  /** A quadratic control point becomes the two cubic ones that draw the same curve. */
  const quadToCubic = (q: Point, x: number, y: number) => {
    const from = last() ?? { x: cx, y: cy };
    cubic(
      { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) },
      { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
      x,
      y,
      "quad"
    );
  };

  /** The reflection of the previous control point, or the current point when there is none. */
  const reflected = (kind: "cubic" | "quad"): Point => {
    const from = last();
    if (!from) return { x: cx, y: cy };
    if (!lastControl || lastCurve !== kind) return { x: from.x, y: from.y };
    return { x: 2 * from.x - lastControl.x, y: 2 * from.y - lastControl.y };
  };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) {
      command = tokens[i++]!;
      relative = command === command.toLowerCase();
      // A repeated moveto draws lines, per the SVG grammar.
    } else if (!command) {
      i++;
      continue;
    } else if (command === "M" || command === "m") {
      command = relative ? "l" : "L";
    }

    const c = command.toUpperCase();
    const ox = relative ? cx : 0;
    const oy = relative ? cy : 0;

    if (c === "M") {
      cx = readNum() + ox;
      cy = readNum() + oy;
      subStart = { x: cx, y: cy };
      corner(cx, cy);
    } else if (c === "L") {
      cx = readNum() + ox;
      cy = readNum() + oy;
      corner(cx, cy);
    } else if (c === "H") {
      cx = readNum() + ox;
      corner(cx, cy);
    } else if (c === "V") {
      cy = readNum() + oy;
      corner(cx, cy);
    } else if (c === "C" || c === "S") {
      const c1 = c === "C" ? { x: readNum() + ox, y: readNum() + oy } : reflected("cubic");
      const c2 = { x: readNum() + ox, y: readNum() + oy };
      const x = readNum() + ox;
      const y = readNum() + oy;
      cubic(c1, c2, x, y, "cubic");
      cx = x;
      cy = y;
    } else if (c === "Q" || c === "T") {
      const q = c === "Q" ? { x: readNum() + ox, y: readNum() + oy } : reflected("quad");
      const x = readNum() + ox;
      const y = readNum() + oy;
      quadToCubic(q, x, y);
      cx = x;
      cy = y;
    } else if (c === "A") {
      const rx = readNum();
      const ry = readNum();
      const rot = readNum();
      const largeArc = readNum() !== 0;
      const sweep = readNum() !== 0;
      const x = readNum() + ox;
      const y = readNum() + oy;
      for (const seg of arcToCubics({ x: cx, y: cy }, rx, ry, rot, largeArc, sweep, { x, y })) {
        cubic(seg.c1, seg.c2, seg.to.x, seg.to.y, "cubic");
      }
      cx = x;
      cy = y;
    } else if (c === "Z") {
      const first = points[0];
      const end = last();
      if (subStart && first && end && end !== first && end.x === first.x && end.y === first.y) {
        // A closing curve drawn back onto the start ends on the first anchor. It is that anchor,
        // arriving: keep its incoming handle and drop the copy, or every re-import grows one.
        first.hIn = end.hIn;
        first.smooth = first.smooth || end.smooth;
        points.pop();
      } else if (subStart && first && points.length > 2) {
        if (first.x !== cx || first.y !== cy) corner(first.x, first.y);
      }
      cx = subStart?.x ?? cx;
      cy = subStart?.y ?? cy;
      lastControl = null;
      lastCurve = "";
    } else {
      // An unrecognised command: skip its numbers rather than reading them as coordinates.
      while (i < tokens.length && !isCommand(tokens[i])) i++;
    }
  }
  return { points, closed: /z/i.test(d) };
}

let colorCtx: CanvasRenderingContext2D | null = null;

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

/**
 * Turns any CSS color into #rrggbb; falls back to black.
 *
 * `#rrggbb`, `#rgb` and `rgb()/rgba()` cover what real SVG files contain and are handled here,
 * so import does not depend on a canvas being available. Anything more exotic (named colors,
 * `hsl()`, …) is handed to the browser's own parser.
 */
function normalizeColor(c: string | null): string {
  if (!c) return "#000000";
  const s = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (short)
    return `#${short[1]!}${short[1]!}${short[2]!}${short[2]!}${short[3]!}${short[3]!}`.toLowerCase();

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (rgb) return `#${hex2(+rgb[1]!)}${hex2(+rgb[2]!)}${hex2(+rgb[3]!)}`;

  if (!colorCtx) colorCtx = document.createElement("canvas").getContext("2d");
  if (!colorCtx) return "#000000";
  colorCtx.fillStyle = "#000000";
  colorCtx.fillStyle = s;
  const out = colorCtx.fillStyle;
  return typeof out === "string" && /^#[0-9a-f]{6}$/i.test(out) ? out : "#000000";
}

/** Reads a presentation property from one node's `style` attribute, else its attributes. */
function ownProp(node: Element, name: string): string | null {
  const style = node.getAttribute("style");
  if (style) {
    for (const decl of style.split(";")) {
      const i = decl.indexOf(":");
      if (i > 0 && decl.slice(0, i).trim() === name) return decl.slice(i + 1).trim();
    }
  }
  return node.getAttribute(name);
}

/** As `ownProp`, but walking up to the SVG root so inherited presentation attributes apply. */
function inheritedProp(node: Node | null, name: string): string | null {
  for (let n = node; n && n.nodeType === 1; n = n.parentNode) {
    const v = ownProp(n as Element, name);
    if (v != null) return v;
  }
  return null;
}

function findById(svg: Element, tags: string, id: string): Element | null {
  return [...svg.querySelectorAll(tags)].find((g) => g.getAttribute("id") === id) ?? null;
}

function markerFromRef(svg: Element, ref: string | null): MarkerShape {
  if (!ref || ref === "none") return "none";
  const m = ref.match(/^url\(#([^)]+)\)$/);
  if (!m) return "none";
  const marker = findById(svg, "marker", m[1]!);
  const child = marker?.firstElementChild;
  if (!child) return "arrow";
  const tag = child.tagName.toLowerCase();
  if (tag === "circle") return "dot";
  if (tag === "rect") return "square";
  if (tag === "path" && /L5,10/.test(child.getAttribute("d") ?? "")) return "diamond";
  return "arrow";
}

function gradientStyle(svg: Element, ref: string, style: StyleCarrier): void {
  const grad = findById(svg, "linearGradient,radialGradient", ref);
  const stops = grad ? [...grad.querySelectorAll("stop")] : [];
  if (!grad || !stops.length) {
    style.fillEnabled = false;
    return;
  }
  const radial = grad.tagName.toLowerCase() === "radialgradient";
  style.fillType = radial ? "radial" : "linear";
  style.gradStops = stops.map((stop, i) => ({
    offset: parseFractional(stop.getAttribute("offset"), i / Math.max(1, stops.length - 1)),
    color: normalizeColor(ownProp(stop, "stop-color")),
    opacity: parseFloat(ownProp(stop, "stop-opacity") ?? "1") || 0,
  }));
  // The first stop doubles as the solid colour, so turning the gradient off keeps something.
  style.fill = style.gradStops[0]!.color;
  style.fillOpacity = style.gradStops[0]!.opacity;

  const num = (a: string, d: number) => parseFractional(grad.getAttribute(a), d);
  if (radial) {
    const cx = num("cx", 0.5);
    const cy = num("cy", 0.5);
    const r = num("r", 0.5);
    style.gradFrom = { x: cx, y: cy };
    style.gradTo = { x: cx + r, y: cy };
  } else {
    style.gradFrom = { x: num("x1", 0), y: num("y1", 0) };
    style.gradTo = { x: num("x2", 1), y: num("y2", 0) };
  }
  // userSpaceOnUse coordinates are in artboard units; they are converted once the element
  // exists and its bounding box is known (see importSvgFile).
  if (grad.getAttribute("gradientUnits") === "userSpaceOnUse") style.gradUserSpace = true;
}

/** A gradient coordinate or offset: a plain number, or a percentage. */
function parseFractional(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const value = parseFloat(raw.replace("%", ""));
  if (Number.isNaN(value)) return fallback;
  return raw.includes("%") ? value / 100 : value;
}

function styleFromNode(node: Element, svg: Element): StyleCarrier {
  const strokeAttr = inheritedProp(node, "stroke");
  const hasStroke = strokeAttr != null && strokeAttr !== "none";
  const fillAttr = inheritedProp(node, "fill");
  const style: StyleCarrier = {
    stroke: hasStroke ? normalizeColor(strokeAttr) : "#000000",
    strokeOpacity: parseFloat(inheritedProp(node, "stroke-opacity") ?? "1"),
    strokeWidth: hasStroke ? parseFloat(inheritedProp(node, "stroke-width") || "1") : 0,
    linecap: (inheritedProp(node, "stroke-linecap") as StyleCarrier["linecap"]) || "round",
    linejoin: (inheritedProp(node, "stroke-linejoin") as StyleCarrier["linejoin"]) || "round",
    fillEnabled: false,
    fillType: "solid",
    fill: "#000000",
    fillOpacity: parseFloat(inheritedProp(node, "fill-opacity") ?? "1"),
  };
  // No fill attribute anywhere and no stroke: SVG's default (black fill) is all that is visible.
  if (fillAttr == null && !hasStroke) style.fillEnabled = true;
  else if (fillAttr != null && fillAttr !== "none") {
    style.fillEnabled = true;
    const ref = fillAttr.match(/^url\(#([^)]+)\)$/);
    if (ref) gradientStyle(svg, ref[1]!, style);
    else style.fill = normalizeColor(fillAttr);
  }
  if (inheritedProp(node, "display") === "none") style.hidden = true;
  const ms = inheritedProp(node, "marker-start");
  const me = inheritedProp(node, "marker-end");
  if (ms) style.markerStart = markerFromRef(svg, ms);
  if (me) style.markerEnd = markerFromRef(svg, me);
  return style;
}

const NON_RENDERED = [
  "defs",
  "marker",
  "clippath",
  "mask",
  "pattern",
  "symbol",
  "lineargradient",
  "radialgradient",
];

function insideNonRendered(node: Element, svg: Element): boolean {
  for (let n = node.parentNode; n && n !== svg; n = n.parentNode) {
    const tag = (n as Element).tagName?.toLowerCase();
    if (tag && NON_RENDERED.includes(tag)) return true;
  }
  return false;
}

function parsePoints(str: string | null): Point[] {
  const nums = (str ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i]!, y: nums[i + 1]! });
  return points;
}

/** Name for an imported node: a <title>, the name half of one of our ids, or a foreign id. */
function nameFromNode(node: Element, nodeId: string | null): string | null {
  const titleText = node.querySelector(":scope > title")?.textContent?.trim();
  if (titleText) return titleText;
  if (!nodeId) return null;
  const m = nodeId.match(NAMED_ID);
  if (m) return m[1]!;
  return AUTO_ID.test(nodeId) ? null : nodeId;
}

function elementFromNode(node: Element, tag: string, style: StyleCarrier): SceneElement | null {
  const num = (a: string) => parseFloat(node.getAttribute(a) ?? "");
  switch (tag) {
    case "path": {
      const { points, closed } = parsePathD(node.getAttribute("d") ?? "");
      return createPath(points, closed, style);
    }
    case "line":
      return createLine(num("x1"), num("y1"), num("x2"), num("y2"), style);
    case "rect": {
      const el = createRect(num("x") || 0, num("y") || 0, num("width"), num("height"), style);
      const rx = num("rx");
      const ry = num("ry");
      el.rx = rx || ry || 0;
      if (rx && ry && rx !== ry) el.ry = ry;
      return el;
    }
    case "circle":
      return createCircle(num("cx"), num("cy"), num("r"), style);
    case "ellipse":
      return createEllipse(num("cx"), num("cy"), num("rx"), num("ry"), style);
    case "polyline":
      return createPolyline(parsePoints(node.getAttribute("points")), style);
    case "polygon":
      return createPolygon(parsePoints(node.getAttribute("points")), style);
    case "text": {
      const el = createText(num("x") || 0, num("y") || 0, node.textContent?.trim() ?? "", style);
      el.fontSize = parseFloat(inheritedProp(node, "font-size") || "48") || 48;
      el.fontFamily = inheritedProp(node, "font-family") || "sans-serif";
      el.anchor = (inheritedProp(node, "text-anchor") as typeof el.anchor) || "start";
      return el;
    }
    default:
      return null;
  }
}

/**
 * Rewrites a gradient written in artboard units into the fractions of the shape's bounding box
 * that the model stores, so the gradient keeps following the shape when it is moved or resized.
 */
function toBoundingBoxUnits(el: SceneElement): void {
  const box = elementBBox(el);
  if (!box) return;
  const w = box.width || 1;
  const h = box.height || 1;
  const map = (p: Point): Point => ({ x: (p.x - box.x) / w, y: (p.y - box.y) / h });
  el.gradFrom = map(el.gradFrom);
  el.gradTo = map(el.gradTo);
}

export interface ImportResult {
  artboard: { width: number; height: number } | null;
  /** The background rect the file carried, or null when it has none: a transparent document. */
  background: BackgroundPaint | null;
  elements: SceneElement[];
  /** Group names read from `<g id>`s, by the group ids the elements carry. */
  groupNames: Record<string, string>;
}

/** `keepIds` restores generated ids from the markup (used when editing the SVG text in place). */
export function importSvgFile(text: string, { keepIds = false } = {}): ImportResult {
  // A DOCTYPE is the only way to declare entities, so refusing it rules out entity-expansion
  // bombs; SVG written by editors does not need one.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("SVG with a DOCTYPE is not supported");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    const message = err.textContent?.match(/(?:error on )?line \d+[^\n]*/i)?.[0] ?? "Invalid SVG";
    throw new Error(message);
  }
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("No SVG root found");

  let artboard: ImportResult["artboard"] = null;
  const parts = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  if (parts.length === 4) artboard = { width: parts[2]!, height: parts[3]! };
  const w = parseFloat(svg.getAttribute("width") ?? "");
  const h = parseFloat(svg.getAttribute("height") ?? "");
  if (!artboard && w && h) artboard = { width: w, height: h };

  // The background is a rect like any other; only its id says it is the document's, and it is
  // read here rather than swept up as a shape.
  const bgNode = [...svg.children].find(
    (c) => c.tagName.toLowerCase() === "rect" && c.getAttribute("id") === BACKGROUND_ID
  );
  const background: BackgroundPaint | null = bgNode
    ? {
        color: normalizeColor(bgNode.getAttribute("fill")),
        opacity: parseFractional(bgNode.getAttribute("fill-opacity"), 1),
      }
    : null;

  const imported: SceneElement[] = [];
  const groupIds = new Map<Element, string>();
  const groupNames: Record<string, string> = {};
  const usedIds = new Set<string>();
  svg.querySelectorAll(ELEMENT_SELECTOR).forEach((node) => {
    if (node === bgNode) return;
    if (insideNonRendered(node, svg)) return;
    const style = styleFromNode(node, svg);
    const nodeId = node.getAttribute("id");
    const name = nameFromNode(node, nodeId);
    if (name) style.name = name;
    const { chain, matrix } = ancestry(node, svg, groupIds, groupNames, keepIds);
    if (chain.length) style.groups = chain;
    const el = elementFromNode(node, node.tagName.toLowerCase(), style);
    if (!el) return;
    if (keepIds) {
      const rid = elementIdFromSvgId(nodeId);
      if (rid && !usedIds.has(rid)) el.id = rid;
      usedIds.add(el.id);
    }
    // An element's own transform, and every <g transform> above it, are baked into the
    // coordinates here: the scene graph has no transform of its own.
    const own = multiply(matrix, parseTransform(node.getAttribute("transform")));
    const placed = isIdentity(own) ? el : transformElement(el, own);
    if (style.gradUserSpace) toBoundingBoxUnits(placed);
    imported.push(placed);
  });

  const elements = normalizeGroups(pruneGroups(imported));
  return { artboard, background, elements, ...withNames(elements, groupNames) };
}

/** Group names for the groups that survived pruning (a group of one is no group). */
function withNames(
  elements: readonly SceneElement[],
  names: Record<string, string>
): { groupNames: Record<string, string> } {
  return { groupNames: namesInUse(elements, names).groupNames ?? {} };
}

/**
 * Walks from the SVG root down to `node`: the chain of groups it belongs to (outermost first)
 * and the transform those groups apply to it.
 */
function ancestry(
  node: Element,
  svg: Element,
  groupIds: Map<Element, string>,
  groupNames: Record<string, string>,
  keepIds: boolean
): { chain: string[]; matrix: Matrix } {
  const groups: Element[] = [];
  for (let g = node.parentNode; g && g !== svg; g = g.parentNode) {
    const gEl = g as Element;
    if (gEl.tagName?.toLowerCase() === "g") groups.unshift(gEl);
  }
  const chain: string[] = [];
  let matrix: Matrix = IDENTITY;
  for (const gEl of groups) {
    if (!groupIds.has(gEl)) {
      // Our own ids carry the group's name after the first "_"; any other id is itself a name,
      // the way a foreign id on a shape is.
      const raw = gEl.getAttribute("id") ?? "";
      const own = raw.match(GROUP_ID);
      const gid = keepIds && own ? own[1]! : uid("group");
      const name = own ? own[2] : raw;
      groupIds.set(gEl, gid);
      if (name) groupNames[gid] = name;
    }
    chain.push(groupIds.get(gEl)!);
    matrix = multiply(matrix, parseTransform(gEl.getAttribute("transform")));
  }
  return { chain, matrix };
}
