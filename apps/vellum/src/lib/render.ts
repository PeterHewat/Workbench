import { selectedElements, findElement } from "./state.js";
import {
  elementBBox,
  hasTwoHandles,
  localBBox,
  cornersOf,
  toWorldPoint,
  isGradient,
  cornerRadius,
  cornerRadiusY,
  canRotate,
  geometryOf,
  styleAttrs,
  DEFAULT_STROKE,
  type AttrMap,
} from "./model.js";
import { applyCameraTransform } from "./viewport.js";
import {
  cornerHandleInset,
  HIT_R_COARSE,
  HIT_R_FINE,
  isCoarsePointer,
  ROTATE_REACH_COARSE,
  ROTATE_REACH_FINE,
} from "./pointer.js";
import { buildDefsMarkup } from "./io.js";
import { hasBoxHandles } from "./resize.js";
import { pickedPoints } from "./points.js";
import { BOX_ROLES, boxCorners, unionBox } from "./selection-transform.js";
import { clickTarget, groupColor, groupsOf, selectedGroups } from "./groups.js";
import type {
  BBox,
  EditorState,
  PathElement,
  Point,
  RectElement,
  Preview,
  SceneElement,
} from "./types.js";

const NS = "http://www.w3.org/2000/svg";
const HIT_MIN_PX = 10;
/** Visible handle radius, in screen pixels: handles keep one size at every zoom level. */
const HANDLE_R = 5;

/** How far the rotate handle sits above the shape, in screen pixels. */
function rotateOffset(): number {
  return isCoarsePointer() ? ROTATE_REACH_COARSE : ROTATE_REACH_FINE;
}

/** Set once per render so the helpers below can size handles in screen pixels. */
let zoom = 1;

export interface RenderTargets {
  artboardChecks: SVGRectElement;
  artboardBg: SVGRectElement;
  images: SVGGElement;
  grid: SVGGElement;
  document: SVGGElement;
  overlay: SVGGElement;
  /** Above the overlay: what follows the pointer (hover outline, snap mark, guides). */
  pointer: SVGGElement;
}

let els: RenderTargets;

export function initRender(dom: RenderTargets): void {
  els = dom;
}

function clearChildren(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setAttrs(node: Element, attrs: AttrMap): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
}

function add<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attrs: AttrMap
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  setAttrs(node, attrs);
  parent.appendChild(node);
  return node;
}

function draftStroke(preview: Preview): AttrMap {
  const stroke = "stroke" in preview ? preview.stroke : undefined;
  const width = "strokeWidth" in preview ? preview.strokeWidth : undefined;
  return {
    fill: "none",
    stroke: stroke ?? DEFAULT_STROKE.stroke,
    "stroke-width": width ?? DEFAULT_STROKE.strokeWidth,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };
}

let gridKey = "";

function renderGrid(state: EditorState): void {
  const step = state.grid.step;
  const { width, height } = state.artboard;
  const shown = state.grid.visible && !state.finalOnly && step > 1;
  const key = shown ? `${step}|${width}|${height}` : "";
  if (key === gridKey) return;
  gridKey = key;
  clearChildren(els.grid);
  if (!shown) return;
  for (let x = 0; x <= width; x += step) {
    add(els.grid, "line", { class: "grid-line", x1: x, y1: 0, x2: x, y2: height });
  }
  for (let y = 0; y <= height; y += step) {
    add(els.grid, "line", { class: "grid-line", x1: 0, y1: y, x2: width, y2: y });
  }
}

/**
 * Reference images, kept from one render to the next. A data URL runs to megabytes, and handing
 * it to the `<image>` again on every render made the browser take it in again each time.
 */
const drawnImages = new Map<string, { g: SVGGElement; image: SVGImageElement; dataUrl: string }>();

