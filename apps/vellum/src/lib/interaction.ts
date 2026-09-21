import { getState, setState, mutate, findElement, selectOnly } from "./state.js";
import {
  createPath,
  createPoint,
  elementBBox,
  translateElement,
  collectAlignPoints,
  alignToPoints,
  mirrorHandle,
  simplifyPathIfStraight,
  toPathElement,
  togglePointSmooth,
  nearestOnElement,
  insertPointAt,
  canRotate,
  rotationBase,
  rotateElementCopy,
  createText,
  type AlignOptions,
} from "./model.js";
import { screenToWorld, zoomAt } from "./viewport.js";
import { deepClone, dist } from "./utils.js";
import { pushUndo } from "./undo.js";
import {
  type Anchor,
  type EditorState,
  type Marquee,
  type Point,
  type SceneElement,
} from "./types.js";
import { setDrawing, clearDrawing, commit, pointIndexForRole } from "./ops.js";
import { finishPath } from "./pen-commands.js";
import { expandGroups, mergeDroppedEnd } from "./selection-commands.js";
import { applyResize } from "./resize.js";
import {
  type ShapeTool,
  updatePenPreview,
  updateShapePreview,
  finalizeShape,
} from "./shape-tools.js";

const CLOSE_TOL = 12;
const ALIGN_TOL_PX = 6;
type DragState =
  | { type: "pan"; startX: number; startY: number; panX: number; panY: number }
  | ({ type: "marquee" } & Marquee)
  | { type: "move-elements"; start: Point; ids: string[]; bases: Record<string, SceneElement> }
  | {
      type: "handle";
      pathId: string;
      index: number;
      kind: string;
      otherStart: Point | null;
      last: Point | null;
    }
  | { type: "pen-handle"; pathId: string; index: number }
  | {
      type: "resize";
      elementId: string;
      role: string;
      base: SceneElement;
      /** Handle centre minus pointer at the press: see `grabOffset`. */
      grab: Point;
    }
  | {
      type: "rotate";
      elementId: string;
      base: SceneElement;
      cx: number;
      cy: number;
      startAngle: number;
      radius: number;
      active: boolean;
    }
  | { type: "shape-drag"; tool: ShapeTool; start: Point; current: Point };

function hitElement(target: EventTarget | null): string | null {
  let node = target as Node | null;
  while (node && node !== document) {
    const id = (node as Element).getAttribute?.("data-element-id");
    if (id) return id;
    node = node.parentNode;
  }
  return null;
}

function hitHandle(target: Element): { pathId: string; index: number; kind: string } | null {
  const kind = target.getAttribute("data-handle-kind");
  const pathId = target.getAttribute("data-path-id");
  if (!kind || !pathId) return null;
  return { pathId, index: parseInt(target.getAttribute("data-point-index") ?? "0", 10), kind };
}

function elementsInMarquee(m: Marquee): string[] {
  const x1 = Math.min(m.x1, m.x2);
  const y1 = Math.min(m.y1, m.y2);
  const x2 = Math.max(m.x1, m.x2);
  const y2 = Math.max(m.y1, m.y2);
  const ids: string[] = [];
  for (const el of getState().elements) {
    const box = elementBBox(el);
    if (!box) continue;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) ids.push(el.id);
  }
  return ids;
}

/** How long a finger must rest on empty canvas before the drag becomes a marquee. */
const HOLD_MS = 450;

/** How far a pointer must travel before a press counts as a drag, in screen pixels. */
function dragSlop(e: PointerEvent): number {
  if (e.pointerType === "touch") return 10;
  return e.pointerType === "pen" ? 6 : 4;
}

/** A press that becomes a drag if the pointer moves far enough, and stays a click if not. */
interface PendingDrag {
  drag: DragState;
  x: number;
  y: number;
  slop: number;
  undo: boolean;
  grab: boolean;
}

