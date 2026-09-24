/**
 * The bar that follows the selection.
 *
 * Almost everything you do to a shape once it exists - delete it, duplicate it, move it in
 * z-order, close a path, group it - was reachable only from a keyboard shortcut or from a row
 * inside the Document panel, which on a phone covers the artboard. This puts those actions next
 * to the shape itself, on every pointer: a mouse has the shortcuts, but having to know them is
 * not the same as having them to hand.
 *
 * While the pen still has a path open it shows what that state needs instead - finish, close,
 * take back the last point, throw it away - because finishing a path on touch is otherwise an
 * undiscoverable double-tap, and every other tool shows its actions the moment the shape exists.
 *
 * On a touch screen it also stays up with nothing selected, docked above the tool bar, for the
 * two things a keyboard would otherwise do there: select everything, and paste.
 */

import { findElement, selectedElements } from "./state.js";
import {
  canJoin,
  canRotate,
  canSplitAt,
  canToggleClosed,
  hasHandle,
  hasTwoHandles,
  isClosedShape,
  localBBox,
  toWorldPoint,
} from "./model.js";
import { canMergeGroups, canMoveSelectionZ, groupsOf, outerGroup } from "./groups.js";
import { worldToScreen } from "./viewport.js";
import { isCoarsePointer } from "./pointer.js";
import { isSelectMore } from "./modes.js";
import { HANDLE_EXTENT, outerHandlePoints } from "./render.js";
import type { EditorState, Point, SceneElement } from "./types.js";

export interface ActionBarHandlers {
  duplicate: () => void;
  remove: () => void;
  forward: () => void;
  back: () => void;
  toggleClosed: (id: string, closed: boolean) => void;
  group: () => void;
  merge: () => void;
  ungroup: () => void;
  splitPoint: () => void;
  linkHandles: (linked: boolean) => void;
  togglePointCurve: () => void;
  removeHandle: () => void;
  join: () => void;
  editText: (id: string) => void;
  finishPath: () => void;
  closeAndFinishPath: () => void;
  undoPoint: () => void;
  discardPath: () => void;
  selectMore: (on: boolean) => void;
  selectAll: () => void;
  copy: () => void;
  paste: () => void;
}

interface Action {
  key: string;
  label: string;
  icon?: string;
  glyph?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A switch rather than an action: shown pressed while on. */
  pressed?: boolean;
  run: () => void;
}

const GAP = 12;

let bar: HTMLElement;
let handlers: ActionBarHandlers;
let lastSignature = "";

export function initActionBar(element: HTMLElement, fns: ActionBarHandlers): void {
  bar = element;
  handlers = fns;
  // A press on the bar is a press on the bar, not on the canvas underneath it.
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
}

/** A path is worth closing only once the closing edge would actually show. */
function worthClosing(el: SceneElement): boolean {
  if (!canToggleClosed(el)) return false;
  return isClosedShape(el) || el.points.length > 2;
}

/** What the bar offers while the pen still has a path open. */
function drawingActions(state: EditorState): Action[] {
  const path = findElement(state.drawing?.activePathId);
  const points = path && "points" in path ? path.points.length : 0;
  return [
    {
      key: "undo-point",
      label: "Remove the last point",
      icon: "icon-undo",
      disabled: points < 1,
      run: handlers.undoPoint,
    },
    {
      key: "close",
      label: "Close the path and finish",
      icon: "icon-close-path",
      disabled: points < 3,
      run: handlers.closeAndFinishPath,
    },
    {
      key: "finish",
      label: "Finish the path",
      icon: "icon-check",
      disabled: points < 2,
      run: handlers.finishPath,
    },
    {
      key: "discard",
      label: "Throw this path away",
      icon: "icon-trash",
      danger: true,
      run: handlers.discardPath,
    },
  ];
}

/** Select all and paste: shown on touch with nothing selected, where there is no keyboard. */
function idleActions(state: EditorState): Action[] {
  return [
    {
      key: "select-all",
      label: "Select everything",
      icon: "icon-select-all",
      disabled: !state.elements.some((e) => !e.hidden),
      run: handlers.selectAll,
    },
    { key: "paste", label: "Paste", icon: "icon-paste", run: handlers.paste },
  ];
}