function renderImages(state: EditorState): void {
  const wanted = state.finalOnly ? [] : state.images.filter((img) => img.visible !== false);
  const nodes: Node[] = [];
  const live = new Set<string>();
  for (const img of wanted) {
    live.add(img.id);
    let drawn = drawnImages.get(img.id);
    if (!drawn) {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("data-image-id", img.id);
      const image = add(g, "image", {
        x: 0,
        y: 0,
        preserveAspectRatio: "none",
        "pointer-events": "none",
      });
      drawn = { g, image, dataUrl: "" };
      drawnImages.set(img.id, drawn);
    }
    setChangedAttrs(drawn.g, {
      transform: `translate(${img.x} ${img.y}) rotate(${img.rotation}) scale(${img.scaleX} ${img.scaleY})`,
    });
    setChangedAttrs(drawn.image, {
      opacity: img.opacity,
      width: img.naturalWidth || 200,
      height: img.naturalHeight || 200,
    });
    if (drawn.dataUrl !== img.dataUrl) {
      drawn.image.setAttribute("href", img.dataUrl);
      drawn.image.setAttributeNS("http://www.w3.org/1999/xlink", "href", img.dataUrl);
      drawn.dataUrl = img.dataUrl;
    }
    nodes.push(drawn.g);
  }
  for (const id of drawnImages.keys()) if (!live.has(id)) drawnImages.delete(id);
  placeChildren(els.images, nodes);
}

/** Sets only the attributes whose value differs, so an unchanged node is left untouched. */
function setChangedAttrs(node: Element, attrs: AttrMap): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    const value = String(v);
    if (node.getAttribute(k) !== value) node.setAttribute(k, value);
  }
}

function renderElement(el: SceneElement): SVGElement | null {
  const g = geometryOf(el);
  if (!g) return null;
  const node = document.createElementNS(NS, g.tag);
  setAttrs(node, { ...styleAttrs(el), ...g.attrs });
  if (g.text !== undefined) node.textContent = g.text;
  node.setAttribute("data-element-id", el.id);
  // A shape with neither stroke nor fill paints nothing; keep it clickable so it can be found.
  const invisible =
    (el.strokeWidth === 0 || el.stroke === "none") && !el.fillEnabled && el.type !== "text";
  // A locked shape lets presses through to whatever is under it.
  node.setAttribute("pointer-events", el.locked ? "none" : invisible ? "all" : "visiblePainted");
  return node;
}

/** An unfilled copy of a shape's outline, used as the wide click target on a thin stroke. */
function outlineNode(el: SceneElement, attrs: AttrMap): SVGElement | null {
  const g = geometryOf(el);
  if (!g) return null;
  const node = document.createElementNS(NS, g.tag);
  setAttrs(node, {
    ...g.attrs,
    fill: "none",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    ...attrs,
  });
  if (g.text !== undefined) node.textContent = g.text;
  return node;
}

/**
 * The nodes drawn for each element, with a key made of everything they were drawn from. A render
 * reuses them while the key still matches and redraws only the elements that changed: rebuilding
 * every node on every change was most of the cost of a drag in a large document, both in making
 * the nodes and in the browser styling them all again.
 */
const drawnElements = new Map<string, { key: string; nodes: SVGElement[] }>();
let drawnDefs: { markup: string; node: SVGDefsElement } | null = null;

function drawElement(el: SceneElement, minHit: number): SVGElement[] {
  const node = renderElement(el);
  if (!node) return [];
  if (el.type === "text" || el.locked) return [node];
  // Transparent, wider copy of the outline so thin strokes are easy to click.
  const hit = outlineNode(el, {
    stroke: "transparent",
    "stroke-width": Math.max(el.strokeWidth || 0, minHit),
    class: "hit-area",
    "pointer-events": "stroke",
    "data-element-id": el.id,
  });
  return hit ? [node, hit] : [node];
}

/** Everything `drawElement` reads, as one string: equal keys draw identical nodes. */
function elementKey(el: SceneElement, minHit: number): string {
  const g = geometryOf(el);
  if (!g) return "";
  const hitWidth = el.type === "text" ? 0 : Math.max(el.strokeWidth || 0, minHit);
  return `${g.tag}|${JSON.stringify({ ...styleAttrs(el), ...g.attrs })}|${g.text ?? ""}|${hitWidth}|${el.locked ? 1 : 0}`;
}

