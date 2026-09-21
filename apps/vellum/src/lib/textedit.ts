/**
 * Editing a text element where it sits on the canvas.
 *
 * The alternative was what this replaces: placing text opened the Document panel, expanded the
 * shape's row and focused a field in it. On a phone that panel covers the artboard, so you typed
 * without being able to see what you were typing on.
 *
 * An input is positioned over the element and styled to match it, the SVG text is hidden while
 * it is up (see render.ts), and the two stay in step because the input writes straight through
 * to the element on every keystroke.
 */

import { findElement, getState, mutate, setState } from "./state.js";
import { elementBBox } from "./model.js";
import { worldToScreen } from "./viewport.js";
import { pushUndo } from "./undo.js";
import type { TextElement } from "./types.js";

let input: HTMLInputElement | null = null;
let host: HTMLElement | null = null;
let editingId: string | null = null;
let originalText = "";
let undoPushed = false;
let onChanged: () => void = () => {};

export function initTextEdit(canvasWrap: HTMLElement, changed: () => void): void {
  host = canvasWrap;
  onChanged = changed;
}

export function isTextEditing(): boolean {
  return editingId != null;
}

function textElement(id: string | null): TextElement | null {
  const el = findElement(id);
  return el?.type === "text" ? el : null;
}

/** Puts the input where the element is, at the size it is drawn, rotation included. */
export function positionTextEditor(): void {
  const el = textElement(editingId);
  const box = el ? elementBBox(el) : null;
  if (!input || !el || !box || !host) return;
  const { zoom } = getState().viewport;
  const rect = host.getBoundingClientRect();
  const at = worldToScreen(box.x, box.y);
  const size = el.fontSize * zoom;

  input.style.left = `${at.x - rect.left}px`;
  input.style.top = `${at.y - rect.top}px`;
  input.style.height = `${box.height * zoom}px`;
  // Wide enough to keep typing into, and never off the edge of the canvas.
  input.style.width = `${Math.min(Math.max(box.width * zoom + size * 4, 120), rect.width - (at.x - rect.left) - 8)}px`;
  input.style.fontSize = `${size}px`;
  input.style.fontFamily = el.fontFamily || "sans-serif";
  input.style.color = el.fillEnabled ? el.fill : el.stroke;
  input.style.textAlign =
    el.anchor === "middle" ? "center" : el.anchor === "end" ? "right" : "left";

  const anchor = worldToScreen(el.x, el.y);
  input.style.transformOrigin = `${anchor.x - rect.left - (at.x - rect.left)}px ${anchor.y - rect.top - (at.y - rect.top)}px`;
  input.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : "";
}

function ensureInput(): HTMLInputElement {
  if (input) return input;
  const node = document.createElement("input");
  node.type = "text";
  node.className = "text-edit";
  node.autocomplete = "off";
  node.spellcheck = false;
  node.setAttribute("aria-label", "Text content");
  node.placeholder = "Type here";

  node.addEventListener("input", () => {
    const el = textElement(editingId);
    if (!el) return;
    if (!undoPushed) {
      pushUndo();
      undoPushed = true;
    }
    mutate(() => {
      const target = textElement(editingId);
      if (target) target.text = node.value;
    });
    positionTextEditor();
    onChanged();
  });

  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      endTextEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      endTextEdit(false);
    }
    // Everything else stays in the field: the canvas shortcuts must not fire while typing.
    e.stopPropagation();
  });

  node.addEventListener("blur", () => endTextEdit(true));
  // A press inside the field is not a press on the canvas.
  node.addEventListener("pointerdown", (e) => e.stopPropagation());

  host?.appendChild(node);
  input = node;
  return node;
}

export function beginTextEdit(id: string): void {
  const el = textElement(id);
  if (!el || !host) return;
  if (editingId && editingId !== id) endTextEdit(true);

  const node = ensureInput();
  editingId = id;
  originalText = el.text;
  undoPushed = false;
  node.value = el.text;
  node.classList.add("visible");
  setState((s) => ({ ...s, ui: { ...s.ui, editingTextId: id } }));
  positionTextEditor();
  // After the state render, so the field is not taken over by the re-render that follows it.
  setTimeout(() => {
    node.focus();
    node.select();
  }, 0);
}

/** Ends the session, keeping what was typed or putting the original back. */
export function endTextEdit(commit: boolean): void {
  const id = editingId;
  if (!id || !input) return;
  editingId = null;
  const node = input;
  node.classList.remove("visible");

  if (!commit) {
    mutate(() => {
      const el = textElement(id);
      if (el) el.text = originalText;
    });
  }
  // Placing text and typing nothing leaves an empty element behind; drop it instead.
  const el = textElement(id);
  const empty = el && !el.text.trim();
  setState((s) => ({
    ...s,
    elements: empty ? s.elements.filter((e) => e.id !== id) : s.elements,
    selection: empty
      ? { elementIds: [], pathEdit: null }
      : { ...s.selection, elementIds: [id], pathEdit: null },
    ui: { ...s.ui, editingTextId: null },
  }));
  if (node === document.activeElement) node.blur();
  onChanged();
}
