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
 * take back the last point - because finishing a path on touch is otherwise an undiscoverable
 * double-tap, and every other tool shows its actions the moment the shape exists.
 */

import { findElement, selectedElements } from "./state.js";
import {
  canJoin,
  canRotate,
  canToggleClosed,
  isClosedShape,
  localBBox,
  toWorldPoint,
} from "./model.js";
import { canMoveSelectionZ, groupsOf, outerGroup } from "./groups.js";
import { worldToScreen } from "./viewport.js";
import type { EditorState, SceneElement } from "./types.js";

export interface ActionBarHandlers {
  duplicate: () => void;
  remove: () => void;
  forward: () => void;
  back: () => void;
  toggleClosed: (id: string, closed: boolean) => void;
  group: () => void;
  ungroup: () => void;
  splitPoint: () => void;
  join: () => void;
  editText: (id: string) => void;
  finishPath: () => void;
  closeAndFinishPath: () => void;
  undoPoint: () => void;
}

interface Action {
  key: string;
  label: string;
  icon?: string;
  glyph?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

/** How far above the selection the rotate handle hangs, in screen pixels (see render.ts). */
const ROTATE_HANDLE_REACH = 56;
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
      glyph: "⌫",
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
  ];
}

function selectionActions(state: EditorState): Action[] {
  const sel = selectedElements();
  const out: Action[] = [];
  const single = sel.length === 1 ? sel[0]! : null;

  if (single?.type === "text") {
    out.push({
      key: "edit",
      label: "Edit text",
      icon: "icon-text",
      run: () => handlers.editText(single.id),
    });
  }
  if (single && worthClosing(single)) {
    const closed = isClosedShape(single);
    out.push({
      key: "closed",
      label: closed ? "Open the path" : "Close the path",
      icon: closed ? "icon-open-path" : "icon-close-path",
      run: () => handlers.toggleClosed(single.id, !closed),
    });
  }
  if (state.selection.pathEdit) {
    out.push({
      key: "split",
      label: "Split at the selected point",
      icon: "icon-split",
      run: handlers.splitPoint,
    });
  }
  if (sel.length === 2 && sel.every(canJoin)) {
    out.push({ key: "join", label: "Join the two paths", icon: "icon-join", run: handlers.join });
  }

  const groups = new Set(sel.map((e) => outerGroup(e) ?? ""));
  if (sel.length > 1 && !(groups.size === 1 && !groups.has(""))) {
    out.push({ key: "group", label: "Group", icon: "icon-group", run: handlers.group });
  }
  if (sel.some((e) => groupsOf(e).length)) {
    out.push({ key: "ungroup", label: "Ungroup", icon: "icon-ungroup", run: handlers.ungroup });
  }

  const ids = new Set(state.selection.elementIds);
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
  rotatable: boolean;
}

/** The screen rectangle the bar sits beside: the selection, or the path being drawn. */
function anchorRect(state: EditorState): AnchorRect | null {
  const drawing = findElement(state.drawing?.activePathId);
  const shapes = drawing ? [drawing] : selectedElements();
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
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
  }
  if (!Number.isFinite(left)) return null;
  const rotatable = !drawing && shapes.length === 1 && canRotate(shapes[0]!);
  return { left, right, top, bottom, rotatable };
}

/** Puts the bar just above the selection, or below it when there is no room. */
function position(state: EditorState): void {
  const at = anchorRect(state);
  if (!at) return;
  const size = bar.getBoundingClientRect();
  const x = Math.min(
    Math.max((at.left + at.right) / 2 - size.width / 2, 8),
    window.innerWidth - size.width - 8
  );
  // Above, the rotate handle hangs off the top of the shape and has to be cleared. Below there
  // is nothing in the way, so the bar sits close rather than a handle's height adrift.
  const above = at.top - size.height - GAP - (at.rotatable ? ROTATE_HANDLE_REACH : 0);
  const y = above > 8 ? above : Math.min(at.bottom + GAP, window.innerHeight - size.height - 8);
  bar.style.left = `${Math.max(8, x)}px`;
  bar.style.top = `${Math.max(8, y)}px`;
}

/** Called on every state change: shows, rebuilds and repositions the bar as needed. */
export function syncActionBar(state: EditorState): void {
  const drawing = !!state.drawing?.activePathId;
  const show =
    !state.finalOnly && !state.ui.editingTextId && (drawing || !!state.selection.elementIds.length);
  bar.classList.toggle("hidden", !show);
  if (!show) {
    lastSignature = "";
    return;
  }
  const actions = drawing ? drawingActions(state) : selectionActions(state);
  // Rebuilt only when the set of buttons, or whether they are enabled, actually changes.
  const signature = actions.map((a) => `${a.key}${a.disabled ? "-off" : ""}`).join(",");
  if (signature !== lastSignature) {
    build(actions);
    lastSignature = signature;
  }
  position(state);
}
