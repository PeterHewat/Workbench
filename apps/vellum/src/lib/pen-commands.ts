import { getState, setState, mutate, findElement, selectOnly } from "./state.js";
import { simplifyPathIfStraight } from "./model.js";
import { pushUndo } from "./undo.js";
import { type EditorState } from "./types.js";

export function setTool(tool: EditorState["tool"]): void {
  setState({ tool, selection: selectOnly(), drawing: null, dropTarget: null });
}

export function finishPath(): void {
  const d = getState().drawing;
  const activeId = d?.activePathId;
  if (!d || !activeId) return;
  const path = findElement(activeId);
  if (!path || path.type !== "path" || path.points.length < 2) {
    setState((s) => ({
      ...s,
      elements: s.elements.filter((e) => e.id !== activeId),
      drawing: null,
      dropTarget: null,
    }));
    return;
  }
  setState((s) => ({
    ...s,
    elements: s.elements.map((e) => (e.id === path.id ? simplifyPathIfStraight(e) : e)),
    drawing: { ...d, activePathId: null, preview: null },
    dropTarget: null,
  }));
}

/** Closes the path being drawn and finishes it, the button form of clicking the first anchor. */
export function closeAndFinishPath(): void {
  const activeId = getState().drawing?.activePathId;
  const path = findElement(activeId);
  if (!activeId || path?.type !== "path" || path.points.length < 3) return;
  pushUndo();
  mutate(() => {
    const p = findElement(activeId);
    if (p?.type === "path") p.closed = true;
  });
  finishPath();
}

/** Throws away the path being drawn, the button form of Esc. */
export function discardPath(): void {
  const activeId = getState().drawing?.activePathId;
  if (!activeId) return;
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.filter((e) => e.id !== activeId),
    drawing: null,
  }));
}

/** Takes back the last point placed by the pen, so a misplaced tap is one button to undo. */
export function removeLastPenPoint(): void {
  const activeId = getState().drawing?.activePathId;
  const path = findElement(activeId);
  if (!activeId || path?.type !== "path" || !path.points.length) return;
  pushUndo();
  if (path.points.length === 1) {
    setState((s) => ({
      ...s,
      elements: s.elements.filter((e) => e.id !== activeId),
      drawing: null,
      dropTarget: null,
    }));
    return;
  }
  mutate(() => {
    const p = findElement(activeId);
    if (p?.type === "path") p.points.pop();
  });
  setState((s) => ({ ...s, drawing: { ...s.drawing, activePathId: activeId, preview: null } }));
}