export function bindInteraction(svg: SVGSVGElement, wrap: HTMLElement): void {
  let drag: DragState | null = null;
  let pending: PendingDrag | null = null;
  let holdTimer = 0;
  let lastDown = { t: 0, x: 0, y: 0 };

  function cancelHold(): void {
    if (holdTimer) window.clearTimeout(holdTimer);
    holdTimer = 0;
  }

  /**
   * Arms a drag instead of starting one. Tapping a shape to select it, or a point to pick it,
   * must not move anything and must not spend an undo step; both happen only once the pointer
   * really travels, which matters most on a touch screen where every tap wobbles a few pixels.
   */
  function arm(e: PointerEvent, next: DragState, { undo = true, grab = true } = {}): void {
    pending = { drag: next, x: e.clientX, y: e.clientY, slop: dragSlop(e), undo, grab };
  }

  /** True once the armed drag has started, or when there was none waiting. */
  function releaseArmed(e: PointerEvent): boolean {
    if (!pending) return true;
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < pending.slop) return false;
    cancelHold();
    if (pending.undo) pushUndo();
    drag = pending.drag;
    if (pending.grab) wrap.classList.add("grabbing");
    pending = null;
    return true;
  }

  function alignExcludes(): AlignOptions {
    if (!drag) return {};
    if (drag.type === "move-elements") return { excludeElementIds: new Set(drag.ids) };
    if (drag.type === "resize") return { excludeElementIds: new Set([drag.elementId]) };
    if (drag.type === "handle" || drag.type === "pen-handle") {
      return { excludePoint: { elementId: drag.pathId, index: drag.index } };
    }
    return {};
  }

  /**
   * Where the handle is relative to where you pressed.
   *
   * A handle's target is far wider than the dot - 22px across on a mouse, 44 on a finger - and a
   * resize used to read the bare pointer position, so pressing anywhere but the exact centre
   * jumped the shape by the difference. On the corner-radius handle it did not jump, it stalled:
   * the radius clamps at zero, so a press on the outer half of the target had to be dragged all
   * the way back before anything moved at all.
   */
  function grabOffset(handle: Element, world: Point): Point {
    const cx = Number(handle.getAttribute("cx"));
    const cy = Number(handle.getAttribute("cy"));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { x: 0, y: 0 };
    return { x: cx - world.x, y: cy - world.y };
  }

  /** Symmetric by default (partner mirrors); with Alt the partner keeps its position. */
  function applyHandleDrag(p: Anchor, world: Point, alt: boolean): void {
    if (drag?.type !== "handle") return;
    const key = drag.kind === "out" ? "hOut" : "hIn";
    const otherKey = drag.kind === "out" ? "hIn" : "hOut";
    p[key] = { x: world.x, y: world.y };
    if (!drag.otherStart) return;
    if (alt) {
      p.smooth = false;
      p[otherKey] = { ...drag.otherStart };
    } else {
      p.smooth = true;
      p[otherKey] = mirrorHandle(p, p[key]!);
    }
  }

  function onAltKey(e: KeyboardEvent): void {
    if (e.key !== "Alt" || drag?.type !== "handle" || drag.kind === "anchor" || !drag.last) return;
    e.preventDefault();
    const path = findElement(drag.pathId);
    const last = drag.last;
    const index = drag.index;
    if (path?.type !== "path") return;
    const p = path.points[index];
    if (!p) return;
    mutate(() => applyHandleDrag(p, last, e.type === "keydown"));
  }
  window.addEventListener("keydown", onAltKey);
  window.addEventListener("keyup", onAltKey);

  // A second finger means pinch/pan: drop whatever one-finger drag had started.
  svg.addEventListener("pinch-start", () => {
    pending = null;
    cancelHold();
    if (drag && drag.type !== "pan") {
      drag = null;
      wrap.classList.remove("grabbing");
      clearDrawing();
    }
  });

  function pointerWorld(e: PointerEvent): Point {
    const w = screenToWorld(e.clientX, e.clientY);
    const s = getState();
    // While dragging a curve handle, Alt breaks its symmetry instead of aligning.
    const alignOn =
      e.altKey &&
      !(drag?.type === "handle" && drag.kind !== "anchor") &&
      !(drag?.type === "resize" && drag.role === "corner");
    let x = w.x;
    let y = w.y;
    let guideX: number | null = null;
    let guideY: number | null = null;
    if (alignOn) {
      const tol = ALIGN_TOL_PX / s.viewport.zoom;
      const aligned = alignToPoints(w, collectAlignPoints(s.elements, alignExcludes()), tol);
      ({ x, y, guideX, guideY } = aligned);
    }
    const snapOn =
      !alignOn &&
      s.grid.snap &&
      (s.tool !== "select" || drag?.type === "handle" || drag?.type === "resize");
    if (snapOn) {
      const step = Math.max(1, s.grid.step);
      x = Math.round(x / step) * step;
      y = Math.round(y / step) * step;
    }
    setState({
      cursor: { x: w.x, y: w.y, snapX: x, snapY: y, snapActive: alignOn || snapOn },
      align: { x: guideX, y: guideY },
    });
    return { x, y };
  }

  svg.addEventListener("pointerleave", () => {
    wrap.classList.remove("hover-target");
    setState((s) => ({
      ...s,
      hoverId: null,
      cursor: { ...s.cursor, snapActive: false },
      align: { x: null, y: null },
    }));
  });

  function startPan(e: PointerEvent): void {
    const { panX, panY } = getState().viewport;
    drag = { type: "pan", startX: e.clientX, startY: e.clientY, panX, panY };
    wrap.classList.add("panning");
  }

  svg.addEventListener("pointerdown", (e) => {
    if (e.button === 1) {
      startPan(e);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    svg.setPointerCapture(e.pointerId);
    const st = getState();
    const world = pointerWorld(e);

    // Manual double-click detection: the overlay is re-rendered on every state change, so the
    // browser's own click/dblclick events are unreliable for anything drawn there.
    const nowMs = performance.now();
    const isDouble =
      nowMs - lastDown.t < 400 &&
      Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) <
        (e.pointerType === "touch" ? 24 : 6);
    lastDown = { t: isDouble ? 0 : nowMs, x: e.clientX, y: e.clientY };

    if (st.spacePan) {
      startPan(e);
      return;
    }

    const target = e.target as Element;
    const handle = target.closest?.("[data-handle-kind]");
    if (handle) {
      const h = hitHandle(handle);
      const path = h ? findElement(h.pathId) : undefined;
      // The pen keeps its own meaning for the path it is drawing: clicking the first anchor
      // closes it, clicking elsewhere adds a point. Any other path's handles are editable.
      const penOwns = st.tool === "pen" && h?.pathId === st.drawing?.activePathId;
      if (h && path?.type === "path" && !penOwns) {
        if (isDouble && h.kind === "anchor") {
          commit(() => mutate(() => togglePointSmooth(path, h.index)));
          drag = null;
          return;
        }
        const p = path.points[h.index];
        const other = h.kind === "out" ? p?.hIn : h.kind === "in" ? p?.hOut : null;
        arm(e, {
          type: "handle",
          ...h,
          otherStart: other ? { x: other.x, y: other.y } : null,
          last: null,
        });
        setState({
          selection: selectOnly(
            [h.pathId],
            h.kind === "anchor" ? { pathId: h.pathId, kind: "anchor", index: h.index } : null
          ),
        });
        return;
      }
    }

    const resizeHandle = target.closest?.("[data-handle-role]");
    const resizeTarget = resizeHandle
      ? findElement(resizeHandle.getAttribute("data-element-id"))
      : undefined;
    if (resizeHandle && resizeTarget) {
      const elementId = resizeTarget.id;
      const role = resizeHandle.getAttribute("data-handle-role") ?? "";
      if (role === "rotate") {
        startRotate(e, resizeTarget, world);
        return;
      }
      const ptIndex = pointIndexForRole(role);
      if (isDouble && ptIndex != null) {
        commit(() => {
          setState((s) => {
            const cur = findElement(elementId);
            if (!cur) return s;
            const path = toPathElement(cur);
            togglePointSmooth(path, ptIndex);
            return {
              ...s,
              elements: s.elements.map((x) => (x.id === elementId ? path : x)),
              selection: selectOnly([elementId]),
            };
          });
        });
        drag = null;
        return;
      }
      arm(e, {
        type: "resize",
        elementId,
        role,
        base: deepClone(resizeTarget),
        grab: grabOffset(resizeHandle, world),
      });
      setState({
        selection: selectOnly(
          [elementId],
          role.startsWith("pt-") && ptIndex != null
            ? { pathId: elementId, kind: "anchor", index: ptIndex }
            : null
        ),
      });
      return;
    }

    if (st.tool === "select") {
      const elId = hitElement(e.target);
      const el = findElement(elId);
      if (elId && el) {
        if (isDouble && handleDoubleClickOnShape(el, world, st)) {
          drag = null;
          return;
        }
        const members = expandGroups([elId]);
        setState((s) => {
          let ids = s.selection.elementIds;
          if (e.shiftKey) {
            ids = members.every((m) => ids.includes(m))
              ? ids.filter((x) => !members.includes(x))
              : [...new Set([...ids, ...members])];
          } else if (!ids.includes(elId)) {
            ids = members;
          }
          return { ...s, selection: selectOnly(ids) };
        });
        const ids = getState().selection.elementIds;
        const bases: Record<string, SceneElement> = {};
        for (const id of ids) {
          const found = findElement(id);
          if (found) bases[id] = deepClone(found);
        }
        arm(e, { type: "move-elements", start: world, ids, bases });
        return;
      }
      const marquee: DragState = {
        type: "marquee",
        x1: world.x,
        y1: world.y,
        x2: world.x,
        y2: world.y,
      };
      if (e.pointerType === "touch") {
        // One finger on empty canvas pans, which is what a hand tool was for. Holding still
        // for a moment switches to a marquee, so box-selection is reachable without one.
        const { panX, panY } = getState().viewport;
        arm(
          e,
          { type: "pan", startX: e.clientX, startY: e.clientY, panX, panY },
          { undo: false, grab: false }
        );
        holdTimer = window.setTimeout(() => {
          if (pending?.drag.type !== "pan") return;
          pending = { ...pending, drag: marquee };
          setDrawing({ marquee: { x1: world.x, y1: world.y, x2: world.x, y2: world.y } });
        }, HOLD_MS);
      } else {
        arm(e, marquee, { undo: false, grab: false });
      }
      if (!e.shiftKey) setState({ selection: selectOnly() });
      return;
    }

    if (st.tool === "pen") {
      handlePenDown(world);
      return;
    }

    if (st.tool === "text") {
      // Empty, not "Text": the in-place field opens straight away, and tapping away without
      // typing anything leaves nothing behind rather than the word "Text".
      const el = createText(world.x, world.y, "");
      commit(() => {
        setState((s) => ({
          ...s,
          elements: [...s.elements, el],
          selection: selectOnly([el.id]),
          ui: { ...s.ui, expandedElementId: el.id },
          tool: "select",
          drawing: null,
        }));
      });
      document.dispatchEvent(new CustomEvent("focus-text", { detail: { id: el.id } }));
      return;
    }

    if (st.tool === "rect" || st.tool === "ellipse") {
      handleShapeDown(st.tool, world, e);
    }
  });

  /** Double-click on a shape: edit text, or insert a vertex on the segment under the cursor. */
  function handleDoubleClickOnShape(el: SceneElement, world: Point, st: EditorState): boolean {
    if (el.type === "text") {
      document.dispatchEvent(new CustomEvent("focus-text", { detail: { id: el.id } }));
      return true;
    }
    if (!["path", "line", "polyline", "polygon"].includes(el.type)) return false;
    const hit = nearestOnElement(el, world);
    if (!hit || hit.dist > Math.max(8 / st.viewport.zoom, el.strokeWidth)) return false;
    commit(() => {
      setState((s) => {
        const cur = findElement(el.id);
        if (!cur) return s;
        const next = insertPointAt(cur, hit.index, hit.t);
        return {
          ...s,
          elements: s.elements.map((x) => (x.id === el.id ? next : x)),
          selection: selectOnly([el.id]),
        };
      });
    });
    return true;
  }

  function startRotate(e: PointerEvent, el: SceneElement, world: Point): void {
    const box = elementBBox(el);
    if (!box || !canRotate(el)) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    arm(e, {
      type: "rotate",
      elementId: el.id,
      base: rotationBase(deepClone(el)),
      cx,
      cy,
      startAngle: Math.atan2(world.y - cy, world.x - cx),
      radius: Math.max(20, Math.hypot(world.x - cx, world.y - cy)),
      active: false,
    });
  }

  function handlePenDown(world: Point): void {
    const st = getState();
    let pathId = st.drawing?.activePathId ?? null;
    let path = pathId ? findElement(pathId) : undefined;

    if (!path || path.type !== "path") {
      const newPath = createPath();
      commit(() => {
        setState((s) => ({
          ...s,
          elements: [...s.elements, newPath],
          drawing: { activePathId: newPath.id, preview: null },
        }));
      });
      pathId = newPath.id;
      path = findElement(pathId);
    }
    if (!pathId || path?.type !== "path") return;
    const activeId = pathId;

    if (path.points.length >= 3 && dist(world, path.points[0]!) <= CLOSE_TOL / st.viewport.zoom) {
      commit(() => {
        setState((s) => {
          const p = findElement(activeId);
          if (p?.type === "path") p.closed = true;
          return {
            ...s,
            elements: s.elements.map((e) => (e.id === activeId ? simplifyPathIfStraight(e) : e)),
            drawing: { activePathId: null, preview: null },
          };
        });
      });
      return;
    }

    commit(() => {
      mutate(() => {
        const p = findElement(activeId);
        if (p?.type === "path") p.points.push(createPoint(world.x, world.y, false));
      });
    });
    const updated = findElement(activeId);
    if (updated?.type === "path") {
      drag = { type: "pen-handle", pathId: activeId, index: updated.points.length - 1 };
    }
  }

  function handleShapeDown(tool: ShapeTool, world: Point, e: PointerEvent): void {
    const st = getState();
    if (st.drawing?.shapeStart) {
      finalizeShape(tool, st.drawing.shapeStart, world, e.shiftKey);
      clearDrawing();
      drag = null;
      return;
    }
    drag = { type: "shape-drag", tool, start: world, current: world };
    updateShapePreview(tool, world, world, e.shiftKey);
  }

  svg.addEventListener("pointermove", (e) => {
    if (!releaseArmed(e)) return;
    const world = pointerWorld(e);
    const st = getState();

    if (drag?.type === "pan") {
      const d = drag;
      setState((s) => ({
        ...s,
        viewport: {
          ...s.viewport,
          panX: d.panX + (e.clientX - d.startX),
          panY: d.panY + (e.clientY - d.startY),
        },
      }));
      return;
    }

    if (!drag) {
      const target = e.target as Element;
      const overHandle = !!target.closest?.("[data-handle-kind], [data-handle-role]");
      const hoverId = overHandle || st.tool !== "select" ? null : hitElement(e.target);
      wrap.classList.toggle("hover-target", overHandle || !!hoverId);
      if (getState().hoverId !== hoverId) setState({ hoverId });
    } else if (getState().hoverId) {
      setState({ hoverId: null });
    }

    if (drag?.type === "marquee") {
      drag.x2 = world.x;
      drag.y2 = world.y;
      setDrawing({ marquee: { x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2 } });
      return;
    }

    if (drag?.type === "move-elements") {
      const d = drag;
      let dx = world.x - d.start.x;
      let dy = world.y - d.start.y;
      if (st.grid.snap && !e.altKey) {
        // Snap the top-left of the first dragged shape to the grid.
        const firstBase = d.bases[d.ids[0] ?? ""];
        const first = firstBase ? elementBBox(firstBase) : null;
        if (first) {
          const step = Math.max(1, st.grid.step);
          dx = Math.round((first.x + dx) / step) * step - first.x;
          dy = Math.round((first.y + dy) / step) * step - first.y;
        }
      }
      mutate(() => {
        for (const id of d.ids) {
          const el = findElement(id);
          const base = d.bases[id];
          if (!el || !base) continue;
          const copy = deepClone(base);
          translateElement(copy, dx, dy);
          if (el.type === "path" && copy.type === "path") {
            el.points = copy.points;
            el.closed = copy.closed;
          } else {
            Object.assign(el, copy);
          }
        }
      });
      return;
    }

    if (drag?.type === "handle") {
      const d = drag;
      const path = findElement(d.pathId);
      if (path?.type !== "path") return;
      const p = path.points[d.index];
      if (!p) return;
      if (d.kind === "anchor") {
        const dx = world.x - p.x;
        const dy = world.y - p.y;
        mutate(() => {
          p.x = world.x;
          p.y = world.y;
          for (const h of [p.hIn, p.hOut]) {
            if (!h) continue;
            h.x += dx;
            h.y += dy;
          }
        });
      } else {
        d.last = world;
        mutate(() => applyHandleDrag(p, world, e.altKey));
      }
      setState({
        selection: selectOnly(
          [d.pathId],
          d.kind === "anchor" ? { pathId: d.pathId, kind: "anchor", index: d.index } : null
        ),
      });
      return;
    }

    if (drag?.type === "rotate") {
      const d = drag;
      let delta = Math.atan2(world.y - d.cy, world.x - d.cx) - d.startAngle;
      if (e.shiftKey) {
        const step = Math.PI / 12;
        delta = Math.round(delta / step) * step;
      }
      if (!d.active && Math.abs(delta) < 0.01) return;
      d.active = true;
      const rotated = rotateElementCopy(d.base, delta, d.cx, d.cy);
      const a = d.startAngle + delta;
      setState((s) => ({
        ...s,
        elements: s.elements.map((x) => (x.id === d.elementId ? rotated : x)),
        drawing: {
          rotateHandle: {
            elementId: d.elementId,
            cx: d.cx,
            cy: d.cy,
            x: d.cx + Math.cos(a) * d.radius,
            y: d.cy + Math.sin(a) * d.radius,
          },
        },
      }));
      return;
    }

    if (drag?.type === "resize") {
      const d = drag;
      const el = findElement(d.elementId);
      const at = { x: world.x + d.grab.x, y: world.y + d.grab.y };
      if (el) mutate(() => applyResize(el, d.role, at, d.base, e.altKey));
      return;
    }

    if (drag?.type === "pen-handle") {
      const d = drag;
      const path = findElement(d.pathId);
      if (path?.type !== "path") return;
      const p = path.points[d.index];
      if (p) {
        mutate(() => {
          p.smooth = true;
          p.hOut = { x: world.x, y: world.y };
          p.hIn = mirrorHandle(p, p.hOut);
        });
        updatePenPreview(path, world);
      }
      return;
    }

    if (drag?.type === "shape-drag") {
      drag.current = world;
      updateShapePreview(drag.tool, drag.start, world, e.shiftKey);
      return;
    }

    if (st.drawing?.activePathId) {
      const path = findElement(st.drawing.activePathId);
      if (path?.type === "path" && path.points.length) updatePenPreview(path, world);
    } else if (!drag && st.drawing?.shapeStart) {
      if (st.tool === "rect" || st.tool === "ellipse") {
        updateShapePreview(st.tool, st.drawing.shapeStart, world, e.shiftKey);
      }
    }
  });

  svg.addEventListener("pointerup", (e) => {
    wrap.classList.remove("panning", "grabbing");
    // A press that never passed the slop threshold was a click: the selection it made stands,
    // but nothing moved and no undo step was spent.
    const heldMarquee = pending?.drag.type === "marquee";
    pending = null;
    cancelHold();
    if (heldMarquee) clearDrawing();
    if (drag?.type === "pan") {
      drag = null;
      return;
    }
    const world = pointerWorld(e);
    const st = getState();
    setState({ align: { x: null, y: null } });

    if (drag?.type === "marquee") {
      const ids = expandGroups(elementsInMarquee(drag));
      setState((s) => ({
        ...s,
        selection: selectOnly(e.shiftKey ? [...new Set([...s.selection.elementIds, ...ids])] : ids),
      }));
      clearDrawing();
      drag = null;
      return;
    }

    if (drag?.type === "handle" || drag?.type === "resize") {
      const d = drag;
      const idx =
        d.type === "handle" ? (d.kind === "anchor" ? d.index : null) : pointIndexForRole(d.role);
      const id = d.type === "handle" ? d.pathId : d.elementId;
      drag = null;
      const el = idx != null ? findElement(id) : undefined;
      if (el && idx != null) mergeDroppedEnd(el, idx, 8 / st.viewport.zoom);
      return;
    }

    if (drag?.type === "rotate") {
      drag = null;
      clearDrawing();
      return;
    }

    if (drag?.type === "shape-drag") {
      if (dist(drag.start, world) >= 3 / st.viewport.zoom) {
        finalizeShape(drag.tool, drag.start, world, e.shiftKey);
        clearDrawing();
      }
      // else: a plain click — leave drawing.shapeStart in place, waiting for a second click.
      drag = null;
      return;
    }

    drag = null;
  });

  svg.addEventListener("dblclick", (e) => {
    const st = getState();
    if (st.tool !== "pen") return;
    e.preventDefault();
    const path = st.drawing?.activePathId ? findElement(st.drawing.activePathId) : undefined;
    if (path?.type === "path" && path.points.length) path.points.pop();
    pushUndo();
    finishPath();
  });

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 400;
      setState({ viewport: zoomAt(e.clientX, e.clientY, Math.exp(-delta * 0.002)) });
    },
    { passive: false }
  );
}

export function cancelOperation(): void {
  const st = getState();
  if (st.drawing?.activePathId && !st.drawing.shapeStart) finishPath();
  clearDrawing();
}
