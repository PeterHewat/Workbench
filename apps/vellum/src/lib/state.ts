import { AUTO_NAME_RE, deepClone } from "./utils.js";
import { isCoarsePointer } from "./pointer.js";
import { assignGroupHuesInPlace, pruneGroupsInPlace } from "./groups.js";
import type { EditorState, PathEdit, SceneElement, Selection } from "./types.js";

export interface NotifyOptions {
  /**
   * Only the pointer moved: the cursor, the hover target or the alignment guides changed, and
   * nothing else. The document, the lists and the SVG source can stay as they are.
   */
  pointerOnly?: boolean;
}

type Listener = (state: EditorState, options: NotifyOptions) => void;

/** The whole selection: some elements, plus optionally one of their anchors. */
export function selectOnly(elementIds: string[] = [], pathEdit: PathEdit | null = null): Selection {
  return { elementIds, pathEdit };
}

export function createInitialState(): EditorState {
  return {
    // 512 with a step of 16 is 32 cells across: one cell per pixel of a 32px icon, and it
    // halves cleanly all the way down. Both are editable in the Document panel.
    artboard: { width: 512, height: 512 },
    // Transparent, because that is what an icon is. The canvas shows it as a checkerboard so
    // transparent and white are told apart, and nothing is exported until a colour is chosen.
    background: { color: "#ffffff", opacity: 0 },
    grid: { step: 16, visible: true, snap: isCoarsePointer() },
    elements: [],
    groupNames: {},
    groupHues: {},
    images: [],
    viewport: { panX: 40, panY: 40, zoom: 1 },
    tool: "select",
    finalOnly: false,
    selection: selectOnly(),
    drawing: null,
    hoverId: null,
    cursor: { x: 0, y: 0, snapX: 0, snapY: 0, snapActive: false },
    align: { x: null, y: null },
    dropTarget: null,
    ui: { expandedImageId: null, expandedElementId: null, editingTextId: null },
    spacePan: false,
  };
}

let state: EditorState = createInitialState();
const listeners = new Set<Listener>();

export function getState(): EditorState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let pending: NotifyOptions | null = null;

/**
 * Keeps the model's invariants now, and renders on the next frame.
 *
 * A single pointer move can change state two or three times (the cursor, a drag, the hover),
 * and each change used to redraw everything at once. Deferred, they cost one render per frame
 * however many there were - and that render is a pointer-only one when all of them were.
 */
function notify(options: NotifyOptions): void {
  if (!options.pointerOnly) {
    ensureDefaultNames(state.elements);
    pruneGroupsInPlace(state.elements);
    assignGroupHuesInPlace(state.elements, state.groupHues);
  }
  if (pending) {
    pending = { pointerOnly: !!pending.pointerOnly && !!options.pointerOnly };
    return;
  }
  pending = { ...options };
  requestAnimationFrame(flushRender);
}

/** Renders now whatever is waiting for the next frame, for code that needs the DOM current. */
export function flushRender(): void {
  if (!pending) return;
  const options = pending;
  pending = null;
  for (const fn of listeners) fn(state, options);
}

/**
 * Every shape always has a real name. Unnamed shapes get "<type> <n>" (n = highest used for that
 * type + 1). Default names of another type (after path->line, rect->polygon, ...) and duplicated
 * default names (copy/paste) are renumbered. Names a user typed are never touched.
 */
function ensureDefaultNames(elements: SceneElement[]): void {
  const top = new Map<string, number>();
  const seen = new Set<string>();
  for (const el of elements) {
    const m = AUTO_NAME_RE.exec(el.name || "");
    if (m && m[1] === el.type) {
      top.set(el.type, Math.max(top.get(el.type) ?? 0, Number(m[2])));
    }
  }
  for (const el of elements) {
    const name = el.name || "";
    const m = AUTO_NAME_RE.exec(name);
    const keep = name && !(m && (m[1] !== el.type || seen.has(name)));
    if (keep) {
      if (m) seen.add(name);
      continue;
    }
    const n = (top.get(el.type) ?? 0) + 1;
    top.set(el.type, n);
    el.name = `${el.type} ${n}`;
    seen.add(el.name);
  }
}

type StatePatch = Partial<EditorState> | ((current: EditorState) => EditorState);

/** The slices that follow the pointer around without changing the drawing. */
const POINTER_KEYS: ReadonlySet<string> = new Set(["cursor", "align", "hoverId", "dropTarget"]);

/**
 * Whether going from `prev` to `next` changed pointer slices and nothing else. A change that
 * touched nothing at all is not one: a caller may have edited in place and wants a full render.
 */
function onlyPointerChanged(prev: EditorState, next: EditorState): boolean {
  let changed = false;
  for (const key of Object.keys(next) as (keyof EditorState)[]) {
    if (prev[key] === next[key]) continue;
    if (!POINTER_KEYS.has(key)) return false;
    changed = true;
  }
  return changed;
}

/** Replaces state slices. `patch` is an object of slices, or a function returning the next state. */
export function setState(patch: StatePatch): void {
  const prev = state;
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  notify({ pointerOnly: onlyPointerChanged(prev, state) });
}

/**
 * Edits the current state in place, then re-renders. Used where the change is a mutation of
 * existing geometry (drags, field edits) rather than a replacement of a slice.
 */
export function mutate(fn: (current: EditorState) => void): void {
  fn(state);
  notify({});
}

export function replaceState(next: EditorState): void {
  state = next;
  notify({});
}

/**
 * A snapshot for the undo stack. Reference images are cloned without their data URL, which is
 * then put back by reference: a base64 image is megabytes, the stack holds a hundred entries,
 * and the pixels never change - only the transform around them, which is what undo has to keep.
 */
export function snapshotForUndo(): EditorState {
  const urls = state.images.map((img) => img.dataUrl);
  const snap = deepClone({
    ...state,
    images: state.images.map((img) => ({ ...img, dataUrl: "" })),
  });
  snap.images.forEach((img, i) => {
    img.dataUrl = urls[i] ?? "";
  });
  return snap;
}

export function restoreSnapshot(snap: EditorState): void {
  replaceState(snap);
}

export function findElement(id: string | null | undefined): SceneElement | undefined {
  if (!id) return undefined;
  return state.elements.find((e) => e.id === id);
}

export function selectedElements(): SceneElement[] {
  return state.selection.elementIds
    .map((id) => findElement(id))
    .filter((e): e is SceneElement => !!e);
}