/** Whether the idle bar is up: touch, the select tool, nothing selected and nothing drawn. */
function idle(state: EditorState): boolean {
  return (
    isCoarsePointer() &&
    state.tool === "select" &&
    !state.selection.elementIds.length &&
    !state.drawing?.activePathId
  );
}

/** Closing or opening the path, when there is a path and closing it would show. */
function closeAction(el: SceneElement): Action | null {
  if (!worthClosing(el)) return null;
  const closed = isClosedShape(el);
  return {
    // The key carries the state: the bar is rebuilt when the signature changes, and a key that
    // read the same either way left the button showing the action it had just performed.
    key: closed ? "open" : "close",
    label: closed ? "Open the path" : "Close the path",
    icon: closed ? "icon-open-path" : "icon-close-path",
    run: () => handlers.toggleClosed(el.id, !closed),
  };
}

/**
 * What the bar offers when one point of a path is selected.
 *
 * Everything else the bar can do - duplicate, z-order, group - acts on the whole shape, which
 * reads as a lie next to a highlighted point, and delete is the one button whose meaning really
 * does change with the selection. So the bar narrows to the point, and says so.
 */
function pointActions(el: SceneElement, index: number, handle?: "in" | "out"): Action[] {
  const out: Action[] = [];
  const p = el.type === "path" ? el.points[index] : undefined;
  const curved = !!p && (hasHandle(p, "in") || hasHandle(p, "out"));
  // Double-clicking the point does the same; the button is there so nobody has to know that.
  if (canToggleClosed(el)) {
    out.push(
      curved
        ? {
            key: "corner",
            label: "Make it a corner: remove its handles",
            icon: "icon-corner",
            run: handlers.togglePointCurve,
          }
        : {
            key: "curve",
            label: "Make it a curve: give it handles",
            icon: "icon-curve",
            run: handlers.togglePointCurve,
          }
    );
  }
  // The handle grabbed last can go on its own, leaving the curve on the other side.
  if (p && handle && hasHandle(p, handle)) {
    out.push({
      key: `remove-${handle}`,
      label: "Remove this handle: straight on its side",
      icon: "icon-remove-handle",
      run: handlers.removeHandle,
    });
  }
  // Only a point with two handles has a pair to link or break. The key carries the state, as
  // the close button's does, so the button is rebuilt when it flips.
  if (p && hasTwoHandles(p)) {
    out.push(
      p.smooth
        ? {
            key: "unlink",
            label: "Break the handles: each moves on its own",
            icon: "icon-unlink",
            run: () => handlers.linkHandles(false),
          }
        : {
            key: "link",
            label: "Link the handles: they mirror each other",
            icon: "icon-link",
            run: () => handlers.linkHandles(true),
          }
    );
  }
  // The two ends of an open path have nothing to split.
  if (canSplitAt(el, index)) {
    out.push({
      key: "split",
      label: "Split the path at this point",
      icon: "icon-split",
      run: handlers.splitPoint,
    });
  }
  const close = closeAction(el);
  if (close) out.push(close);
  out.push({
    key: "delete-point",
    label: "Delete this point",
    icon: "icon-trash",
    danger: true,
    run: handlers.remove,
  });
  return out;
}

