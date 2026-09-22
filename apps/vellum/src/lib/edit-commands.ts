import { getState } from "./state.js";
import { setTool } from "./pen-commands.js";
import {
  groupSelection,
  mergeSelection,
  ungroupSelection,
  joinSelected,
} from "./selection-commands.js";
import { copySelectionText, cutSelection, pasteFromText } from "./clipboard.js";
import { undo, redo } from "./undo.js";
import { beginTextEdit, endTextEdit, isTextEditing } from "./textedit.js";
import { type EditorState } from "./types.js";
import { invalidateLists } from "./accordion.js";
import { byId } from "@workbench/ui";

const svg = byId<HTMLElement>("viewport-svg");

// Clicking the canvas takes the keyboard back from any field so the shortcuts work again, and
// drops any leftover page text selection, which would otherwise suppress the Ctrl+C / Ctrl+X
// shape handlers below.
svg.addEventListener(
  "pointerdown",
  () => {
    if (isTextEditing()) endTextEdit(true);
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && a.matches?.("input, select, textarea")) a.blur();
    if (window.getSelection()?.toString()) window.getSelection()?.removeAllRanges();
  },
  true
);

/* Clipboard: our own JSON between sessions, plain SVG markup accepted on paste. */
const inField = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("input, textarea, select");
document.addEventListener("copy", (e) => {
  if (inField(e.target) || window.getSelection()?.toString()) return;
  const text = copySelectionText();
  if (text) {
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
  }
});
document.addEventListener("cut", (e) => {
  if (inField(e.target) || window.getSelection()?.toString()) return;
  const text = cutSelection();
  if (text) {
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
  }
});
document.addEventListener("paste", (e) => {
  if (inField(e.target)) return;
  if (pasteFromText(e.clipboardData?.getData("text/plain") ?? "")) e.preventDefault();
});

export function doUndo(): void {
  if (undo()) invalidateLists();
}
export function doRedo(): void {
  if (redo()) invalidateLists();
}
byId("btn-undo").addEventListener("click", doUndo);
byId("btn-redo").addEventListener("click", doRedo);

byId("btn-join").addEventListener("click", () => joinSelected());
byId("btn-group").addEventListener("click", () => groupSelection());
byId("btn-merge").addEventListener("click", () => mergeSelection());
byId("btn-ungroup").addEventListener("click", () => ungroupSelection());

// A new (or double-clicked) text element is edited where it sits, not in the panel.
document.addEventListener("focus-text", ((e: CustomEvent<{ id: string }>) => {
  beginTextEdit(e.detail.id);
}) as EventListener);

document.querySelectorAll<HTMLElement>(".tool-btn[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool as EditorState["tool"];
    // Tapping the active drawing tool puts the canvas back to selecting, which is the way out
    // of a tool when there is no Esc key to press.
    setTool(tool !== "select" && getState().tool === tool ? "select" : tool);
  });
});
