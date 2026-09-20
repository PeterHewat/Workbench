import { selectedElements, findElement } from "./state.js";
import {
  elementBBox,
  cornerRadius,
  cornerRadiusY,
  canRotate,
  geometryOf,
  styleAttrs,
  DEFAULT_STROKE,
  type AttrMap,
} from "./model.js";
import { applyCameraTransform } from "./viewport.js";
import { cornerHandleInset, isCoarsePointer } from "./pointer.js";
import { buildDefsMarkup } from "./io.js";
import type {
  BBox,
  EditorState,
  PathEdit,
  PathElement,
  Point,
  Preview,
  SceneElement,
} from "./types.js";

const NS = "http://www.w3.org/2000/svg";
const HIT_MIN_PX = 10;
/** Visible handle radius, in screen pixels: handles keep one size at every zoom level. */
const HANDLE_R = 5;
/** Pointer target radius, screen pixels. Coarse is ~44px across, the usual touch minimum. */
const HIT_R_FINE = 11;
const HIT_R_COARSE = 22;

/** Set once per render so the helpers below can size handles in screen pixels. */
let zoom = 1;

export interface RenderTargets {
  artboardBg: SVGRectElement;
  images: SVGGElement;
  grid: SVGGElement;
  document: SVGGElement;
  overlay: SVGGElement;
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

function renderGrid(state: EditorState): void {
  clearChildren(els.grid);
  const step = state.grid.step;
  if (!state.grid.visible || state.finalOnly || step <= 1) return;
  const { width, height } = state.artboard;
  for (let x = 0; x <= width; x += step) {
    add(els.grid, "line", { class: "grid-line", x1: x, y1: 0, x2: x, y2: height });
  }
  for (let y = 0; y <= height; y += step) {
    add(els.grid, "line", { class: "grid-line", x1: 0, y1: y, x2: width, y2: y });
  }
}

function renderImages(state: EditorState): void {
  clearChildren(els.images);
  if (state.finalOnly) return;
  for (const img of state.images) {
    if (img.visible === false) continue;
    const g = add(els.images, "g", {
      "data-image-id": img.id,
      transform: `translate(${img.x} ${img.y}) rotate(${img.rotation}) scale(${img.scaleX} ${img.scaleY})`,
    });
    const image = add(g, "image", {
      href: img.dataUrl,
      opacity: img.opacity,
      x: 0,
      y: 0,
      width: img.naturalWidth || 200,
      height: img.naturalHeight || 200,
      preserveAspectRatio: "none",
      "pointer-events": "none",
    });
    image.setAttributeNS("http://www.w3.org/1999/xlink", "href", img.dataUrl);
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
  node.setAttribute("pointer-events", invisible ? "all" : "visiblePainted");
  return node;
}

/** An unfilled copy of a shape's outline: the wide click target, or the blue hover highlight. */
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

function renderDocument(state: EditorState): void {
  clearChildren(els.document);
  const defsMarkup = buildDefsMarkup(state.elements);
  if (defsMarkup) {
    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML = defsMarkup;
    els.document.appendChild(defs);
  }
  const minHit = HIT_MIN_PX / state.viewport.zoom;
  for (const el of state.elements) {
    const node = renderElement(el);
    if (!node) continue;
    els.document.appendChild(node);
    if (el.type === "text") continue;
    // Transparent, wider copy of the outline so thin strokes are easy to click.
    const hit = outlineNode(el, {
      stroke: "transparent",
      "stroke-width": Math.max(el.strokeWidth || 0, minHit),
      class: "hit-area",
      "pointer-events": "stroke",
      "data-element-id": el.id,
    });
    if (hit) els.document.appendChild(hit);
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

function addHandleLine(parent: Element, x1: number, y1: number, x2: number, y2: number): void {
  add(parent, "line", { class: "handle-line", x1, y1, x2, y2 });
}

function renderRotateHandle(parent: Element, el: SceneElement, state: EditorState): void {
  const box = elementBBox(el);
  if (!box) return;
  const cx = box.x + box.width / 2;
  const rot = state.drawing?.rotateHandle;
  const rotating = rot && rot.elementId === el.id ? rot : null;
  const hx = rotating ? rotating.x : cx;
  const hy = rotating ? rotating.y : box.y - (isCoarsePointer() ? 48 : 28) / zoom;
  addHandleLine(parent, rotating ? rotating.cx : cx, rotating ? rotating.cy : box.y, hx, hy);
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
  addHandle(
    parent,
    x,
    y,
    `anchor${selected ? " selected" : ""}`,
    { "data-element-id": elementId, "data-handle-role": role },
    hitR
  );
}

function renderPrimitiveHandles(
  parent: Element,
  el: SceneElement,
  pathEdit: PathEdit | null
): void {
  switch (el.type) {
    case "rect": {
      addResizeHandle(parent, el.x, el.y, el.id, "tl");
      addResizeHandle(parent, el.x + el.width, el.y, el.id, "tr");
      addResizeHandle(parent, el.x, el.y + el.height, el.id, "bl");
      addResizeHandle(parent, el.x + el.width, el.y + el.height, el.id, "br");
      const off = cornerHandleInset() / zoom;
      addResizeHandle(
        parent,
        el.x + el.width - off - cornerRadius(el),
        el.y + off + cornerRadiusY(el),
        el.id,
        "corner"
      );
      break;
    }
    case "circle":
      addResizeHandle(parent, el.cx + el.r, el.cy, el.id, "radius");
      break;
    case "ellipse":
      addResizeHandle(parent, el.cx + el.rx, el.cy, el.id, "rx");
      addResizeHandle(parent, el.cx, el.cy + el.ry, el.id, "ry");
      break;
    case "line":
      addResizeHandle(parent, el.x1, el.y1, el.id, "p1");
      addResizeHandle(parent, el.x2, el.y2, el.id, "p2");
      break;
    case "polyline":
    case "polygon":
      el.points.forEach((p, i) =>
        addResizeHandle(
          parent,
          p.x,
          p.y,
          el.id,
          `pt-${i}`,
          pathEdit?.pathId === el.id && pathEdit.index === i,
          hitRForPoint(el.points, i)
        )
      );
      break;
  }
}

function renderPathHandles(parent: Element, path: PathElement, state: EditorState): void {
  const pe = state.selection.pathEdit;
  // Curve handles first, anchors after: the anchor sits on top wherever the two overlap.
  path.points.forEach((p, i) => {
    for (const kind of ["in", "out"] as const) {
      const h = kind === "in" ? p.hIn : p.hOut;
      if (!h || (h.x === p.x && h.y === p.y)) continue;
      addHandleLine(parent, p.x, p.y, h.x, h.y);
      const reach = Math.hypot(h.x - p.x, h.y - p.y) * zoom;
      addHandle(
        parent,
        h.x,
        h.y,
        `handle-${kind}`,
        { "data-path-id": path.id, "data-point-index": i, "data-handle-kind": kind },
        Math.max(HANDLE_R + 1, Math.min(defaultHitR(), reach / 2))
      );
    }
  });
  path.points.forEach((p, i) => {
    const selected = pe?.pathId === path.id && pe.kind === "anchor" && pe.index === i;
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

function renderSelectionBox(box: BBox): void {
  add(els.overlay, "rect", {
    class: "selection-box",
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  });
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
  for (const el of sel) {
    if (el.id === activePathId) continue;
    if (el.type === "path") {
      renderPathHandles(els.overlay, el, state);
      const box = elementBBox(el);
      if (box) renderSelectionBox(box);
      continue;
    }
    const box = elementBBox(el);
    if (box) renderSelectionBox(box);
    if (sel.length === 1) {
      renderPrimitiveHandles(els.overlay, el, state.selection.pathEdit);
    }
  }
  if (sel.length === 1 && sel[0]!.id !== activePathId && canRotate(sel[0]!)) {
    renderRotateHandle(els.overlay, sel[0]!, state);
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

  const hovered =
    state.hoverId && !state.selection.elementIds.includes(state.hoverId)
      ? findElement(state.hoverId)
      : null;
  if (hovered && !state.drawing?.rotateHandle) {
    const outline = outlineNode(hovered, {
      stroke: "#5b8def",
      "stroke-width": 2,
      "stroke-opacity": 0.85,
      class: "hover-outline",
      "pointer-events": "none",
      "vector-effect": "non-scaling-stroke",
    });
    if (outline) els.overlay.appendChild(outline);
  }

  const cur = state.cursor;
  if (cur.snapActive && !state.drawing?.rotateHandle) {
    const r = 6 / state.viewport.zoom;
    const g = add(els.overlay, "g", { class: "snap-indicator", "pointer-events": "none" });
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

  const align = state.align;
  if (align.x != null) {
    add(els.overlay, "line", { class: "align-guide", x1: align.x, y1: -1e5, x2: align.x, y2: 1e5 });
  }
  if (align.y != null) {
    add(els.overlay, "line", { class: "align-guide", x1: -1e5, y1: align.y, x2: 1e5, y2: align.y });
  }
}

export function renderAll(state: EditorState): void {
  els.artboardBg.setAttribute("width", String(state.artboard.width));
  els.artboardBg.setAttribute("height", String(state.artboard.height));
  applyCameraTransform();
  renderImages(state);
  renderGrid(state);
  renderDocument(state);
  renderOverlay(state);
}
