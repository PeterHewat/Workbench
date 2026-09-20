import { AUTO_NAME_RE, deepClone } from "./utils.js";
import type { EditorState, PathEdit, SceneElement, Selection } from "./types.js";

export interface NotifyOptions {
  full?: boolean;
}

type Listener = (state: EditorState, options: NotifyOptions) => void;

/** The whole selection: some elements, plus optionally one of their anchors. */
export function selectOnly(elementIds: string[] = [], pathEdit: PathEdit | null = null): Selection {
  return { elementIds, pathEdit };
}

export function createInitialState(): EditorState {
  return {
    artboard: { width: 1000, height: 1000 },
    grid: { step: 10, visible: true, snap: false },
    elements: [],
    images: [],
    viewport: { panX: 40, panY: 40, zoom: 1 },
    tool: "select",
    finalOnly: false,
    selection: selectOnly(),
    drawing: null,
    hoverId: null,
    cursor: { x: 0, y: 0, snapX: 0, snapY: 0, snapActive: false },
    align: { x: null, y: null },
    ui: { expandedImageId: null, expandedElementId: null },
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

function notify(options: NotifyOptions): void {
  ensureDefaultNames(state.elements);
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

/** Replaces state slices. `patch` is an object of slices, or a function returning the next state. */
export function setState(patch: StatePatch, options: NotifyOptions = {}): void {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  notify(options);
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
  notify({ full: true });
}

export function snapshotForUndo(): EditorState {
  return deepClone(state);
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
