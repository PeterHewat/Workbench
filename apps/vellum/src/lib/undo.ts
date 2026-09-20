import { restoreSnapshot, snapshotForUndo } from "./state.js";
import type { EditorState } from "./types.js";

const MAX = 100;
const undoStack: EditorState[] = [];
const redoStack: EditorState[] = [];

let listener: () => void = () => {};

export function setHistoryListener(fn: () => void): void {
  listener = fn;
}

export function pushUndo(): void {
  listener();
  undoStack.push(snapshotForUndo());
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0;
}

export function undo(): boolean {
  const prev = undoStack.pop();
  if (!prev) return false;
  redoStack.push(snapshotForUndo());
  restoreSnapshot(prev);
  listener();
  return true;
}

export function redo(): boolean {
  const next = redoStack.pop();
  if (!next) return false;
  undoStack.push(snapshotForUndo());
  restoreSnapshot(next);
  listener();
  return true;
}

export const canUndo = (): boolean => undoStack.length > 0;
export const canRedo = (): boolean => redoStack.length > 0;

export function clearHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}