function renderDocument(state: EditorState): void {
  const nodes: Node[] = [];
  const defsMarkup = buildDefsMarkup(state.elements);
  if (!defsMarkup) drawnDefs = null;
  else if (drawnDefs?.markup !== defsMarkup) {
    const node = document.createElementNS(NS, "defs");
    node.innerHTML = defsMarkup;
    drawnDefs = { markup: defsMarkup, node };
  }
  if (drawnDefs) nodes.push(drawnDefs.node);

  const minHit = HIT_MIN_PX / state.viewport.zoom;
  const live = new Set<string>();
  for (const el of state.elements) {
    // A hidden shape is not drawn, so it cannot be clicked, hovered or selected on the canvas.
    if (el.hidden) continue;
    // While a text element is being edited in place, the overlay input is what shows its
    // content, so the SVG text itself would only double up half a pixel off.
    if (el.id === state.ui.editingTextId) continue;
    live.add(el.id);
    const key = elementKey(el, minHit);
    let drawn = drawnElements.get(el.id);
    if (!drawn || drawn.key !== key) {
      drawn = { key, nodes: drawElement(el, minHit) };
      drawnElements.set(el.id, drawn);
    }
    nodes.push(...drawn.nodes);
  }
  for (const id of drawnElements.keys()) if (!live.has(id)) drawnElements.delete(id);
  placeChildren(els.document, nodes);
}

/**
 * Makes `parent`'s children exactly `wanted`, in order, touching only what is out of place:
 * the nodes no longer wanted go first, then each wanted node moves only if it is not already
 * where it belongs.
 */
function placeChildren(parent: Element, wanted: readonly Node[]): void {
  const keep = new Set(wanted);
  for (const child of [...parent.childNodes]) if (!keep.has(child)) child.remove();
  let at: ChildNode | null = parent.firstChild;
  for (const node of wanted) {
    if (node === at) at = at.nextSibling;
    else parent.insertBefore(node, at);
  }
}

/**
 * A handle is two circles: a transparent, finger-sized target carrying the data attributes the
 * hit test reads, and the small visible dot on top of it. Keeping the two apart lets the target
 * grow for touch without the dot turning into a blob.
 */
function addHandle(
  parent: Element,
  x: number,
  y: number,
  cls: string,
  data: AttrMap = {},
  hitR = defaultHitR()
): SVGCircleElement {
  // No data attributes means nothing to grab (the pen's draft anchor), so no target either.
  if (Object.keys(data).length) {
    add(parent, "circle", {
      class: `handle-hit${isCoarsePointer() ? " coarse" : ""}`,
      cx: x,
      cy: y,
      r: hitR / zoom,
      ...data,
    });
  }
  return add(parent, "circle", {
    class: `handle ${cls}`,
    cx: x,
    cy: y,
    r: HANDLE_R / zoom,
    ...data,
  });
}

function defaultHitR(): number {
  return isCoarsePointer() ? HIT_R_COARSE : HIT_R_FINE;
}

/**
 * The target radius for one point of a run, shrunk so neighbouring points stay reachable when
 * they are closer together than a fingertip. Only the immediate neighbours are checked: they are
 * the ones that crowd in practice, and this runs on every pointer move.
 */
function hitRForPoint(points: readonly Point[], i: number): number {
  const p = points[i];
  if (!p) return defaultHitR();
  let nearest = Infinity;
  for (const j of [i - 1, i + 1]) {
    const q = points[j];
    if (q) nearest = Math.min(nearest, Math.hypot(q.x - p.x, q.y - p.y) * zoom);
  }
  if (!Number.isFinite(nearest)) return defaultHitR();
  return Math.max(HANDLE_R + 1, Math.min(defaultHitR(), nearest / 2));
}

function addHandleLine(
  parent: Element,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  broken = false
): void {
  add(parent, "line", {
    class: `handle-line${broken ? " handle-line--broken" : ""}`,
    x1,
    y1,
    x2,
    y2,
  });
}

/** Where the rotate handle sits, and the top-centre of the shape it hangs from, in world units. */
function rotateHandlePlacement(
  el: SceneElement,
  zoomLevel: number
): { top: Point; out: Point } | null {
  const box = localBBox(el);
  if (!box) return null;
  const reach = rotateOffset() / zoomLevel;
  const cx = box.x + box.width / 2;
  return {
    top: toWorldPoint(el, { x: cx, y: box.y }),
    out: toWorldPoint(el, { x: cx, y: box.y - reach }),
  };
}

/** Where a rect's square handle sits, in the rect's own frame: outside its bottom-right corner. */
function squareHandleLocal(el: RectElement, zoomLevel: number): Point {
  const off = cornerHandleInset() / zoomLevel;
  return { x: el.x + el.width + off, y: el.y + el.height + off };
}