function selectionActions(state: EditorState): Action[] {
  const sel = selectedElements();
  const out: Action[] = [];
  const single = sel.length === 1 ? sel[0]! : null;

  const pe = state.selection.pathEdit;
  const edited = pe ? findElement(pe.pathId) : null;
  if (pe && edited) return pointActions(edited, pe.index, pe.handle);

  if (single?.type === "text") {
    out.push({
      key: "edit",
      label: "Edit text",
      icon: "icon-text",
      run: () => handlers.editText(single.id),
    });
  }
  const close = single ? closeAction(single) : null;
  if (close) out.push(close);
  if (sel.length === 2 && sel.every(canJoin)) {
    out.push({ key: "join", label: "Join the two paths", icon: "icon-join", run: handlers.join });
  }

  const groups = new Set(sel.map((e) => outerGroup(e) ?? ""));
  if (sel.length > 1 && !(groups.size === 1 && !groups.has(""))) {
    out.push({ key: "group", label: "Group", icon: "icon-group", run: handlers.group });
  }
  if (canMergeGroups(state.elements, new Set(state.selection.elementIds))) {
    out.push({
      key: "merge",
      label: "Merge into one group",
      icon: "icon-merge",
      run: handlers.merge,
    });
  }
  if (sel.some((e) => groupsOf(e).length)) {
    out.push({ key: "ungroup", label: "Ungroup", icon: "icon-ungroup", run: handlers.ungroup });
  }

  const ids = new Set(state.selection.elementIds);
  const more = isSelectMore();
  out.unshift({
    // Shift for a finger: while on, a tap adds a shape to the selection or takes it out.
    key: more ? "more-on" : "more-off",
    label: more ? "Stop adding to the selection" : "Add to the selection: tap more shapes",
    icon: "icon-select-more",
    pressed: more,
    run: () => handlers.selectMore(!more),
  });
  if (state.elements.some((e) => !e.hidden && !ids.has(e.id))) {
    out.splice(1, 0, {
      key: "select-all",
      label: "Select everything",
      icon: "icon-select-all",
      run: handlers.selectAll,
    });
  }
  out.push(
    {
      key: "back",
      label: "Send backward (Shift: to the back)",
      glyph: "▼",
      disabled: !canMoveSelectionZ(state.elements, ids, -1),
      run: handlers.back,
    },
    {
      key: "forward",
      label: "Bring forward (Shift: to the front)",
      glyph: "▲",
      disabled: !canMoveSelectionZ(state.elements, ids, 1),
      run: handlers.forward,
    },
    { key: "duplicate", label: "Duplicate", icon: "icon-copy", run: handlers.duplicate },
    { key: "delete", label: "Delete", icon: "icon-trash", danger: true, run: handlers.remove }
  );
  // Duplicate copies within the document; Copy is for taking shapes to another one, or to
  // another app. A keyboard has Ctrl+C for that, so the button is for touch, beside the idle
  // bar's Paste.
  if (isCoarsePointer()) {
    out.splice(out.length - 2, 0, {
      key: "copy",
      label: "Copy, to paste into another document",
      icon: "icon-clipboard",
      run: handlers.copy,
    });
  }
  return out;
}

