/**
 * The bar that follows the selection.
 *
 * Almost everything you do to a shape once it exists - delete it, duplicate it, move it in
 * z-order, close a path, group it - was reachable only from a keyboard shortcut or from a row
 * inside the Document panel, which on a phone covers the artboard. This puts those actions next
 * to the shape itself.
 *
 * It appears for imprecise pointers and narrow screens, where there is no keyboard to lean on.
 * On a desktop with a mouse the shortcuts are there and the bar would only be in the way.
 */

import { selectedElements } from "./state.js";
import { canJoin, canRotate, canToggleClosed, elementBBox, isClosedShape } from "./model.js";
import { groupsOf, outerGroup } from "./groups.js";
import { worldToScreen } from "./viewport.js";
import { isCoarsePointer } from "./pointer.js";
import type { EditorState } from "./types.js";

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
}

interface Action {
  key: string;
  label: string;
  icon?: string;
  glyph?: string;
  run: () => void;
}

/** How far above the selection the rotate handle hangs, in screen pixels (see render.ts). */
const ROTATE_HANDLE_REACH = 56;

let bar: HTMLElement;
let handlers: ActionBarHandlers;
let narrowQuery: MediaQueryList | null = null;
let lastSignature = "";

export function initActionBar(element: HTMLElement, fns: ActionBarHandlers): void {
  bar = element;
  handlers = fns;
  narrowQuery = window.matchMedia("(max-width: 760px)");
  // A press on the bar is a press on the bar, not on the canvas underneath it.
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
}

/** Whether this device is one where the bar earns its place. */
function wanted(): boolean {
  return isCoarsePointer() || !!narrowQuery?.matches;
}

function actionsFor(state: EditorState): Action[] {
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
  if (single && canToggleClosed(single)) {
    const closed = isClosedShape(single);
    out.push({
      key: "closed",
      label: closed ? "Open path" : "Close path",
      glyph: closed ? "◜" : "○",
      run: () => handlers.toggleClosed(single.id, !closed),
    });
  }
  if (state.selection.pathEdit) {
    out.push({ key: "split", label: "Split at point", glyph: "✂", run: handlers.splitPoint });
  }
  if (sel.length === 2 && sel.every(canJoin)) {
    out.push({ key: "join", label: "Join paths", glyph: "⌒", run: handlers.join });
  }

  const groups = new Set(sel.map((e) => outerGroup(e) ?? ""));
  if (sel.length > 1 && !(groups.size === 1 && !groups.has(""))) {
    out.push({ key: "group", label: "Group", glyph: "⧉", run: handlers.group });
  }
  if (sel.some((e) => groupsOf(e).length)) {
    out.push({ key: "ungroup", label: "Ungroup", glyph: "⧅", run: handlers.ungroup });
  }

  out.push(
    { key: "back", label: "Send backward", glyph: "↓", run: handlers.back },
    { key: "forward", label: "Bring forward", glyph: "↑", run: handlers.forward },
    { key: "duplicate", label: "Duplicate", icon: "icon-copy", run: handlers.duplicate },
    { key: "delete", label: "Delete", icon: "icon-trash", run: handlers.remove }
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
    if (action.key === "delete") btn.classList.add("action-danger");
    btn.addEventListener("click", action.run);
    bar.appendChild(btn);
  }
}

/** Puts the bar just above the selection, or below it when there is no room. */
function position(): void {
  const sel = selectedElements();
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const el of sel) {
    const box = elementBBox(el);
    if (!box) continue;
    const a = worldToScreen(box.x, box.y);
    const b = worldToScreen(box.x + box.width, box.y + box.height);
    left = Math.min(left, a.x);
    right = Math.max(right, b.x);
    top = Math.min(top, a.y);
    bottom = Math.max(bottom, b.y);
  }
  if (!Number.isFinite(left)) return;

  const size = bar.getBoundingClientRect();
  // Clear the rotate handle, which hangs above the selection box on a single shape.
  const single = sel.length === 1 ? sel[0]! : null;
  const gap = 12 + (single && canRotate(single) ? ROTATE_HANDLE_REACH : 0);
  const x = Math.min(
    Math.max((left + right) / 2 - size.width / 2, 8),
    window.innerWidth - size.width - 8
  );
  const above = top - size.height - gap;
  const y = above > 8 ? above : Math.min(bottom + gap, window.innerHeight - size.height - 8);
  bar.style.left = `${Math.max(8, x)}px`;
  bar.style.top = `${Math.max(8, y)}px`;
}

/** Called on every state change: shows, rebuilds and repositions the bar as needed. */
export function syncActionBar(state: EditorState): void {
  const show =
    wanted() &&
    !state.finalOnly &&
    !state.ui.editingTextId &&
    !state.drawing?.activePathId &&
    state.selection.elementIds.length > 0;
  bar.classList.toggle("hidden", !show);
  if (!show) {
    lastSignature = "";
    return;
  }
  const actions = actionsFor(state);
  const signature = actions.map((a) => a.key).join(",");
  if (signature !== lastSignature) {
    build(actions);
    lastSignature = signature;
  }
  position();
}
