import {
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
  geometryOf,
  styleAttrs,
} from "./model.js";
import { ELEMENT_SELECTOR, escapeAttr, escapeXml, uid } from "./utils.js";
import { groupsOf, normalizeGroups, pruneGroups } from "./groups.js";
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
  EditorState,
  MarkerShape,
  ProjectFile,
  Point,
  SceneElement,
  StyleCarrier,
} from "./types.js";

const NS = "http://www.w3.org/2000/svg";

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
      const stops = [
        `<stop offset="0" stop-color="${el.fill}" stop-opacity="${n3(el.fillOpacity ?? 1)}"/>`,
        `<stop offset="1" stop-color="${el.fill2 ?? "#ffffff"}" stop-opacity="${n3(el.fill2Opacity ?? 1)}"/>`,
      ];
      if (el.fillType === "radial") {
        lines.push({
          indent: 0,
          text: `<radialGradient id="grad-${el.id}" cx="0.5" cy="0.5" r="0.5">`,
        });
        stops.forEach((s) => lines.push({ indent: 1, text: s }));
        lines.push({ indent: 0, text: "</radialGradient>" });
      } else {
        const a = ((el.gradAngle || 0) * Math.PI) / 180;
        const x1 = n3(0.5 - Math.cos(a) / 2);
        const y1 = n3(0.5 - Math.sin(a) / 2);
        const x2 = n3(0.5 + Math.cos(a) / 2);
        const y2 = n3(0.5 + Math.sin(a) / 2);
        lines.push({
          indent: 0,
          text: `<linearGradient id="grad-${el.id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`,
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

function buildSvgLines(state: Pick<EditorState, "artboard" | "elements">): Line[] {
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
  emitRange(state.elements, 0, state.elements.length, 0, 1, lines, ids);
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
  ids: Map<string, string>
): void {
  let i = start;
  while (i < end) {
    const gid = groupsOf(els[i])[depth];
    if (gid) {
      let j = i;
      while (j < end && groupsOf(els[j])[depth] === gid) j++;
      lines.push({ indent, text: `<g id="${gid}">` });
      emitRange(els, i, j, depth + 1, indent + 1, lines, ids);
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

export function formatExportSvg(
  state: Pick<EditorState, "artboard" | "elements">,
  pretty = false
): string {
  const lines = buildSvgLines(state);
  if (pretty) return lines.map((l) => "  ".repeat(l.indent) + l.text).join("\n");
  return lines.map((l) => l.text).join("");
}

export function serializeProject(state: EditorState): ProjectFile {
  return {
    version: 2,
    artboard: state.artboard,
    grid: state.grid,
    images: state.images,
    elements: state.elements,
    viewport: state.viewport,
    tool: state.tool,
    finalOnly: state.finalOnly,
  };
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
    grid: json.grid,
    images: (json.images || []).map((img) => ({ ...img, visible: img.visible !== false })),
    elements: json.elements || [],
    viewport: json.viewport || base.viewport,
    tool: json.tool || "select",
    finalOnly: json.finalOnly || false,
    selection: selectOnly(),
    drawing: null,
  });
}

/* ---------- Import ---------- */

function parsePathD(d: string): { points: Anchor[]; closed: boolean } {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const points: Anchor[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let subStart: Point | null = null;

  const readNum = () => parseFloat(tokens[i++] ?? "0");
  const last = (): Anchor | undefined => points[points.length - 1];
  const corner = (x: number, y: number) =>
    points.push({ x, y, smooth: false, hIn: null, hOut: null });

  while (i < tokens.length) {
    const cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();

    if (c === "M") {
      cx = readNum();
      cy = readNum();
      const p = last();
      if (rel && p) {
        cx += p.x;
        cy += p.y;
      }
      subStart = { x: cx, y: cy };
      corner(cx, cy);
    } else if (c === "L") {
      cx = readNum();
      cy = readNum();
      const p = last();
      if (rel && p) {
        cx += p.x;
        cy += p.y;
      }
      corner(cx, cy);
    } else if (c === "C") {
      const x1 = readNum();
      const y1 = readNum();
      const x2 = readNum();
      const y2 = readNum();
      cx = readNum();
      cy = readNum();
      const p = last();
      // Relative control points are offsets from the current point, absolute ones are not.
      const ox = rel && p ? p.x : 0;
      const oy = rel && p ? p.y : 0;
      if (rel) {
        cx += ox;
        cy += oy;
      }
      if (p) {
        p.hOut = { x: x1 + ox, y: y1 + oy };
        p.smooth = true;
      }
      points.push({
        x: cx,
        y: cy,
        smooth: true,
        hIn: { x: x2 + ox, y: y2 + oy },
        hOut: { x: cx, y: cy },
      });
    } else if (c === "Z") {
      if (subStart && points.length > 2) {
        const first = points[0]!;
        if (first.x !== cx || first.y !== cy) corner(first.x, first.y);
      }
      cx = subStart?.x ?? cx;
      cy = subStart?.y ?? cy;
    } else if (c === "H") {
      cx = readNum();
      const p = last();
      if (rel && p) cx += p.x;
      corner(cx, cy);
    } else if (c === "V") {
      cy = readNum();
      const p = last();
      if (rel && p) cy += p.y;
      corner(cx, cy);
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
  const stops = grad ? grad.querySelectorAll("stop") : [];
  if (!grad || !stops.length) {
    style.fillEnabled = false;
    return;
  }
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  style.fillType = grad.tagName.toLowerCase() === "radialgradient" ? "radial" : "linear";
  style.fill = normalizeColor(ownProp(first, "stop-color"));
  style.fillOpacity = parseFloat(ownProp(first, "stop-opacity") ?? "1");
  style.fill2 = normalizeColor(ownProp(last, "stop-color"));
  style.fill2Opacity = parseFloat(ownProp(last, "stop-opacity") ?? "1");
  if (style.fillType !== "linear") return;
  const num = (a: string, d: number) => {
    const raw = String(grad.getAttribute(a) ?? d);
    return parseFloat(raw.replace("%", "")) / (raw.includes("%") ? 100 : 1);
  };
  const angle = Math.atan2(num("y2", 0) - num("y1", 0), num("x2", 1) - num("x1", 0));
  style.gradAngle = Math.round((angle * 180) / Math.PI);
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

export interface ImportResult {
  artboard: { width: number; height: number } | null;
  elements: SceneElement[];
}

/** `keepIds` restores generated ids from the markup (used when editing the SVG text in place). */
export function importSvgFile(text: string, { keepIds = false } = {}): ImportResult {
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

  const imported: SceneElement[] = [];
  const groupIds = new Map<Element, string>();
  const usedIds = new Set<string>();
  svg.querySelectorAll(ELEMENT_SELECTOR).forEach((node) => {
    if (insideNonRendered(node, svg)) return;
    const style = styleFromNode(node, svg);
    const nodeId = node.getAttribute("id");
    const name = nameFromNode(node, nodeId);
    if (name) style.name = name;
    const { chain, matrix } = ancestry(node, svg, groupIds, keepIds);
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
    imported.push(isIdentity(own) ? el : transformElement(el, own));
  });

  return { artboard, elements: normalizeGroups(pruneGroups(imported)) };
}

/**
 * Walks from the SVG root down to `node`: the chain of groups it belongs to (outermost first)
 * and the transform those groups apply to it.
 */
function ancestry(
  node: Element,
  svg: Element,
  groupIds: Map<Element, string>,
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
      const gid = gEl.getAttribute("id") ?? "";
      groupIds.set(gEl, keepIds && gid.startsWith("group-") ? gid : uid("group"));
    }
    chain.push(groupIds.get(gEl)!);
    matrix = multiply(matrix, parseTransform(gEl.getAttribute("transform")));
  }
  return { chain, matrix };
}