function build(actions: readonly Action[]): void {
  bar.replaceChildren();
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool-btn";
    btn.title = action.label;
    btn.setAttribute("aria-label", action.label);
    if (action.icon) {
      btn.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="#${action.icon}" /></svg>`;
    } else {
      btn.textContent = action.glyph ?? "";
      btn.classList.add("tool-btn--text");
    }
    if (action.danger) btn.classList.add("action-danger");
    if (action.pressed !== undefined) {
      btn.setAttribute("aria-pressed", String(action.pressed));
      btn.classList.toggle("active", action.pressed);
    }
    btn.disabled = !!action.disabled;
    btn.addEventListener("click", action.run);
    bar.appendChild(btn);
  }
}

interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The screen rectangle around one selected point and its curve handles. The bar only acts on
 * that point, so it sits beside it: against the whole shape it could land a screen away from
 * what it acts on.
 */
function pointRect(state: EditorState): AnchorRect | null {
  const pe = state.selection.pathEdit;
  const el = pe ? findElement(pe.pathId) : undefined;
  const p = pe && el && "points" in el ? el.points[pe.index] : undefined;
  if (!el || !p) return null;
  const points: Point[] = [p];
  if (el.type === "path") {
    const { hIn, hOut } = el.points[pe!.index]!;
    if (hIn) points.push(hIn);
    if (hOut) points.push(hOut);
  }
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const local of points) {
    const world = toWorldPoint(el, local);
    const s = worldToScreen(world.x, world.y);
    left = Math.min(left, s.x - HANDLE_EXTENT);
    right = Math.max(right, s.x + HANDLE_EXTENT);
    top = Math.min(top, s.y - HANDLE_EXTENT);
    bottom = Math.max(bottom, s.y + HANDLE_EXTENT);
  }
  return { left, right, top, bottom };
}

/** The screen rectangle the bar sits beside: a selected point, the selection, or the path being drawn. */
function anchorRect(state: EditorState): AnchorRect | null {
  const drawing = findElement(state.drawing?.activePathId);
  if (!drawing && state.selection.pathEdit) {
    const around = pointRect(state);
    if (around) return around;
  }
  const shapes = drawing ? [drawing] : selectedElements();
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const { zoom } = state.viewport;
  for (const el of shapes) {
    // The local box turned into place - the same outline the selection draws - so the bar sits
    // against what you can see rather than against a larger upright box around it.
    const box = localBBox(el);
    if (!box) continue;
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    for (const corner of corners) {
      const world = toWorldPoint(el, corner);
      const p = worldToScreen(world.x, world.y);
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
    // Handles standing outside the outline count as part of the selection, on whichever side
    // the rotation put them, so the bar never lands on top of one.
    const rotatable = !drawing && shapes.length === 1 && canRotate(el);
    for (const world of outerHandlePoints(el, zoom, rotatable)) {
      const p = worldToScreen(world.x, world.y);
      left = Math.min(left, p.x - HANDLE_EXTENT);
      right = Math.max(right, p.x + HANDLE_EXTENT);
      top = Math.min(top, p.y - HANDLE_EXTENT);
      bottom = Math.max(bottom, p.y + HANDLE_EXTENT);
    }
  }
  if (!Number.isFinite(left)) return null;
  return { left, right, top, bottom };
}

/**
 * The strip of window the toolbars leave free. The bar has to stay inside it: pushed to the top
 * of the canvas it used to slide under the toolbar, where half of it was unreachable.
 */
function freeBand(): { top: number; bottom: number } {
  const visible = (el: HTMLElement | null) => (el?.getClientRects().length ? el : null);
  const topBar = visible(document.querySelector<HTMLElement>(".top-bar"));
  const toolBar = visible(document.getElementById("tool-bar"));
  const top = topBar ? topBar.getBoundingClientRect().bottom + GAP : 8;
  const bottom = toolBar ? toolBar.getBoundingClientRect().top - GAP : window.innerHeight - 8;
  return { top: Math.max(8, top), bottom: Math.min(window.innerHeight - 8, bottom) };
}

/** Puts the bar just above the selection, or below it when there is no room. */
function position(state: EditorState): void {
  // Measured from the left edge: where it last stood limits how wide a wrapping bar lays out.
  bar.style.left = "8px";
  const size = bar.getBoundingClientRect();
  if (idle(state)) {
    // Nothing to sit beside: it docks at the bottom of the free band, over the tool bar.
    const band = freeBand();
    bar.style.left = `${Math.max(8, (window.innerWidth - size.width) / 2)}px`;
    bar.style.top = `${band.bottom - size.height}px`;
    return;
  }
  const at = anchorRect(state);
  if (!at) return;
  const x = Math.min(
    Math.max((at.left + at.right) / 2 - size.width / 2, 8),
    window.innerWidth - size.width - 8
  );
  const band = freeBand();
  const above = at.top - size.height - GAP;
  const y = above >= band.top ? above : at.bottom + GAP;
  bar.style.left = `${Math.max(8, x)}px`;
  bar.style.top = `${Math.max(band.top, Math.min(y, band.bottom - size.height))}px`;
}

/** Called on every state change: shows, rebuilds and repositions the bar as needed. */
export function syncActionBar(state: EditorState): void {
  const drawing = !!state.drawing?.activePathId;
  const show =
    !state.finalOnly &&
    !state.ui.editingTextId &&
    (drawing || !!state.selection.elementIds.length || idle(state));
  bar.classList.toggle("hidden", !show);
  if (!show) {
    lastSignature = "";
    return;
  }
  const actions = drawing
    ? drawingActions(state)
    : idle(state)
      ? idleActions(state)
      : selectionActions(state);
  // Rebuilt only when the set of buttons, or whether they are enabled, actually changes.
  const signature = actions.map((a) => `${a.key}${a.disabled ? "-off" : ""}`).join(",");
  if (signature !== lastSignature) {
    build(actions);
    lastSignature = signature;
  }
  position(state);
}