/**
 * The handles that stand outside a shape's own outline (the rotate handle, a rect's square
 * handle), in world units and wherever the rotation has put them. Whatever floats beside the
 * selection has to keep clear of these, on whichever side they end up.
 */
export function outerHandlePoints(
  el: SceneElement,
  zoomLevel: number,
  rotatable: boolean
): Point[] {
  const points: Point[] = [];
  if (rotatable) {
    const place = rotateHandlePlacement(el, zoomLevel);
    if (place) points.push(place.out);
  }
  if (el.type === "rect") points.push(toWorldPoint(el, squareHandleLocal(el, zoomLevel)));
  const box = hasBoxHandles(el) ? elementBBox(el) : null;
  if (box) {
    const off = cornerHandleInset() / zoomLevel;
    points.push(
      { x: box.x - off, y: box.y - off },
      { x: box.x + box.width + off, y: box.y + box.height + off }
    );
  }
  return points;
}

/** How far a handle's dot reaches from its centre, in screen pixels. */
export const HANDLE_EXTENT = HANDLE_R;

function renderRotateHandle(parent: Element, el: SceneElement, state: EditorState): void {
  const place = rotateHandlePlacement(el, zoom);
  if (!place) return;
  const { top, out } = place;
  const rot = state.drawing?.rotateHandle;
  const rotating = rot && rot.elementId === el.id ? rot : null;
  const hx = rotating ? rotating.x : out.x;
  const hy = rotating ? rotating.y : out.y;
  addHandleLine(parent, rotating ? rotating.cx : top.x, rotating ? rotating.cy : top.y, hx, hy);
  addHandle(parent, hx, hy, "rotate-handle", {
    "data-element-id": el.id,
    "data-handle-role": "rotate",
  });
}

function addResizeHandle(
  parent: Element,
  x: number,
  y: number,
  elementId: string,
  role: string,
  selected = false,
  hitR = defaultHitR()
): void {
  const kind =
    role === "uniform"
      ? "anchor uniform-handle"
      : role.startsWith("box-")
        ? "anchor box-handle"
        : "anchor";
  addHandle(
    parent,
    x,
    y,
    `${kind}${selected ? " selected" : ""}`,
    { "data-element-id": elementId, "data-handle-role": role },
    hitR
  );
}

/** The picked points, as "<shape id>:<index>", for marking their handles. */
function pickedKeys(state: EditorState): Set<string> {
  return new Set(pickedPoints(state.selection).map((p) => `${p.pathId}:${p.index}`));
}

