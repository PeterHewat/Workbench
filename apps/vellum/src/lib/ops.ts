import { setState } from "./state.js";
import { pushUndo } from "./undo.js";
import { type Drawing } from "./types.js";

export function setDrawing(drawing: Drawing): void {
  setState({ drawing });
}

export function clearDrawing(): void {
  setState({ drawing: null });
}

export function commit(fn: () => void): void {
  pushUndo();
  fn();
}

/** The anchor index a resize-handle role refers to, or null for box/radius handles. */
export function pointIndexForRole(role: string): number | null {
  if (role.startsWith("pt-")) return parseInt(role.slice(3), 10);
  if (role === "p1") return 0;
  if (role === "p2") return 1;
  return null;
}
