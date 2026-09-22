import { getState, setState } from "./state.js";
import { pushUndo } from "./undo.js";
import { escapeAttr } from "./utils.js";
import { moveWithinParent } from "./groups.js";
import { type EditorState } from "./types.js";

/* ---------- Accordion lists (Primitives and Reference images share the row layout) ---------- */

interface CachedList {
  sync(state: EditorState): void;
  invalidate(): void;
}

/**
 * Rebuilds a list only when its structure changed; otherwise just refreshes the values in place,
 * so typing in a field is never interrupted by a re-render.
 */
const lists: CachedList[] = [];

export function cachedList(
  keyOf: (state: EditorState) => string,
  build: (state: EditorState) => void,
  update: (state: EditorState) => void
): CachedList {
  let key: string | null = null;
  const list: CachedList = {
    sync(state) {
      const next = keyOf(state);
      if (next === key) {
        update(state);
        return;
      }
      key = next;
      build(state);
    },
    invalidate() {
      key = null;
    },
  };
  lists.push(list);
  return list;
}

/** Forces every list to rebuild on its next sync, for when the document was replaced wholesale. */
export function invalidateLists(): void {
  for (const list of lists) list.invalidate();
}

interface AccHeaderOptions {
  /** The checkbox at the head of the row, when the row can be selected. */
  dot?: { on: boolean; title: string };
  /** The eye, when the row can be shown and hidden. */
  eye?: { visible: boolean; title: string };
  /** The editable name, unless `titleHtml` replaces the field with something else. */
  name?: string;
  placeholder?: string;
  titleHtml?: string;
  extra?: string;
  index: number;
  count: number;
  /** Whether the move would actually do anything; defaults to the plain list position. */
  canUp?: boolean;
  canDown?: boolean;
}

/**
 * The dot at the head of a row. A radio where only one thing can be chosen at a time (which
 * document is open), a checkbox where any number can (which shapes are selected) - the shape of
 * the control is the rule it obeys.
 */
export function rowDotHtml(
  kind: "radio" | "check",
  on: boolean,
  title: string,
  extra = ""
): string {
  const icon =
    kind === "radio"
      ? on
        ? "icon-radio-on"
        : "icon-radio-off"
      : on
        ? "icon-check-on"
        : "icon-check-off";
  return `<button type="button" class="btn-visibility${on ? "" : " is-off"}"${extra} title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" role="${kind === "radio" ? "radio" : "checkbox"}" aria-checked="${on}">
      <svg class="ui-icon" aria-hidden="true"><use href="#${icon}" /></svg>
    </button>`;
}

/**
 * The eye: whether a thing is drawn. Separate from the checkbox, which says whether it is
 * selected - one control, one meaning, in every list.
 */
export function eyeHtml(
  visible: boolean,
  title: string,
  extra = ' data-action="toggle-eye"'
): string {
  return `<button type="button" class="btn-visibility btn-eye${visible ? "" : " is-off"}"${extra} title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" aria-pressed="${!visible}">
      <svg class="ui-icon" aria-hidden="true"><use href="#${visible ? "icon-eye" : "icon-eye-off"}" /></svg>
    </button>`;
}

export function accHeaderHtml(o: AccHeaderOptions): string {
  return `<div class="acc-header-row">
      <button type="button" class="acc-expand-btn" data-action="toggle-expand" aria-label="Expand" title="Expand / collapse">
        <span class="chevron" aria-hidden="true">▶</span>
      </button>
      ${o.dot ? rowDotHtml("check", o.dot.on, o.dot.title, ' data-action="toggle-dot"') : ""}
      ${o.titleHtml ?? `<input type="text" class="acc-title-input" data-field="name" value="${escapeAttr(o.name ?? "")}" placeholder="${escapeAttr(o.placeholder ?? "")}" />`}
      ${o.extra ?? ""}
      ${o.eye ? eyeHtml(o.eye.visible, o.eye.title) : ""}
      <button type="button" class="acc-icon-btn acc-move" data-action="move-up" title="Move up (Shift: to top)" aria-label="Move up"${(o.canUp ?? o.index > 0) ? "" : " disabled"}>▲</button>
      <button type="button" class="acc-icon-btn acc-move" data-action="move-down" title="Move down (Shift: to bottom)" aria-label="Move down"${(o.canDown ?? o.index < o.count - 1) ? "" : " disabled"}>▼</button>
      <button type="button" class="acc-icon-btn acc-trash" data-action="delete" title="Delete" aria-label="Delete">
        <svg class="ui-icon" aria-hidden="true"><use href="#icon-trash" /></svg>
      </button>
    </div>`;
}

interface AccHandlers {
  onExpand: () => void;
  onDot?: () => void;
  onEye?: () => void;
  onDelete: () => void;
  onMove: (dir: number, toEnd: boolean) => void;
}

export function wireAccRow(li: HTMLElement, h: AccHandlers): void {
  li.querySelector('[data-action="toggle-expand"]')!.addEventListener("click", h.onExpand);
  const on = (action: string, fn: (() => void) | undefined) =>
    li
      .querySelector(`:scope > .acc-header-row [data-action="${action}"]`)
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        fn?.();
      });
  on("toggle-dot", h.onDot);
  on("toggle-eye", h.onEye);
  li.querySelector('[data-action="delete"]')!.addEventListener("click", h.onDelete);
  li.querySelector('[data-action="move-up"]')!.addEventListener("click", (e) =>
    h.onMove(-1, (e as MouseEvent).shiftKey)
  );
  li.querySelector('[data-action="move-down"]')!.addEventListener("click", (e) =>
    h.onMove(1, (e as MouseEvent).shiftKey)
  );
}

/** Writes a value into a row's field, unless the user is currently typing in it. */
export function setField(li: HTMLElement, field: string, value: string | number): void {
  const input = li.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`);
  if (input && input !== document.activeElement) input.value = String(value);
}

/** New index after moving one step (or, with `toEnd`, all the way) up (-1) or down (+1). */
function movedIndex(idx: number, length: number, dir: number, toEnd: boolean): number {
  return toEnd ? (dir < 0 ? 0 : length - 1) : Math.min(Math.max(idx + dir, 0), length - 1);
}

/**
 * Moves one entry within the list. An element moves among its siblings inside whatever group
 * holds it, and a nested group counts as one sibling, so reordering can never split a group.
 */
export function reorder(key: "elements" | "images", id: string, dir: number, toEnd: boolean): void {
  if (key === "elements") {
    const before = getState().elements;
    const next = moveWithinParent(before, id, dir < 0 ? -1 : 1, toEnd);
    if (next.every((e, i) => e === before[i])) return;
    pushUndo();
    setState((s) => ({ ...s, elements: next }));
    return;
  }
  const cur = getState().images;
  const from = cur.findIndex((e) => e.id === id);
  const to = movedIndex(from, cur.length, dir, toEnd);
  if (from < 0 || to === from) return;
  pushUndo();
  setState((s) => {
    const next = [...s.images];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    return { ...s, images: next };
  });
}