function renderPrimitiveHandles(parent: Element, el: SceneElement, state: EditorState): void {
  const picked = pickedKeys(state);
  // Handles are placed in the shape's own unrotated frame and then turned with it, so a rotated
  // rect still has rect handles rather than losing them to a conversion.
  const put = (x: number, y: number, role: string, selected = false, hitR?: number) => {
    const p = toWorldPoint(el, { x, y });
    addResizeHandle(parent, p.x, p.y, el.id, role, selected, hitR);
  };
  /** A faint tether from a handle to the corner it belongs to, so the pairing is visible. */
  const tether = (fromX: number, fromY: number, toX: number, toY: number) => {
    const a = toWorldPoint(el, { x: fromX, y: fromY });
    const b = toWorldPoint(el, { x: toX, y: toY });
    add(parent, "line", { class: "handle-tether", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  };
  switch (el.type) {
    case "rect": {
      put(el.x, el.y, "tl");
      put(el.x + el.width, el.y, "tr");
      put(el.x, el.y + el.height, "bl");
      put(el.x + el.width, el.y + el.height, "br");
      const off = cornerHandleInset() / zoom;
      // Each of the two extra handles is tethered to the corner it works from, so which is
      // which is visible rather than something to remember. The radius handle's distance from
      // the corner is the radius itself, unclamped: holding it inside the rect made it stick at
      // the middle while the radius kept growing, and bent its path on a rect that is not square.
      const radiusX = el.x + el.width - off - cornerRadius(el);
      const radiusY = el.y + off + cornerRadiusY(el);
      tether(radiusX, radiusY, el.x + el.width, el.y);
      put(radiusX, radiusY, "corner");
      // Just outside the bottom-right corner, the same distance out as the radius handle is in:
      // drag it and the rect stays a square.
      const square = squareHandleLocal(el, zoom);
      tether(square.x, square.y, el.x + el.width, el.y + el.height);
      put(square.x, square.y, "uniform");
      break;
    }
    case "circle":
      put(el.cx + el.r, el.cy, "radius");
      break;
    case "ellipse": {
      put(el.cx + el.rx, el.cy, "rx");
      put(el.cx, el.cy + el.ry, "ry");
      // On the diagonal between them: drag it and the ellipse stays a circle.
      const d = Math.SQRT1_2;
      tether(el.cx, el.cy, el.cx + el.rx * d, el.cy + el.ry * d);
      put(el.cx + el.rx * d, el.cy + el.ry * d, "uniform");
      break;
    }
    case "line":
      put(el.x1, el.y1, "p1", picked.has(`${el.id}:0`));
      put(el.x2, el.y2, "p2", picked.has(`${el.id}:1`));
      break;
    case "polyline":
    case "polygon":
      el.points.forEach((p, i) =>
        put(p.x, p.y, `pt-${i}`, picked.has(`${el.id}:${i}`), hitRForPoint(el.points, i))
      );
      break;
  }
}

function renderPathHandles(parent: Element, path: PathElement, state: EditorState): void {
  const pe = state.selection.pathEdit;
  const picked = pickedKeys(state);
  // Curve handles first, anchors after: the anchor sits on top wherever the two overlap.
  path.points.forEach((p, i) => {
    // A cusp's arms are dashed: the pair is broken, and each handle moves on its own.
    const broken = !p.smooth && hasTwoHandles(p);
    for (const kind of ["in", "out"] as const) {
      const h = kind === "in" ? p.hIn : p.hOut;
      if (!h || (h.x === p.x && h.y === p.y)) continue;
      addHandleLine(parent, p.x, p.y, h.x, h.y, broken);
      const reach = Math.hypot(h.x - p.x, h.y - p.y) * zoom;
      const picked = pe?.pathId === path.id && pe.index === i && pe.handle === kind;
      addHandle(
        parent,
        h.x,
        h.y,
        `handle-${kind}${picked ? " selected" : ""}`,
        { "data-path-id": path.id, "data-point-index": i, "data-handle-kind": kind },
        Math.max(HANDLE_R + 1, Math.min(defaultHitR(), reach / 2))
      );
    }
  });
  path.points.forEach((p, i) => {
    const selected = picked.has(`${path.id}:${i}`);
    addHandle(
      parent,
      p.x,
      p.y,
      `anchor${selected ? " selected" : ""}`,
      { "data-path-id": path.id, "data-point-index": i, "data-handle-kind": "anchor" },
      hitRForPoint(path.points, i)
    );
  });
}

/**
 * One handle off each corner of the bounding box, for the shapes whose own handles are only
 * their points: dragging one scales the shape from the opposite corner. They stand a little way
 * out on the diagonal, tethered to their corner, so they never sit on top of a point.
 */
function renderBoxHandles(parent: Element, el: SceneElement): void {
  const box = elementBBox(el);
  if (!box) return;
  const off = cornerHandleInset() / zoom;
  for (const role of BOX_ROLES) {
    const { corner, fixed } = boxCorners(box, role);
    const x = corner.x + (corner.x < fixed.x ? -off : off);
    const y = corner.y + (corner.y < fixed.y ? -off : off);
    add(parent, "line", { class: "handle-tether", x1: corner.x, y1: corner.y, x2: x, y2: y });
    addResizeHandle(parent, x, y, el.id, role);
  }
}

/** What the rotate handle of a selection of several shapes names as its element. */
export const SELECTION_HANDLE_ID = "selection";

/**
 * Handles for several shapes at once - a group, or any selection of more than one: one off each
 * corner of their shared box, which stretches them all from the opposite corner, and a rotate
 * handle above it that turns them all about its centre. What they do is baked into the shapes'
 * own coordinates (selection-transform.ts).
 */
function renderSelectionHandles(
  parent: Element,
  sel: readonly SceneElement[],
  state: EditorState
): void {
  const box = unionBox(sel);
  if (!box) return;
  const off = cornerHandleInset() / zoom;
  const data = (role: string) => ({ "data-selection-handle": "1", "data-handle-role": role });
  if (box.width > 0 || box.height > 0) {
    for (const role of BOX_ROLES) {
      const { corner, fixed } = boxCorners(box, role);
      const x = corner.x + (corner.x < fixed.x ? -off : off);
      const y = corner.y + (corner.y < fixed.y ? -off : off);
      add(parent, "line", { class: "handle-tether", x1: corner.x, y1: corner.y, x2: x, y2: y });
      addHandle(parent, x, y, "anchor box-handle", data(role));
    }
  }
  const rot = state.drawing?.rotateHandle;
  const turning = rot?.elementId === SELECTION_HANDLE_ID ? rot : null;
  const top = { x: box.x + box.width / 2, y: box.y };
  const hx = turning ? turning.x : top.x;
  const hy = turning ? turning.y : top.y - rotateOffset() / zoom;
  addHandleLine(parent, turning ? turning.cx : top.x, turning ? turning.cy : top.y, hx, hy);
  addHandle(parent, hx, hy, "rotate-handle", data("rotate"));
}

/** Where a selection's own handles reach beyond its shapes, for the bar to keep clear of. */
export function selectionHandlePoints(sel: readonly SceneElement[], zoomLevel: number): Point[] {
  const box = sel.length > 1 ? unionBox(sel) : null;
  if (!box) return [];
  const off = cornerHandleInset() / zoomLevel;
  return [
    { x: box.x - off, y: box.y - rotateOffset() / zoomLevel },
    { x: box.x + box.width + off, y: box.y + box.height + off },
  ];
}

/**
 * Where a gradient runs, as two handles on the shape. Stored in fractions of the bounding box,
 * so the gradient follows the shape; drawn in world units here. Dragging them is what replaced
 * typing an angle, and it can express what an angle could not - an off-centre radial, a linear
 * that only covers part of the shape.
 */
function renderGradientHandles(parent: Element, el: SceneElement): void {
  const box = elementBBox(el);
  if (!box || !isGradient(el)) return;
  const at = (p: Point) => ({ x: box.x + p.x * box.width, y: box.y + p.y * box.height });
  const from = at(el.gradFrom);
  const to = at(el.gradTo);
  add(parent, "line", {
    class: "grad-guide",
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
  });
  for (const [point, role] of [
    [from, "grad-from"],
    [to, "grad-to"],
  ] as const) {
    addHandle(parent, point.x, point.y, "grad-handle", {
      "data-element-id": el.id,
      "data-handle-role": role,
    });
  }
}

/**
 * An outline drawn twice: a pale halo under a coloured line, so it reads on the dark canvas and
 * on a white artboard alike. `color` replaces the accent - a group's own colour, for its box.
 */
function outline(
  parent: Element,
  tag: "rect" | "polygon",
  geometry: AttrMap,
  cls: string,
  color: string | null = null
): void {
  const style = color ? `--sel: ${color}` : null;
  add(parent, tag, { ...geometry, class: `selection-halo ${cls}`, style });
  add(parent, tag, { ...geometry, class: cls, style });
}

function boxGeometry(box: BBox, pad = 0): AttrMap {
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}

function renderSelectionBox(
  parent: Element,
  el: SceneElement,
  cls = "selection-box",
  color: string | null = null
): void {
  const box = localBBox(el);
  if (!box) return;
  if (!el.rotation) {
    outline(parent, "rect", boxGeometry(box), cls, color);
    return;
  }
  // Rotated: draw the turned box itself rather than the larger upright one around it.
  const points = cornersOf(el)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
  outline(parent, "polygon", { points }, cls, color);
}

function unionOf(elements: readonly SceneElement[]): BBox | null {
  let box: BBox | null = null;
  for (const el of elements) {
    const b = elementBBox(el);
    if (b) box = box ? union(box, b) : b;
  }
  return box;
}

/**
 * One box around each selected group, in that group's colour, standing a little off its
 * members. A group that holds other groups stands further off than they do, so nested boxes
 * never sit on top of each other.
 */
function renderGroupBoxes(state: EditorState, groups: Map<string, SceneElement[]>): void {
  for (const [gid, members] of groups) {
    const box = unionOf(members);
    if (!box) continue;
    const depth = groupsOf(members[0]).indexOf(gid);
    const inner = Math.max(...members.map((e) => groupsOf(e).length - 1 - depth));
    const pad = (5 + 5 * inner) / zoom;
    const hue = state.groupHues[gid];
    outline(
      els.overlay,
      "rect",
      boxGeometry(box, pad),
      "selection-box group-box",
      hue == null ? null : groupColor(hue)
    );
  }
}

/**
 * What a click would pick, outlined before you click it.
 *
 * Hover used to redraw the shape in blue, which borrowed the one channel the shape owns - its
 * stroke - so it said nothing on a shape with no stroke, and nothing at all on a blue one. The
 * selection outline is honest about the target instead: for a grouped shape it outlines the group
 * the click will select, or, once you are inside that group, the member it will.
 */
function renderHover(state: EditorState): void {
  const hoverId = state.hoverId;
  if (!hoverId || state.drawing?.rotateHandle) return;
  const { ids, gid } = clickTarget(state.elements, new Set(state.selection.elementIds), hoverId);
  if (ids.some((id) => state.selection.elementIds.includes(id))) return;
  if (!gid) {
    const el = findElement(hoverId);
    if (el) renderSelectionBox(els.pointer, el, "selection-box hover-box");
    return;
  }
  // A grouped shape: the click will select the group, so the hover shows the group's box.
  const hue = state.groupHues[gid];
  const box = unionOf(state.elements.filter((e) => ids.includes(e.id)));
  if (!box) return;
  outline(
    els.pointer,
    "rect",
    boxGeometry(box, 5 / zoom),
    "selection-box group-box hover-box",
    hue == null ? null : groupColor(hue)
  );
}

function union(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * The most handles a selection of several shapes shows. Every handle is a few nodes redrawn on
 * every frame of a drag, so a large selection - a thousand traced shapes, say - spent most of
 * each frame on points nobody could pick out at that scale. Past this, a multi-selection shows
 * boxes only; one selected shape always shows all of its handles, however many, since editing
 * them is the reason to select it alone.
 */
const MULTI_ANCHOR_BUDGET = 400;

/** How many handles a shape shows when selected, for the budget above. */
function handleCount(el: SceneElement): number {
  switch (el.type) {
    case "path":
    case "polyline":
    case "polygon":
      return el.points.length;
    case "rect":
      return 6;
    case "ellipse":
      return 3;
    case "line":
      return 2;
    case "circle":
      return 1;
    default:
      return 0;
  }
}

function showsAnchors(sel: readonly SceneElement[]): boolean {
  if (sel.length <= 1) return true;
  let handles = 0;
  for (const el of sel) {
    handles += handleCount(el);
    if (handles > MULTI_ANCHOR_BUDGET) return false;
  }
  return true;
}

function renderOverlay(state: EditorState): void {
  clearChildren(els.overlay);
  zoom = state.viewport.zoom;
  if (state.finalOnly) return;

  const activePathId = state.drawing?.activePathId ?? null;
  if (activePathId) {
    const path = findElement(activePathId);
    if (path?.type === "path") renderPathHandles(els.overlay, path, state);
  }

  const sel = selectedElements();
  const groups = selectedGroups(state.elements, new Set(sel.map((e) => e.id)));
  renderGroupBoxes(state, groups);
  // Inside a selected group, each member's own box steps back so the group's box leads.
  const boxClass = (el: SceneElement) =>
    groupsOf(el).some((gid) => groups.has(gid)) ? "selection-box member-box" : "selection-box";
  const anchors = showsAnchors(sel);
  for (const el of sel) {
    if (el.id === activePathId) continue;
    // Locked, it shows it is selected, and offers nothing to grab.
    if (el.locked) {
      renderSelectionBox(els.overlay, el, `${boxClass(el)} locked-box`);
      continue;
    }
    if (el.type === "path") {
      // A path with a point picked keeps its points in view, whatever else is selected.
      if (anchors || state.selection.pathEdit?.pathId === el.id) {
        renderPathHandles(els.overlay, el, state);
      }
      renderSelectionBox(els.overlay, el, boxClass(el));
      continue;
    }
    renderSelectionBox(els.overlay, el, boxClass(el));
    // Every shape in a selection shows its handles, as paths show their points: grabbing one
    // narrows the selection to that shape, so a group can be edited without taking it apart.
    if (anchors || state.selection.pathEdit?.pathId === el.id) {
      renderPrimitiveHandles(els.overlay, el, state);
    }
  }
  // While points are picked the shapes' own handles are what is being edited.
  const free = !sel.some((e) => e.locked);
  if (sel.length > 1 && free && !activePathId && !state.selection.pathEdit) {
    renderSelectionHandles(els.overlay, sel, state);
  }
  if (sel.length === 1 && free && sel[0]!.id !== activePathId) {
    renderGradientHandles(els.overlay, sel[0]!);
    if (canRotate(sel[0]!)) renderRotateHandle(els.overlay, sel[0]!, state);
    if (hasBoxHandles(sel[0]!)) renderBoxHandles(els.overlay, sel[0]!);
  }

  const prev = state.drawing?.preview;
  if (prev?.type === "rubber") {
    add(els.overlay, "line", {
      class: "draft-stroke",
      ...draftStroke(prev),
      x1: prev.x1,
      y1: prev.y1,
      x2: prev.x2,
      y2: prev.y2,
    });
    addHandle(els.overlay, prev.x2, prev.y2, "anchor draft-anchor");
  } else if (prev?.type === "shape") {
    add(els.overlay, prev.tag, {
      class: "draft-stroke",
      ...draftStroke(prev),
      ...prev.nodeAttrs,
    });
  }

  const m = state.drawing?.marquee;
  if (m) {
    add(els.overlay, "rect", {
      class: "marquee",
      x: Math.min(m.x1, m.x2),
      y: Math.min(m.y1, m.y2),
      width: Math.abs(m.x2 - m.x1),
      height: Math.abs(m.y2 - m.y1),
    });
  }
}

/**
 * The part of the overlay that follows the pointer. A pointer move redraws only this: with a
 * large selection, the handles in the layer below run to thousands of nodes, and none of them
 * move with the pointer.
 */
function renderPointerLayer(state: EditorState): void {
  clearChildren(els.pointer);
  zoom = state.viewport.zoom;
  if (state.finalOnly) return;
  renderHover(state);

  const cur = state.cursor;
  if (cur.snapActive && !state.drawing?.rotateHandle) {
    const r = 6 / state.viewport.zoom;
    const g = add(els.pointer, "g", { class: "snap-indicator", "pointer-events": "none" });
    add(g, "circle", { cx: cur.snapX, cy: cur.snapY, r });
    add(g, "line", {
      x1: cur.snapX - r * 1.6,
      y1: cur.snapY,
      x2: cur.snapX + r * 1.6,
      y2: cur.snapY,
    });
    add(g, "line", {
      x1: cur.snapX,
      y1: cur.snapY - r * 1.6,
      x2: cur.snapX,
      y2: cur.snapY + r * 1.6,
    });
  }

  // The end a dragged end would merge with on release: a ring round it, so a drop that closes
  // the shape or joins two paths is announced before it happens.
  const drop = state.dropTarget;
  if (drop) {
    add(els.pointer, "circle", {
      class: "drop-target",
      cx: drop.x,
      cy: drop.y,
      r: (isCoarsePointer() ? 20 : 12) / state.viewport.zoom,
    });
  }

  const align = state.align;
  if (align.x != null) {
    add(els.pointer, "line", { class: "align-guide", x1: align.x, y1: -1e5, x2: align.x, y2: 1e5 });
  }
  if (align.y != null) {
    add(els.pointer, "line", { class: "align-guide", x1: -1e5, y1: align.y, x2: 1e5, y2: align.y });
  }
}

/** What a pointer-only change needs redrawn: the hover outline, snap mark and guides. */
export function renderPointer(state: EditorState): void {
  renderPointerLayer(state);
}

export function renderAll(state: EditorState): void {
  for (const rect of [els.artboardChecks, els.artboardBg]) {
    rect.setAttribute("width", String(state.artboard.width));
    rect.setAttribute("height", String(state.artboard.height));
  }
  els.artboardBg.setAttribute("fill", state.background.color);
  els.artboardBg.setAttribute("fill-opacity", String(state.background.opacity));
  applyCameraTransform();
  renderImages(state);
  renderGrid(state);
  renderDocument(state);
  renderOverlay(state);
  renderPointerLayer(state);
}
