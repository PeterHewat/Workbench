import {
  getState,
  setState,
  mutate,
  subscribe,
  findElement,
  replaceState,
  createInitialState,
  selectOnly,
} from "./state.js";
import { initViewport, fitArtboardInView, zoomAt } from "./viewport.js";
import { initRender, renderAll } from "./render.js";
import {
  bindInteraction,
  setTool,
  finishPath,
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  moveZOrder,
  cancelOperation,
  closeAndFinishPath,
  removeLastPenPoint,
  groupSelection,
  ungroupSelection,
  splitAtSelectedPoint,
  joinSelected,
  copySelectionText,
  cutSelection,
  pasteFromText,
  setElementClosed,
} from "./interaction.js";
import {
  pushUndo,
  undo,
  redo,
  canUndo,
  canRedo,
  clearHistory,
  setHistoryListener,
} from "./undo.js";
import {
  listDocuments,
  saveDocument,
  loadDocument,
  deleteDocument,
  renameDocument,
  duplicateDocument,
  exportAllDocuments,
  type DocumentMeta,
} from "./storage.js";
import {
  elementToSvgMarkup,
  buildDefsMarkup,
  sanitizeName,
  elementIdFromSvgId,
  formatExportSvg,
  serializeProject,
  loadProject,
  importSvgFile,
} from "./io.js";
import {
  createImage,
  MARKER_TYPES,
  MARKER_SHAPES,
  canToggleClosed,
  isClosedShape,
  canJoin,
  elementBBox,
  translateElement,
  gradientStops,
  keepsRotation,
} from "./model.js";
import { deepClone, downloadText, escapeAttr, escapeXml, uid } from "./utils.js";
import { bindTouch, setTouchFinishPathHandler } from "./touch.js";
import { openColorPicker, closeColorPicker, isColorPickerOpenFor } from "./colorpicker.js";
import { initRulers, renderRulers, setRulerOffset } from "./rulers.js";
import { initActionBar, syncActionBar } from "./actionbar.js";
import {
  beginTextEdit,
  endTextEdit,
  initTextEdit,
  isTextEditing,
  positionTextEditor,
} from "./textedit.js";
import { initPointerKind } from "./pointer.js";
import {
  canMoveWithinParent,
  groupsOf,
  innerGroup,
  moveWithinParent,
  outerGroup,
} from "./groups.js";
import { scaleAbout, transformElement } from "./transform.js";
import { registerServiceWorker } from "@workbench/ui";
import type { EditorState, ProjectFile, ReferenceImage, SceneElement } from "./types.js";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function bySelector<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

const svg = byId<HTMLElement>("viewport-svg") as unknown as SVGSVGElement;
const camera = byId<HTMLElement>("camera") as unknown as SVGGElement;
const wrap = byId("canvas-wrap");
const imageListEl = byId("image-list");
const primitiveListEl = byId("primitive-list");

initPointerKind(() => renderAll(getState()));
initViewport(svg, camera);
initRender({
  artboardBg: byId<HTMLElement>("artboard-bg") as unknown as SVGRectElement,
  images: byId<HTMLElement>("layer-images") as unknown as SVGGElement,
  grid: byId<HTMLElement>("layer-grid") as unknown as SVGGElement,
  document: byId<HTMLElement>("layer-document") as unknown as SVGGElement,
  overlay: byId<HTMLElement>("layer-overlay") as unknown as SVGGElement,
});

initTextEdit(wrap, () => primitiveList.invalidate());
initActionBar(byId("action-bar"), {
  duplicate: () => duplicateSelection(),
  remove: () => deleteSelection(),
  forward: () => moveZOrder("forward"),
  back: () => moveZOrder("back"),
  toggleClosed: (id, closed) => {
    setElementClosed(id, closed);
    primitiveList.invalidate();
  },
  group: () => groupSelection(),
  ungroup: () => ungroupSelection(),
  splitPoint: () => splitAtSelectedPoint(),
  join: () => joinSelected(),
  editText: (id) => beginTextEdit(id),
  finishPath: () => {
    pushUndo();
    finishPath();
  },
  closeAndFinishPath: () => closeAndFinishPath(),
  undoPoint: () => removeLastPenPoint(),
});
bindInteraction(svg, wrap);
setTouchFinishPathHandler(() => finishPath());
bindTouch(svg);

initRulers({
  topCanvas: byId<HTMLCanvasElement>("ruler-top"),
  leftCanvas: byId<HTMLCanvasElement>("ruler-left"),
  cornerEl: byId("ruler-corner"),
  svg,
});
window.addEventListener("resize", () => renderRulers(getState()));

subscribe((state) => {
  renderAll(state);
  renderRulers(state);
  syncPanel(state);
  syncActionBar(state);
  // The in-place text field rides along with the camera and with the element it is editing.
  if (state.ui.editingTextId) positionTextEditor();
});

function setToggle(id: string, on: boolean): void {
  const btn = byId(id);
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", String(on));
}

function syncPanel(state: EditorState): void {
  byId<HTMLInputElement>("artboard-width").value = String(state.artboard.width);
  byId<HTMLInputElement>("artboard-height").value = String(state.artboard.height);
  byId<HTMLInputElement>("grid-step").value = String(state.grid.step);
  setToggle("btn-grid", state.grid.visible);
  setToggle("btn-final", state.finalOnly);
  setToggle("btn-snap", state.grid.snap);

  const c = state.cursor;
  const x = c.snapActive ? c.snapX : c.x;
  const y = c.snapActive ? c.snapY : c.y;
  byId("cursor-pos").textContent = `${Math.round(x)}, ${Math.round(y)}`;

  document.querySelectorAll<HTMLElement>(".tool-btn[data-tool]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === state.tool);
  });
  wrap.classList.toggle("mode-hand", state.spacePan);
  wrap.classList.toggle("mode-select", state.tool === "select" && !state.spacePan);

  byId<HTMLButtonElement>("btn-undo").disabled = !canUndo();
  byId<HTMLButtonElement>("btn-redo").disabled = !canRedo();

  imageList.sync(state);
  primitiveList.sync(state);
  syncSvgEditor(state);
  syncGroupButtons(state);
}

/** Group / Ungroup / Join are only enabled when they would actually do something. */
function syncGroupButtons(state: EditorState): void {
  const ids = new Set(state.selection.elementIds);
  const sel = state.elements.filter((e) => ids.has(e.id));
  const groups = new Set(sel.map((e) => outerGroup(e) ?? ""));
  const allInOneGroup = groups.size === 1 && !groups.has("");
  byId<HTMLButtonElement>("btn-group").disabled = sel.length < 2 || allInOneGroup;
  byId<HTMLButtonElement>("btn-ungroup").disabled = !sel.some((e) => groupsOf(e).length);
  byId<HTMLButtonElement>("btn-join").disabled = !(sel.length === 2 && sel.every(canJoin));
}

/* ---------- SVG source: editable, highlighted, synced with the selection ---------- */
const svgInput = byId<HTMLTextAreaElement>("svg-input");
const svgPre = byId("svg-preview");
const svgError = byId("svg-error");
let svgEditUndoPushed = false;
let svgApplyTimer: ReturnType<typeof setTimeout> | null = null;
let lastSelectionKey = "";

// Primitive-row field that has keyboard focus -> the SVG attribute(s) it edits.
const FIELD_ATTRS: Record<string, string[]> = {
  stroke: ["stroke", "stroke-opacity"],
  strokeWidth: ["stroke-width", "stroke"],
  linecap: ["stroke-linecap"],
  linejoin: ["stroke-linejoin"],
  fill: ["fill", "fill-opacity"],
  fillEnabled: ["fill", "fill-opacity"],
  fillType: ["fill"],
  stopOffset: [],
  rx: ["rx", "ry"],
  ry: ["rx", "ry"],
  fontSize: ["font-size"],
  fontFamily: ["font-family"],
  anchor: ["text-anchor"],
  rotation: ["transform"],
  markerStart: ["marker-start"],
  markerEnd: ["marker-end"],
  name: ["id"],
  closed: ["d", "points"],
};
// Fields whose values live in a <defs> block: id prefix (and suffix) of that block.
const FIELD_BLOCKS: Record<string, [string, string?]> = {
  fillType: ["grad-"],
  fill: ["grad-"],
  stopOffset: ["grad-"],
  markerStart: ["mk-", "-start"],
  markerEnd: ["mk-", "-end"],
};
let svgFocus: { id: string; field: string } | null = null;

function highlightAttrs(esc: string, field: string): string {
  let out = esc;
  for (const attr of FIELD_ATTRS[field] ?? []) {
    out = out.replace(
      new RegExp(`(\\s)(${attr}="[^"]*")`, "g"),
      '$1<span class="svg-attr-focus">$2</span>'
    );
  }
  if (field === "text") {
    out = out.replace(/(&gt;)([^<]*)(&lt;\/text)/, '$1<span class="svg-attr-focus">$2</span>$3');
  }
  return out;
}

/** Colored copy of the textarea's text: selected shapes blue, the focused attribute highlighted. */
function refreshSvgHighlight(selectedIds: readonly string[]): void {
  const sel = new Set(selectedIds);
  const focus = svgFocus;
  const block = focus ? FIELD_BLOCKS[focus.field] : undefined;
  let inBlock = false;
  svgPre.innerHTML = svgInput.value
    .split("\n")
    .map((line) => {
      let esc = escapeXml(line);
      const m = line.match(/\bid="([^"]+)"/);
      const svgId = m ? m[1]! : "";
      const elId = m ? elementIdFromSvgId(svgId) : null;
      if (focus && elId === focus.id) esc = highlightAttrs(esc, focus.field);
      let out =
        elId && sel.has(elId) ? `<span class="svg-line svg-line--selected">${esc}</span>` : esc;
      if (block && focus) {
        if (svgId.startsWith(block[0] + focus.id) && (!block[1] || svgId.endsWith(block[1]))) {
          inBlock = true;
        }
        if (inBlock) out = `<span class="svg-attr-focus">${escapeXml(line)}</span>`;
        if (inBlock && /<\/(linearGradient|radialGradient|marker)>/.test(line)) inBlock = false;
      }
      return out;
    })
    .join("\n");
  svgPre.scrollTop = svgInput.scrollTop;
}

function setSvgFocus(next: { id: string; field: string } | null): void {
  const same = svgFocus?.id === next?.id && svgFocus?.field === next?.field;
  svgFocus = next;
  if (same) return;
  refreshSvgHighlight(getState().selection.elementIds);
  if (next && document.activeElement !== svgInput) {
    const hit = svgPre.querySelector<HTMLElement>(".svg-attr-focus");
    if (hit) {
      svgInput.scrollTop = Math.max(0, hit.offsetTop - 60);
      svgPre.scrollTop = svgInput.scrollTop;
    }
  }
}

function fieldOf(target: EventTarget | null): { id: string; field: string } | null {
  const el = target as HTMLElement | null;
  const li = el?.closest<HTMLElement>("[data-element-id]");
  if (!li || !primitiveListEl.contains(li)) return null;
  const field = el?.closest<HTMLElement>("[data-picker]")?.dataset.picker ?? el?.dataset.field;
  const id = li.dataset.elementId;
  return field && id ? { id, field } : null;
}

primitiveListEl.addEventListener("focusin", (e) => setSvgFocus(fieldOf(e.target)));
let pickerHold = false; // the color popover steals focus but its swatch stays "in use"
primitiveListEl.addEventListener("focusout", () => {
  if (!pickerHold) setSvgFocus(null);
});

function syncSvgEditor(state: EditorState): void {
  const focused = document.activeElement === svgInput;
  if (!focused) {
    const text = formatExportSvg(state, true);
    if (svgInput.value !== text) {
      const top = svgInput.scrollTop;
      svgInput.value = text;
      svgInput.scrollTop = top;
      hideSvgError();
    }
  }
  refreshSvgHighlight(state.selection.elementIds);
  const key = state.selection.elementIds.join(",");
  if (!focused && key !== lastSelectionKey) {
    const line = svgPre.querySelector<HTMLElement>(".svg-line--selected");
    if (line) svgInput.scrollTop = Math.max(0, line.offsetTop - 40);
    svgPre.scrollTop = svgInput.scrollTop;
  }
  lastSelectionKey = key;
}

function showSvgError(message: string): void {
  svgError.textContent = `Invalid SVG — not applied: ${message}`;
  svgError.classList.remove("hidden");
  svgInput.classList.add("invalid");
}

function hideSvgError(): void {
  svgError.classList.add("hidden");
  svgInput.classList.remove("invalid");
}

function sameElement(a: SceneElement, b: SceneElement): boolean {
  return (
    a.type === b.type &&
    elementToSvgMarkup(a) === elementToSvgMarkup(b) &&
    buildDefsMarkup([a]) === buildDefsMarkup([b]) &&
    sanitizeName(a.name) === sanitizeName(b.name) &&
    groupsOf(a).join("/") === groupsOf(b).join("/")
  );
}

/** Applies the edited markup. Untouched shapes keep their exact float geometry. */
function applySvgText(): void {
  svgApplyTimer = null;
  let parsed;
  try {
    parsed = importSvgFile(svgInput.value, { keepIds: true });
  } catch (err) {
    showSvgError(err instanceof Error ? err.message : String(err));
    return;
  }
  hideSvgError();
  const st = getState();
  const old = new Map(st.elements.map((e) => [e.id, e]));
  const next = parsed.elements.map((n) => {
    const o = old.get(n.id);
    return o && sameElement(o, n) ? o : n;
  });
  const artboard = parsed.artboard ? { ...st.artboard, ...parsed.artboard } : st.artboard;
  const same =
    next.length === st.elements.length &&
    next.every((e, i) => e === st.elements[i]) &&
    artboard.width === st.artboard.width &&
    artboard.height === st.artboard.height;
  if (same) return;
  if (!svgEditUndoPushed) {
    pushUndo();
    svgEditUndoPushed = true;
  }
  const ids = new Set(next.map((e) => e.id));
  setState((s) => ({
    ...s,
    elements: next,
    artboard,
    selection: selectOnly(s.selection.elementIds.filter((id) => ids.has(id))),
  }));
  noteChange();
}

svgInput.addEventListener("focus", () => {
  svgEditUndoPushed = false;
});
svgInput.addEventListener("input", () => {
  refreshSvgHighlight(getState().selection.elementIds);
  if (svgApplyTimer) clearTimeout(svgApplyTimer);
  svgApplyTimer = setTimeout(applySvgText, 500);
});
svgInput.addEventListener("blur", () => {
  if (svgApplyTimer) {
    clearTimeout(svgApplyTimer);
    applySvgText();
  }
});
svgInput.addEventListener("scroll", () => {
  svgPre.scrollTop = svgInput.scrollTop;
});

// Cursor inside a shape's line selects that shape (like picking it in Primitives).
document.addEventListener("selectionchange", () => {
  if (document.activeElement !== svgInput) return;
  const before = svgInput.value.slice(0, svgInput.selectionStart ?? 0);
  const line = svgInput.value.split("\n")[before.split("\n").length - 1] ?? "";
  const m = line.match(/\bid="([^"]+)"/);
  const elId = m ? elementIdFromSvgId(m[1]) : null;
  if (!elId || !findElement(elId)) return;
  const cur = getState().selection.elementIds;
  if (cur.length === 1 && cur[0] === elId) return;
  setState({ tool: "select", selection: selectOnly([elId]) });
});

/* ---------- Accordion lists (Primitives and Reference images share the row layout) ---------- */

interface CachedList {
  sync(state: EditorState): void;
  invalidate(): void;
}

/**
 * Rebuilds a list only when its structure changed; otherwise just refreshes the values in place,
 * so typing in a field is never interrupted by a re-render.
 */
function cachedList(
  keyOf: (state: EditorState) => string,
  build: (state: EditorState) => void,
  update: (state: EditorState) => void
): CachedList {
  let key: string | null = null;
  return {
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
}

function invalidateLists(): void {
  imageList.invalidate();
  primitiveList.invalidate();
}

interface AccHeaderOptions {
  on: boolean;
  dotTitle: string;
  name: string;
  placeholder: string;
  extra?: string;
  index: number;
  count: number;
  /** Whether the move would actually do anything; defaults to the plain list position. */
  canUp?: boolean;
  canDown?: boolean;
}

function accHeaderHtml(o: AccHeaderOptions): string {
  return `<div class="acc-header-row">
      <button type="button" class="acc-expand-btn" data-action="toggle-expand" aria-label="Expand" title="Expand / collapse">
        <span class="chevron" aria-hidden="true">▶</span>
      </button>
      <button type="button" class="btn-visibility${o.on ? "" : " is-off"}" data-action="toggle-dot" title="${o.dotTitle}" aria-label="${o.dotTitle}">${o.on ? "◉" : "○"}</button>
      <input type="text" class="acc-title-input" data-field="name" value="${escapeAttr(o.name)}" placeholder="${escapeAttr(o.placeholder)}" />
      ${o.extra ?? ""}
      <button type="button" class="acc-icon-btn acc-move" data-action="move-up" title="Move up (Shift: to top)" aria-label="Move up"${(o.canUp ?? o.index > 0) ? "" : " disabled"}>▲</button>
      <button type="button" class="acc-icon-btn acc-move" data-action="move-down" title="Move down (Shift: to bottom)" aria-label="Move down"${(o.canDown ?? o.index < o.count - 1) ? "" : " disabled"}>▼</button>
      <button type="button" class="acc-icon-btn acc-trash" data-action="delete" title="Delete" aria-label="Delete">
        <svg class="ui-icon" aria-hidden="true"><use href="#icon-trash" /></svg>
      </button>
    </div>`;
}

interface AccHandlers {
  onExpand: () => void;
  onDot: () => void;
  onDelete: () => void;
  onMove: (dir: number, toEnd: boolean) => void;
}

function wireAccRow(li: HTMLElement, h: AccHandlers): void {
  li.querySelector('[data-action="toggle-expand"]')!.addEventListener("click", h.onExpand);
  li.querySelector('[data-action="toggle-dot"]')!.addEventListener("click", (e) => {
    e.stopPropagation();
    h.onDot();
  });
  li.querySelector('[data-action="delete"]')!.addEventListener("click", h.onDelete);
  li.querySelector('[data-action="move-up"]')!.addEventListener("click", (e) =>
    h.onMove(-1, (e as MouseEvent).shiftKey)
  );
  li.querySelector('[data-action="move-down"]')!.addEventListener("click", (e) =>
    h.onMove(1, (e as MouseEvent).shiftKey)
  );
}

/** Writes a value into a row's field, unless the user is currently typing in it. */
function setField(li: HTMLElement, field: string, value: string | number): void {
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
function reorder(key: "elements" | "images", id: string, dir: number, toEnd: boolean): void {
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

/* ---------- Primitives list ---------- */

function primitiveListKeyOf(state: EditorState): string {
  const els = state.elements
    .map((e) => `${e.id}:${e.type}:${groupsOf(e).join("/")}:${"closed" in e && e.closed ? 1 : 0}`)
    .join(",");
  return `${els}|${state.selection.elementIds.join(",")}|${state.ui.expandedElementId}`;
}

function groupColor(gid: string): string {
  let h = 0;
  for (const ch of gid) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 60%)`;
}

function swatchHtml(kind: string, color: string, alpha: number, title: string): string {
  return `<button type="button" class="color-swatch" data-picker="${kind}" title="${title}" style="--c:${color};--a:${alpha}"><span class="color-swatch-fill"></span></button>`;
}

type Option = string | [string, string];

function selectHtml(field: string, value: string, options: readonly Option[]): string {
  const opts = options
    .map((o) => {
      const [v, label] = Array.isArray(o) ? o : [o, o];
      return `<option value="${v}"${v === value ? " selected" : ""}>${label}</option>`;
    })
    .join("");
  return `<select data-field="${field}">${opts}</select>`;
}

/**
 * Position and size, as numbers to type. Every shape reports the same four, measured from its
 * bounding box, so one set of fields works for a rect, an ellipse and a traced path alike -
 * and typing a number is the one way to be exact that a fingertip cannot manage.
 */
function geometryRowsHtml(el: SceneElement): string {
  const box = elementBBox(el);
  if (!box) return "";
  const field = (key: string, label: string, value: number, min?: number) =>
    `<label class="geom-field"><span>${label}</span><input type="number" data-field="${key}" step="1"${
      min == null ? "" : ` min="${min}"`
    } value="${Math.round(value * 100) / 100}" aria-label="${label}" /></label>`;
  const position = field("geomX", "X", box.x) + field("geomY", "Y", box.y);
  // Text has no width of its own - its size is the font size, which has its own field.
  const size =
    el.type === "text"
      ? ""
      : field("geomW", "W", box.width, 0) + field("geomH", "H", box.height, 0);
  // Only the shapes that store an angle get a field for it; on a path it is baked into points.
  const angle = keepsRotation(el)
    ? `<label class="geom-field geom-field--wide"><span>∠</span><input type="number" data-field="rotation" step="5" value="${Math.round(el.rotation ?? 0)}" aria-label="Rotation (degrees)" /></label>`
    : "";
  return `<div class="geom-grid">${position}${size}${angle}</div>`;
}

function primitiveBodyHtml(el: SceneElement): string {
  const rows: string[] = [geometryRowsHtml(el)];
  if (el.type === "text") {
    rows.push(
      `<div class="field-row"><span>Text</span><input type="text" data-field="text" value="${escapeAttr(el.text || "")}" /></div>`,
      `<div class="field-row"><span>Size</span><input type="number" data-field="fontSize" min="1" step="1" value="${el.fontSize || 48}" /></div>`,
      `<div class="field-row"><span>Font</span>${selectHtml("fontFamily", el.fontFamily || "sans-serif", ["sans-serif", "serif", "monospace", "cursive"])}</div>`,
      `<div class="field-row"><span>Align</span>${selectHtml("anchor", el.anchor || "start", [
        ["start", "left"],
        ["middle", "center"],
        ["end", "right"],
      ])}</div>`
    );
  }
  rows.push(
    `<div class="field-row"><span>Stroke</span>${swatchHtml("stroke", el.stroke, el.strokeOpacity ?? 1, "Stroke color and opacity")}</div>`
  );
  if (el.type !== "line") {
    rows.push(
      `<div class="field-row"><label class="fill-toggle"><input type="checkbox" data-field="fillEnabled"${el.fillEnabled ? " checked" : ""} /> Fill</label>${swatchHtml("fill", el.fill ?? "#000000", el.fillOpacity ?? 1, "Fill color and opacity")}</div>`,
      `<div class="field-row"><span>Fill type</span>${selectHtml(
        "fillType",
        el.fillType || "solid",
        [
          ["solid", "Solid"],
          ["linear", "Linear Gradient"],
          ["radial", "Radial Gradient"],
        ]
      )}</div>`,
      gradientStopsHtml(el)
    );
  }
  if (canToggleClosed(el)) {
    rows.push(
      `<div class="field-row"><label class="fill-toggle"><input type="checkbox" data-field="closed"${isClosedShape(el) ? " checked" : ""} /> Closed</label></div>`
    );
  }
  rows.push(
    `<div class="field-row"><span>Width</span><input type="number" data-field="strokeWidth" min="0" step="0.5" value="${el.strokeWidth}" /></div>`,
    `<div class="field-row"><span>Line cap</span>${selectHtml("linecap", el.linecap, ["round", "butt", "square"])}</div>`,
    `<div class="field-row"><span>Line join</span>${selectHtml("linejoin", el.linejoin, ["round", "miter", "bevel"])}</div>`
  );
  if (el.type === "rect") {
    rows.push(
      `<div class="field-row"><span>Corner X</span><input type="number" data-field="rx" min="0" step="1" value="${Math.round(el.rx || 0)}" /></div>`,
      `<div class="field-row"><span>Corner Y</span><input type="number" data-field="ry" min="0" step="1" value="${Math.round(el.ry ?? el.rx ?? 0)}" /></div>`
    );
  }
  if (MARKER_TYPES.includes(el.type)) {
    rows.push(
      `<div class="field-row"><span>Start</span>${selectHtml("markerStart", el.markerStart || "none", MARKER_SHAPES)}</div>`,
      `<div class="field-row"><span>End</span>${selectHtml("markerEnd", el.markerEnd || "none", MARKER_SHAPES)}</div>`
    );
  }
  return rows.join("");
}

/**
 * The gradient's stops, one row each: colour, where it sits along the gradient, and a way to
 * remove it. Where the gradient *runs* is not here - that is the two handles on the canvas,
 * which beat typing an angle on a touch screen and can express more than an angle could.
 */
function gradientStopsHtml(el: SceneElement): string {
  const stops = gradientStops(el);
  const rows = stops
    .map(
      (stop, i) =>
        `<div class="grad-stop">
          ${swatchHtml(`stop-${i}`, stop.color, stop.opacity, `Stop ${i + 1} colour and opacity`)}
          <input type="number" data-field="stopOffset" data-stop="${i}" min="0" max="100" step="1"
            value="${Math.round(stop.offset * 100)}" aria-label="Stop ${i + 1} position (%)" />
          <span class="grad-stop-unit">%</span>
          <button type="button" class="grad-stop-del" data-stop-remove="${i}" title="Remove stop"
            aria-label="Remove stop ${i + 1}"${stops.length > 2 ? "" : " disabled"}>×</button>
        </div>`
    )
    .join("");
  return `<div class="field-row grad-only grad-stops-row"><span>Stops</span>
      <div class="grad-stops">${rows}
        <button type="button" class="grad-stop-add" data-stop-add title="Add a stop">+ Stop</button>
      </div>
    </div>`;
}

function isInvisible(el: SceneElement): boolean {
  return el.strokeWidth === 0 && !el.fillEnabled;
}

function rgba(hex: string, a: number | undefined): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a ?? 1})`;
}

/** Circle in the row header: border = stroke color, inside = fill (transparent when none). */
function headerSwatchStyle(el: SceneElement): string {
  const border =
    el.strokeWidth === 0 ? "rgba(255,255,255,0.25)" : rgba(el.stroke, el.strokeOpacity);
  let inside = "transparent";
  if (el.fillEnabled) {
    if (el.fillType === "solid") {
      inside = rgba(el.fill, el.fillOpacity);
    } else {
      const stops = gradientStops(el)
        .map((s) => `${rgba(s.color, s.opacity)} ${Math.round(s.offset * 100)}%`)
        .join(", ");
      const angle =
        (Math.atan2(el.gradTo.y - el.gradFrom.y, el.gradTo.x - el.gradFrom.x) * 180) / Math.PI;
      inside =
        el.fillType === "radial"
          ? `radial-gradient(${stops})`
          : `linear-gradient(${Math.round(angle) + 90}deg, ${stops})`;
    }
  }
  return `border-color:${border};background:${inside}`;
}

function buildPrimitiveList(state: EditorState): void {
  primitiveListEl.innerHTML = "";
  if (!state.elements.length) {
    const li = document.createElement("li");
    li.className = "primitive-empty muted";
    li.textContent = "No primitives yet";
    primitiveListEl.appendChild(li);
    return;
  }
  const selected = new Set(state.selection.elementIds);
  state.elements.forEach((el, index) => {
    const isSelected = selected.has(el.id);
    const li = document.createElement("li");
    li.className = `acc-item${state.ui.expandedElementId === el.id ? " expanded" : ""}`;
    li.dataset.elementId = el.id;
    li.innerHTML = `
      ${accHeaderHtml({
        on: isSelected,
        dotTitle: isSelected ? "Deselect" : "Select",
        name: el.name || "",
        placeholder: el.type,
        extra: `<span class="acc-swatch" style="${headerSwatchStyle(el)}"></span>`,
        canUp: canMoveWithinParent(state.elements, el.id, -1),
        canDown: canMoveWithinParent(state.elements, el.id, 1),
        index,
        count: state.elements.length,
      })}
      <div class="acc-body">${primitiveBodyHtml(el)}</div>
    `;
    li.dataset.filltype = el.fillType || "solid";
    li.classList.toggle("acc-item--invisible", isInvisible(el));
    if (isInvisible(el)) {
      const sw = li.querySelector<HTMLElement>(".acc-swatch");
      if (sw) sw.title = "Invisible: no stroke and no fill";
    }
    const gid = innerGroup(el);
    if (gid) {
      li.classList.add("acc-item--grouped");
      li.style.setProperty("--gc", groupColor(gid));
      // One indent step per level of nesting, so the list reads as the tree it is.
      li.style.setProperty("--depth", String(groupsOf(el).length));
    }
    wireAccRow(li, {
      onExpand: () => toggleElementExpanded(el.id),
      onDot: () => toggleElementSelected(el.id),
      onDelete: () => deletePrimitive(el.id),
      onMove: (dir, toEnd) => reorder("elements", el.id, dir, toEnd),
    });
    primitiveListEl.appendChild(li);
  });
}

function updatePrimitiveListValues(state: EditorState): void {
  for (const el of state.elements) {
    const li = primitiveListEl.querySelector<HTMLElement>(`[data-element-id="${el.id}"]`);
    if (!li) continue;
    setField(li, "name", el.name || "");
    const swatch = li.querySelector<HTMLElement>(".acc-swatch");
    if (swatch) swatch.style.cssText = headerSwatchStyle(el);
    li.classList.toggle("acc-item--invisible", isInvisible(el));
    li.dataset.filltype = el.fillType || "solid";
    if (!li.classList.contains("expanded")) continue;
    const setSwatch = (kind: string, color: string, alpha: number) => {
      const btn = li.querySelector<HTMLElement>(`[data-picker="${kind}"]`);
      if (!btn) return;
      btn.style.setProperty("--c", color);
      btn.style.setProperty("--a", String(alpha));
    };
    setSwatch("stroke", el.stroke, el.strokeOpacity ?? 1);
    setSwatch("fill", el.fill ?? "#000000", el.fillOpacity ?? 1);
    gradientStops(el).forEach((stop, i) => {
      setSwatch(`stop-${i}`, stop.color, stop.opacity);
      const input = li.querySelector<HTMLInputElement>(
        `[data-field="stopOffset"][data-stop="${i}"]`
      );
      if (input && input !== document.activeElement)
        input.value = String(Math.round(stop.offset * 100));
    });
    if (el.type === "text") {
      setField(li, "text", el.text ?? "");
      setField(li, "fontSize", el.fontSize ?? 48);
      setField(li, "fontFamily", el.fontFamily ?? "sans-serif");
      setField(li, "anchor", el.anchor ?? "start");
    }
    const box = elementBBox(el);
    if (box) {
      const round = (n: number) => Math.round(n * 100) / 100;
      setField(li, "geomX", round(box.x));
      setField(li, "geomY", round(box.y));
      setField(li, "geomW", round(box.width));
      setField(li, "geomH", round(box.height));
      setField(li, "rotation", Math.round(el.rotation ?? 0));
    }
    setField(li, "strokeWidth", el.strokeWidth);
    setField(li, "linecap", el.linecap);
    setField(li, "linejoin", el.linejoin);
    setField(li, "fillType", el.fillType ?? "solid");
    if (el.type === "rect") {
      setField(li, "rx", Math.round(el.rx || 0));
      setField(li, "ry", Math.round(el.ry ?? el.rx ?? 0));
    }
    setField(li, "markerStart", el.markerStart || "none");
    setField(li, "markerEnd", el.markerEnd || "none");
    const fillCheckbox = li.querySelector<HTMLInputElement>('[data-field="fillEnabled"]');
    if (fillCheckbox && fillCheckbox !== document.activeElement) {
      fillCheckbox.checked = !!el.fillEnabled;
    }
  }
}

const primitiveList = cachedList(primitiveListKeyOf, buildPrimitiveList, updatePrimitiveListValues);

function toggleElementExpanded(id: string): void {
  setState((s) => ({
    ...s,
    ui: { ...s.ui, expandedElementId: s.ui.expandedElementId === id ? null : id },
  }));
}

function toggleElementSelected(id: string): void {
  setState((s) => {
    const ids = s.selection.elementIds;
    return {
      ...s,
      selection: selectOnly(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
      tool: "select",
    };
  });
}

function deletePrimitive(id: string): void {
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.filter((e) => e.id !== id),
    selection: selectOnly(s.selection.elementIds.filter((x) => x !== id)),
    ui: {
      ...s.ui,
      expandedElementId: s.ui.expandedElementId === id ? null : s.ui.expandedElementId,
    },
  }));
}

const GEOMETRY_FIELDS = ["geomX", "geomY", "geomW", "geomH"];

/**
 * Moves or scales a shape to put one edge of its bounding box at a typed value. Scaling runs
 * through the same matrix code that bakes imported transforms, so every shape type behaves.
 */
function applyGeometryField(id: string, field: string, value: number): void {
  const el = findElement(id);
  const box = el ? elementBBox(el) : null;
  if (!el || !box) return;
  if (field === "geomX" || field === "geomY") {
    const dx = field === "geomX" ? value - box.x : 0;
    const dy = field === "geomY" ? value - box.y : 0;
    if (!dx && !dy) return;
    pushUndo();
    mutate(() => {
      const target = findElement(id);
      if (target) translateElement(target, dx, dy);
    });
    return;
  }
  const horizontal = field === "geomW";
  const from = horizontal ? box.width : box.height;
  // A shape with no extent in that direction (a horizontal line, say) cannot be scaled into one.
  if (from <= 0 || value <= 0 || value === from) return;
  const factor = value / from;
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.map((x) =>
      x.id === id
        ? transformElement(
            x,
            horizontal ? scaleAbout(factor, 1, box.x, box.y) : scaleAbout(1, factor, box.x, box.y)
          )
        : x
    ),
  }));
  primitiveList.invalidate();
}

function applyToElement(id: string, fn: (el: SceneElement) => void): void {
  if (!findElement(id)) return;
  pushUndo();
  mutate(() => {
    const el = findElement(id);
    if (el) fn(el);
  });
}

const NUMERIC_FIELDS: Record<string, (v: number) => number> = {
  strokeWidth: (v) => Math.max(0, v),
  fontSize: (v) => Math.max(1, v),
  rx: (v) => Math.max(0, v),
  ry: (v) => Math.max(0, v),
  rotation: (v) => ((v % 360) + 360) % 360,
};

// Fields that update the shape (and the SVG panel) live while typing; one undo step per session.
const LIVE_TEXT = ["text", "name"];
const LIVE_NUMBER = ["fontSize", "strokeWidth", "rx", "ry"];
const WRAPPING_ANGLES = ["rotation"];

let textUndoPushed = false;

primitiveListEl.addEventListener("focusin", () => {
  textUndoPushed = false;
});

primitiveListEl.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  const field = input.dataset?.field;
  if (!field) return;

  // Spinner arrows (no inputType) wrap the angle around instead of running past 0/360.
  if (!(e as InputEvent).inputType && WRAPPING_ANGLES.includes(field)) {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) input.value = String(((v % 360) + 360) % 360);
    return;
  }

  if (!LIVE_TEXT.includes(field) && !LIVE_NUMBER.includes(field)) return;
  const li = input.closest<HTMLElement>("[data-element-id]");
  const el = li?.dataset.elementId ? findElement(li.dataset.elementId) : undefined;
  if (!el) return;
  let value: string | number = input.value;
  if (LIVE_NUMBER.includes(field)) {
    const v = parseFloat(input.value);
    if (Number.isNaN(v)) return;
    value = NUMERIC_FIELDS[field]!(v);
  }
  const target = el as unknown as Record<string, unknown>;
  if (target[field] === value) return;
  if (!textUndoPushed) {
    pushUndo();
    textUndoPushed = true;
  }
  mutate(() => {
    target[field] = value;
  });
});

primitiveListEl.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const field = input.dataset?.field;
  if (!field || field === "text") return;
  const li = input.closest<HTMLElement>("[data-element-id]");
  const id = li?.dataset.elementId;
  if (!id) return;
  const current = findElement(id);
  if (LIVE_TEXT.includes(field) || LIVE_NUMBER.includes(field)) {
    const v = LIVE_NUMBER.includes(field)
      ? NUMERIC_FIELDS[field]!(parseFloat(input.value))
      : input.value.trim();
    if (current && (current as unknown as Record<string, unknown>)[field] === v) return;
  }
  if (field === "fillEnabled") {
    applyToElement(id, (el) => {
      el.fillEnabled = input.checked;
    });
  } else if (field === "closed") {
    setElementClosed(id, input.checked);
    primitiveList.invalidate();
  } else if (field === "fillType") {
    applyToElement(id, (el) => {
      el.fillType = input.value as SceneElement["fillType"];
      if (input.value !== "solid") el.fillEnabled = true;
    });
  } else if (field === "stopOffset") {
    const percent = parseFloat(input.value);
    if (Number.isNaN(percent)) return;
    const index = parseInt(input.dataset.stop ?? "0", 10);
    applyToElement(id, (el) => {
      const stops = gradientStops(el);
      const stop = stops[index];
      if (stop) stop.offset = Math.min(1, Math.max(0, percent / 100));
      el.gradStops = stops;
    });
    primitiveList.invalidate();
  } else if (GEOMETRY_FIELDS.includes(field)) {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) applyGeometryField(id, field, v);
  } else if (field in NUMERIC_FIELDS) {
    const v = parseFloat(input.value);
    if (Number.isNaN(v)) return;
    applyToElement(id, (el) => {
      (el as unknown as Record<string, unknown>)[field] = NUMERIC_FIELDS[field]!(v);
    });
  } else if (field === "name") {
    applyToElement(id, (el) => {
      el.name = input.value.trim();
    });
  } else {
    // Plain string selects: linecap, linejoin, markers, font family, anchor.
    applyToElement(id, (el) => {
      (el as unknown as Record<string, unknown>)[field] = input.value;
    });
  }
});

const PICKER_FIELDS: Record<string, [string, string]> = {
  stroke: ["stroke", "strokeOpacity"],
  fill: ["fill", "fillOpacity"],
};

/** Writes a colour into a gradient stop, or into one of the plain colour fields. */
function writeColor(el: SceneElement, kind: string, hex: string, alpha: number): void {
  const stopIndex = kind.startsWith("stop-") ? parseInt(kind.slice(5), 10) : -1;
  if (stopIndex >= 0) {
    const stops = gradientStops(el);
    const stop = stops[stopIndex];
    if (!stop) return;
    stop.color = hex;
    stop.opacity = alpha;
    el.gradStops = stops;
    // The first stop is also the solid colour, so turning the gradient off keeps something.
    if (stopIndex === 0) {
      el.fill = hex;
      el.fillOpacity = alpha;
    }
    el.fillEnabled = true;
    return;
  }
  const keys = PICKER_FIELDS[kind];
  if (!keys) return;
  const target = el as unknown as Record<string, unknown>;
  target[keys[0]] = hex;
  target[keys[1]] = alpha;
  if (kind !== "stroke") el.fillEnabled = true;
}

/** The colour and alpha a swatch currently shows. */
function readColor(el: SceneElement, kind: string): { color: string; alpha: number } {
  if (kind.startsWith("stop-")) {
    const stop = gradientStops(el)[parseInt(kind.slice(5), 10)];
    return { color: stop?.color ?? "#000000", alpha: stop?.opacity ?? 1 };
  }
  const keys = PICKER_FIELDS[kind];
  const src = el as unknown as Record<string, unknown>;
  return {
    color: keys ? ((src[keys[0]] as string) ?? "#000000") : "#000000",
    alpha: keys ? ((src[keys[1]] as number) ?? 1) : 1,
  };
}

primitiveListEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-picker]");
  if (!btn) return;
  if (isColorPickerOpenFor(btn)) {
    closeColorPicker();
    return;
  }
  const id = btn.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
  const kind = btn.dataset.picker;
  const el = id ? findElement(id) : undefined;
  if (!id || !kind || !el) return;
  if (!kind.startsWith("stop-") && !PICKER_FIELDS[kind]) return;
  const start = readColor(el, kind);
  let pushed = false;
  pickerHold = true;
  setSvgFocus({ id, field: kind.startsWith("stop-") ? "fill" : kind });
  openColorPicker({
    anchor: btn,
    onClose: () => {
      pickerHold = false;
      if (!primitiveListEl.contains(document.activeElement)) setSvgFocus(null);
    },
    color: start.color,
    alpha: start.alpha,
    onChange: (hex, alpha) => {
      const cur = findElement(id);
      if (!cur) return;
      if (!pushed) {
        pushUndo();
        pushed = true;
      }
      mutate(() => writeColor(cur, kind, hex, alpha));
    },
  });
});

/* Adding, moving and removing gradient stops. */
primitiveListEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const add = target.closest<HTMLElement>("[data-stop-add]");
  const remove = target.closest<HTMLElement>("[data-stop-remove]");
  if (!add && !remove) return;
  const id = target.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
  if (!id) return;
  applyToElement(id, (el) => {
    const stops = gradientStops(el);
    if (add) {
      // A new stop lands midway between the last two, taking a blend of their colours.
      const a = stops[stops.length - 2]!;
      const b = stops[stops.length - 1]!;
      stops.splice(stops.length - 1, 0, {
        offset: (a.offset + b.offset) / 2,
        color: b.color,
        opacity: (a.opacity + b.opacity) / 2,
      });
    } else if (stops.length > 2) {
      stops.splice(parseInt(remove!.dataset.stopRemove ?? "0", 10), 1);
    }
    el.gradStops = stops;
  });
  primitiveList.invalidate();
});

/* ---------- Reference images list ---------- */

function imageListKeyOf(state: EditorState): string {
  const meta = state.images.map((i) => `${i.id}:${i.name}:${i.visible}`).join(",");
  return `${meta}|${state.ui.expandedImageId}`;
}

function imageBodyHtml(img: ReferenceImage): string {
  return `<div class="acc-body">
      <label class="field-row">
        <span>File</span>
        <button type="button" class="file-chip" data-action="replace-file" title="Click to replace the source image">${escapeXml(img.fileName || img.name)}</button>
      </label>
      <label class="field-row"><span>X</span><input type="number" data-field="x" step="1" value="${img.x}" /></label>
      <label class="field-row"><span>Y</span><input type="number" data-field="y" step="1" value="${img.y}" /></label>
      <label class="field-row"><span>Scale</span><input type="number" data-field="scale" min="0.01" step="0.01" value="${img.scaleX}" /></label>
      <label class="field-row"><span>Rotation°</span><input type="number" data-field="rotation" step="1" value="${img.rotation}" /></label>
      <label class="field-row"><span>Opacity</span><input type="number" data-field="opacity" min="0" max="1" step="0.05" value="${img.opacity}" /></label>
    </div>`;
}

function buildImageList(state: EditorState): void {
  imageListEl.innerHTML = "";
  state.images.forEach((img, index) => {
    const visible = img.visible !== false;
    const li = document.createElement("li");
    li.className = `acc-item${state.ui.expandedImageId === img.id ? " expanded" : ""}${visible ? "" : " acc-item--hidden"}`;
    li.dataset.imageId = img.id;
    li.innerHTML =
      accHeaderHtml({
        on: visible,
        dotTitle: visible ? "Hide overlay" : "Show overlay",
        name: img.name,
        placeholder: "Untitled",
        index,
        count: state.images.length,
      }) + imageBodyHtml(img);
    wireAccRow(li, {
      onExpand: () => toggleImageExpanded(img.id),
      onDot: () => toggleImageVisible(img.id),
      onDelete: () => deleteImage(img.id),
      onMove: (dir, toEnd) => reorder("images", img.id, dir, toEnd),
    });
    li.querySelector('[data-action="replace-file"]')!.addEventListener("click", () => {
      replaceImageTargetId = img.id;
      byId<HTMLInputElement>("input-image-replace").click();
    });
    imageListEl.appendChild(li);
  });
}

function updateImageListValues(state: EditorState): void {
  for (const img of state.images) {
    const li = imageListEl.querySelector<HTMLElement>(`[data-image-id="${img.id}"]`);
    if (!li) continue;
    setField(li, "name", img.name);
    const fileChip = li.querySelector<HTMLElement>(".file-chip");
    if (fileChip) fileChip.textContent = img.fileName || img.name;
    if (!li.classList.contains("expanded")) continue;
    setField(li, "x", img.x);
    setField(li, "y", img.y);
    setField(li, "scale", img.scaleX);
    setField(li, "rotation", img.rotation);
    setField(li, "opacity", img.opacity);
  }
}

const imageList = cachedList(imageListKeyOf, buildImageList, updateImageListValues);

function toggleImageVisible(id: string): void {
  pushUndo();
  setState((s) => ({
    ...s,
    images: s.images.map((img) =>
      img.id === id ? { ...img, visible: !(img.visible !== false) } : img
    ),
  }));
}

function toggleImageExpanded(id: string): void {
  setState((s) => ({
    ...s,
    ui: { ...s.ui, expandedImageId: s.ui.expandedImageId === id ? null : id },
    selection: selectOnly(),
  }));
}

function deleteImage(id: string): void {
  pushUndo();
  setState((s) => ({
    ...s,
    images: s.images.filter((i) => i.id !== id),
    ui: { ...s.ui, expandedImageId: s.ui.expandedImageId === id ? null : s.ui.expandedImageId },
  }));
}

imageListEl.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (!(input instanceof HTMLInputElement) || !input.dataset.field) return;
  const li = input.closest<HTMLElement>("[data-image-id]");
  const imgId = li?.dataset.imageId;
  if (!imgId) return;
  const field = input.dataset.field;
  pushUndo();
  setState((s) => ({
    ...s,
    images: s.images.map((img) => {
      if (img.id !== imgId) return img;
      if (field === "name") return { ...img, name: input.value.trim() || img.name };
      const val = parseFloat(input.value);
      if (field === "scale") return { ...img, scaleX: val, scaleY: val };
      return { ...img, [field]: val };
    }),
  }));
});

/* ---------- Narrow layout: tools move to a bar under the canvas ---------- */
const NARROW = "(max-width: 760px)";
const narrowQuery = window.matchMedia(NARROW);
const toolGroup = byId("tool-group-tools");

/** The tools are one element, moved between the top bar and the bottom bar - never duplicated. */
function placeTools(): void {
  const home = narrowQuery.matches ? byId("tool-bar") : byId("tool-slot");
  if (toolGroup.parentElement !== home) home.appendChild(toolGroup);
}
placeTools();
narrowQuery.addEventListener("change", () => {
  placeTools();
  closeViewMenu();
  layoutPanels();
});

/* The grid and view controls collapse behind one button when the bar has no room. */
const viewWrap = byId("menu-view-wrap");
const viewBtn = byId("btn-view-menu");

function closeViewMenu(): void {
  viewWrap.classList.remove("open");
  viewBtn.setAttribute("aria-expanded", "false");
}

viewBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = !viewWrap.classList.contains("open");
  viewWrap.classList.toggle("open", open);
  viewBtn.setAttribute("aria-expanded", String(open));
});
document.addEventListener("pointerdown", (e) => {
  if (!viewWrap.contains(e.target as Node)) closeViewMenu();
});

/* ---------- Document panel: docked left, full height, toggled by its button ---------- */
const docPanel = byId("menu-document");
const docBtn = byId("menu-document-btn");
const helpPanel = byId("help-panel");
const helpBtn = byId("btn-help");

function layoutPanels(): void {
  const top = bySelector<HTMLElement>(".top-bar").getBoundingClientRect().bottom;
  docPanel.style.top = `${top}px`;
  helpPanel.style.top = `${top}px`;
  setRulerOffset(docPanel.classList.contains("hidden") ? 0 : docPanel.offsetWidth);
  renderRulers(getState());
}

function setDocPanelVisible(visible: boolean): void {
  docPanel.classList.toggle("hidden", !visible);
  docBtn.setAttribute("aria-expanded", String(visible));
  layoutPanels();
}

docBtn.addEventListener("click", () => setDocPanelVisible(docPanel.classList.contains("hidden")));
window.addEventListener("resize", layoutPanels);

helpBtn.addEventListener("click", () => {
  const show = helpPanel.classList.contains("hidden");
  helpPanel.classList.toggle("hidden", !show);
  helpBtn.setAttribute("aria-expanded", String(show));
  // Help now lives in the view menu, which has no business staying open over it.
  closeViewMenu();
  layoutPanels();
});

/* Collapsible sections (remembered). */
const SECTIONS_KEY = "vector-tracer.sections";
const sectionOpen: Record<string, boolean> = {
  documents: true,
  images: false,
  svg: true,
  primitives: true,
};
try {
  Object.assign(sectionOpen, JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}"));
} catch {
  /* defaults */
}

function applySections(): void {
  docPanel.querySelectorAll<HTMLElement>(".doc-section").forEach((sec) => {
    sec.classList.toggle("collapsed", !sectionOpen[sec.dataset.section ?? ""]);
  });
}

function setSectionOpen(key: string, open: boolean): void {
  sectionOpen[key] = open;
  applySections();
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionOpen));
  } catch {
    /* not remembered */
  }
}

docPanel.querySelectorAll<HTMLElement>(".doc-toggle").forEach((btn) => {
  const key = btn.closest<HTMLElement>(".doc-section")?.dataset.section;
  if (key) btn.addEventListener("click", () => setSectionOpen(key, !sectionOpen[key]));
});
applySections();

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

function doUndo(): void {
  if (undo()) invalidateLists();
}
function doRedo(): void {
  if (redo()) invalidateLists();
}
byId("btn-undo").addEventListener("click", doUndo);
byId("btn-redo").addEventListener("click", doRedo);

byId("btn-join").addEventListener("click", () => joinSelected());
byId("btn-group").addEventListener("click", () => groupSelection());
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

/* ---------- Reference image files ---------- */

byId("btn-add-image").addEventListener("click", () => {
  byId<HTMLInputElement>("input-image").click();
});

byId("input-image").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  for (const file of files) await addImageFile(file);
});

let replaceImageTargetId: string | null = null;

byId("input-image-replace").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const targetId = replaceImageTargetId;
  replaceImageTargetId = null;
  if (!file || !targetId) return;
  const dataUrl = await readFileAsDataURL(file);
  const { naturalWidth, naturalHeight } = await loadImageDimensions(dataUrl);
  pushUndo();
  setState((s) => ({
    ...s,
    images: s.images.map((img) =>
      img.id === targetId
        ? { ...img, dataUrl, fileName: file.name, naturalWidth, naturalHeight }
        : img
    ),
  }));
});

function loadImageDimensions(
  dataUrl: string
): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve) => {
    const imageEl = new Image();
    imageEl.onload = () =>
      resolve({ naturalWidth: imageEl.naturalWidth, naturalHeight: imageEl.naturalHeight });
    imageEl.onerror = () => resolve({ naturalWidth: 0, naturalHeight: 0 });
    imageEl.src = dataUrl;
  });
}

async function addImageFile(file: File): Promise<void> {
  const dataUrl = await readFileAsDataURL(file);
  const img = createImage(dataUrl, file.name);
  Object.assign(img, await loadImageDimensions(dataUrl));
  pushUndo();
  setSectionOpen("images", true);
  setState((s) => ({
    ...s,
    images: [...s.images, img],
    ui: { ...s.ui, expandedImageId: img.id },
    selection: selectOnly(),
  }));
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function hydrateImageDimensions(images: ReferenceImage[]): Promise<void> {
  for (const img of images) {
    const dims = await loadImageDimensions(img.dataUrl);
    mutate(() => Object.assign(img, dims));
  }
}

wrap.addEventListener("dragover", (e) => e.preventDefault());
wrap.addEventListener("drop", async (e) => {
  e.preventDefault();
  const files = [...((e as DragEvent).dataTransfer?.files ?? [])].filter((f) =>
    f.type.startsWith("image/")
  );
  for (const file of files) await addImageFile(file);
});

/* ---------- Toolbar ---------- */

function bindNumber(id: string, apply: (v: number) => void): void {
  byId(id).addEventListener("change", (e) => {
    pushUndo();
    apply(parseFloat((e.target as HTMLInputElement).value));
  });
}

bindNumber("artboard-width", (v) =>
  setState((s) => ({ ...s, artboard: { ...s.artboard, width: v } }))
);
bindNumber("artboard-height", (v) =>
  setState((s) => ({ ...s, artboard: { ...s.artboard, height: v } }))
);
bindNumber("grid-step", (v) => setState((s) => ({ ...s, grid: { ...s.grid, step: v } })));

byId("btn-grid").addEventListener("click", () => {
  setState((s) => ({ ...s, grid: { ...s.grid, visible: !s.grid.visible } }));
});
function setGridSnap(on: boolean): void {
  setState((s) => ({ ...s, grid: { ...s.grid, snap: on } }));
}
byId("btn-snap").addEventListener("click", () => setGridSnap(!getState().grid.snap));
byId("btn-final").addEventListener("click", () => {
  setState((s) => ({ ...s, finalOnly: !s.finalOnly }));
});

/** Zoom buttons work on the middle of the canvas, the way the wheel works on the cursor. */
function zoomByStep(factor: number): void {
  const rect = svg.getBoundingClientRect();
  setState({ viewport: zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor) });
}
byId("btn-zoom-in").addEventListener("click", () => zoomByStep(1.25));
byId("btn-zoom-out").addEventListener("click", () => zoomByStep(1 / 1.25));

byId("btn-fit-view").addEventListener("click", () => {
  setState({ viewport: fitArtboardInView() });
});
byId("btn-reset-zoom").addEventListener("click", () => {
  const rect = svg.getBoundingClientRect();
  setState((s) => ({
    ...s,
    viewport: {
      panX: (rect.width - s.artboard.width) / 2,
      panY: (rect.height - s.artboard.height) / 2,
      zoom: 1,
    },
  }));
});

byId("btn-save-svg").addEventListener("click", () => {
  downloadText("document.svg", formatExportSvg(getState(), true), "image/svg+xml");
});
byId("btn-copy-svg").addEventListener("click", async (e) => {
  e.stopPropagation();
  const text = formatExportSvg(getState(), true);
  const btn = byId("btn-copy-svg");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    downloadText("document.svg", text, "image/svg+xml");
    return;
  }
  btn.classList.add("copied");
  setTimeout(() => btn.classList.remove("copied"), 1000);
});
byId("btn-import-svg").addEventListener("click", () => {
  byId<HTMLInputElement>("input-import-svg").click();
});

byId("input-import-svg").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const { artboard, elements } = importSvgFile(await file.text());
  pushUndo();
  setState((s) => ({
    ...s,
    elements: [...s.elements, ...elements],
    artboard: artboard ?? s.artboard,
  }));
  primitiveList.invalidate();
});

/* ---------- Keyboard ---------- */

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  const isToggle = t.matches?.("input[type=checkbox], input[type=radio], input[type=range]");
  // Only real text entry swallows shortcuts; a focused checkbox or button must not.
  if (t.matches?.("textarea, select") || (t.matches?.("input") && !isToggle)) return;
  if (isToggle && e.code === "Space") return;
  const key = e.key.toLowerCase();
  if (e.code === "Space") {
    e.preventDefault();
    setState({ spacePan: true });
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (key === "z") {
      e.preventDefault();
      doUndo();
    }
    if (key === "y") {
      e.preventDefault();
      doRedo();
    }
    if (key === "s") {
      e.preventDefault();
      if (e.shiftKey) byId("btn-save-svg").click();
      else void saveNow();
    }
    if (key === "d") {
      e.preventDefault();
      duplicateSelection();
    }
    if (key === "a") {
      e.preventDefault();
      setState((s) => ({
        ...s,
        selection: selectOnly(s.elements.map((el) => el.id)),
        tool: "select",
      }));
    }
    if (key === "g") {
      e.preventDefault();
      if (e.shiftKey) ungroupSelection();
      else groupSelection();
    }
    if (key === "[") {
      e.preventDefault();
      moveZOrder("back");
    }
    if (key === "]") {
      e.preventDefault();
      moveZOrder("forward");
    }
    return;
  }
  if (key === "s") setTool("select");
  if (key === "p") setTool("pen");
  if (key === "r") setTool("rect");
  if (key === "e") setTool("ellipse");
  if (key === "a" && !e.ctrlKey && !e.metaKey) setTool("arc");
  if (key === "t") setTool("text");
  if (key === "g") setGridSnap(!getState().grid.snap);
  if (key === "escape") {
    if (isTextEditing()) endTextEdit(false);
    else cancelOperation();
  }
  if (key === "enter" && getState().tool === "pen") {
    pushUndo();
    finishPath();
  }
  if (key === "x") splitAtSelectedPoint();
  if (key === "j") joinSelected();
  if (key === "delete" || key === "backspace") {
    e.preventDefault();
    deleteSelection();
  }
  const nudge: Record<string, [number, number]> = {
    arrowleft: [-1, 0],
    arrowright: [1, 0],
    arrowup: [0, -1],
    arrowdown: [0, 1],
  };
  const dir = nudge[key];
  if (dir) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    nudgeSelection(dir[0] * step, dir[1] * step);
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") setState({ spacePan: false });
});

renderAll(getState());
setState({ viewport: fitArtboardInView() });

/* ---------- Documents: autosaved to browser storage, macOS-style ---------- */
const LAST_DOC_KEY = "vector-tracer.lastDoc";
const docDirtyEl = byId("doc-dirty");
const docListEl = byId("doc-list");
let currentDoc: { id: string | null; name: string } = { id: null, name: "" };
let docsCache: DocumentMeta[] = [];
let changeSeq = 0;
let savedSeq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pointerDown = false;
let saveChain: Promise<void> = Promise.resolve();

function updateStatus(): void {
  docDirtyEl.classList.toggle("hidden", changeSeq === savedSeq);
}

function noteChange(): void {
  changeSeq += 1;
  updateStatus();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 900);
}

function storageError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  window.alert(`Could not access browser storage: ${message}`);
}

function uniqueName(base: string): string {
  const names = new Set(docsCache.map((d) => d.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Writes the open document to storage. The deep clone keeps IndexedDB off the live state. */
function storeCurrent(): Promise<void> {
  if (!currentDoc.id) return Promise.resolve();
  return saveDocument({
    id: currentDoc.id,
    name: currentDoc.name,
    data: deepClone(serializeProject(getState())),
  });
}

async function refreshDocList(): Promise<void> {
  try {
    docsCache = await listDocuments();
  } catch (err) {
    storageError(err);
    docsCache = [];
  }
  const active = document.activeElement as HTMLInputElement | null;
  // Don't rebuild the list under a name that is being edited.
  if (active?.classList?.contains("doc-title-input")) {
    const docId = active.closest<HTMLElement>("[data-doc-id]")?.dataset.docId;
    const stored = docsCache.find((d) => d.id === docId)?.name;
    if (active.value !== stored) return;
  }
  docListEl.innerHTML = "";
  for (const d of docsCache) {
    const isCurrent = d.id === currentDoc.id;
    const li = document.createElement("li");
    li.dataset.docId = d.id;
    li.className = isCurrent ? "current" : "";
    const when = new Date(d.updated).toLocaleString([], {
      dateStyle: "short",
      timeStyle: "short",
    });
    li.innerHTML = `<div class="doc-item" data-doc-open title="${isCurrent ? "Click the name to rename" : "Open"}">
        <input type="text" class="doc-title-input" value="${escapeAttr(d.name)}" maxlength="80" aria-label="Document name"${isCurrent ? "" : ' readonly tabindex="-1"'} />
        <small>${when}</small>
      </div>
      <button type="button" class="doc-act" data-doc-dup title="Duplicate" aria-label="Duplicate document">⧉</button>
      <button type="button" class="doc-del" data-doc-delete title="Delete" aria-label="Delete document">×</button>`;
    docListEl.appendChild(li);
  }
}

function rememberLast(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_DOC_KEY, id);
    else localStorage.removeItem(LAST_DOC_KEY);
  } catch {
    /* not remembered */
  }
}

function flushSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  if (pointerDown) {
    saveTimer = setTimeout(() => void flushSave(), 400);
    return saveChain;
  }
  saveChain = saveChain.then(async () => {
    if (changeSeq === savedSeq || !currentDoc.id) return;
    const seq = changeSeq;
    try {
      await storeCurrent();
    } catch (err) {
      storageError(err);
      return;
    }
    savedSeq = seq;
    updateStatus();
    await refreshDocList();
  });
  return saveChain;
}

function saveNow(): Promise<void> {
  noteChange();
  return flushSave();
}

function afterDocumentReplaced(): void {
  void hydrateImageDimensions(getState().images);
  clearHistory();
  invalidateLists();
  savedSeq = changeSeq;
  updateStatus();
}

/** Creates and stores a fresh, named, empty document and switches to it. */
async function createBlankDocument(): Promise<void> {
  try {
    docsCache = await listDocuments();
  } catch (err) {
    storageError(err);
  }
  replaceState(createInitialState());
  setState({ viewport: fitArtboardInView() });
  currentDoc = { id: uid("doc"), name: uniqueName("Untitled") };
  afterDocumentReplaced();
  try {
    await storeCurrent();
  } catch (err) {
    storageError(err);
  }
  rememberLast(currentDoc.id);
  await refreshDocList();
}

function focusCurrentDocName(): void {
  const input = docListEl.querySelector<HTMLInputElement>(".current .doc-title-input");
  input?.scrollIntoView({ block: "nearest" });
  input?.focus();
  input?.select();
}

async function newDocument(): Promise<void> {
  await flushSave();
  setSectionOpen("documents", true);
  const st = getState();
  // If the open document is still empty there is no need for another one.
  if (!(currentDoc.id && !st.elements.length && !st.images.length)) await createBlankDocument();
  focusCurrentDocName();
}

async function openDocument(id: string): Promise<void> {
  if (id === currentDoc.id) return;
  await flushSave();
  let data: ProjectFile | null;
  try {
    data = await loadDocument(id);
  } catch (err) {
    storageError(err);
    return;
  }
  if (!data) return;
  loadProject(data);
  currentDoc = { id, name: docsCache.find((d) => d.id === id)?.name ?? "" };
  rememberLast(id);
  afterDocumentReplaced();
  await refreshDocList();
}

async function renameCurrent(raw: string): Promise<void> {
  const name = raw.trim();
  if (!name || name === currentDoc.name || !currentDoc.id) return;
  await flushSave();
  currentDoc.name = name;
  try {
    await renameDocument(currentDoc.id, name);
  } catch (err) {
    storageError(err);
  }
}

byId("btn-new-doc").addEventListener("click", () => void newDocument());

// Inline rename of the open document's name.
docListEl.addEventListener("keydown", (e) => {
  const target = e.target as HTMLInputElement;
  if (!target.classList?.contains("doc-title-input")) return;
  if (e.key === "Enter") target.blur();
  if (e.key === "Escape") {
    target.value = currentDoc.name;
    target.blur();
  }
});
docListEl.addEventListener("change", async (e) => {
  const target = e.target as HTMLInputElement;
  if (!target.classList?.contains("doc-title-input")) return;
  if (!target.value.trim()) target.value = currentDoc.name;
  else await renameCurrent(target.value);
  await refreshDocList();
});

async function duplicateDoc(id: string): Promise<void> {
  if (id === currentDoc.id) await flushSave();
  const name = uniqueName(`${docsCache.find((d) => d.id === id)?.name ?? "Untitled"} copy`);
  try {
    await duplicateDocument(id, uid("doc"), name);
  } catch (err) {
    storageError(err);
  }
  await refreshDocList();
}

/** Empty documents are removed without asking; anything with content needs a confirmation. */
async function confirmDelete(id: string): Promise<boolean> {
  const name = docsCache.find((d) => d.id === id)?.name ?? "this document";
  let empty: boolean;
  try {
    const st = getState();
    const data =
      id === currentDoc.id ? { elements: st.elements, images: st.images } : await loadDocument(id);
    empty = !!data && !(data.elements ?? []).length && !(data.images ?? []).length;
  } catch {
    empty = false;
  }
  return empty || window.confirm(`Delete "${name}"? This cannot be undone.`);
}

async function deleteDoc(id: string): Promise<void> {
  if (!(await confirmDelete(id))) return;
  const wasCurrent = id === currentDoc.id;
  if (wasCurrent) {
    if (saveTimer) clearTimeout(saveTimer);
    savedSeq = changeSeq;
    updateStatus();
  }
  try {
    await deleteDocument(id);
  } catch (err) {
    storageError(err);
    return;
  }
  if (!wasCurrent) {
    await refreshDocList();
    return;
  }
  currentDoc = { id: null, name: "" };
  await refreshDocList();
  const first = docsCache[0];
  if (first) await openDocument(first.id);
  else await createBlankDocument();
}

docListEl.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const li = target.closest<HTMLElement>("[data-doc-id]");
  const id = li?.dataset.docId;
  if (!id) return;
  if (target.closest("[data-doc-dup]")) await duplicateDoc(id);
  else if (target.closest("[data-doc-delete]")) await deleteDoc(id);
  else if (target.closest("[data-doc-open]") && id !== currentDoc.id) await openDocument(id);
});

/* ---------- Backup: the whole library in and out as one file ---------- */

const BACKUP_TAG = "vellum/library";

interface BackupFile {
  tag: typeof BACKUP_TAG;
  version: 1;
  exported: string;
  documents: { id: string; name: string; updated: number; data: ProjectFile }[];
}

byId("btn-backup-export").addEventListener("click", async () => {
  await flushSave();
  let documents;
  try {
    documents = await exportAllDocuments();
  } catch (err) {
    storageError(err);
    return;
  }
  if (!documents.length) {
    window.alert("There are no saved documents to back up yet.");
    return;
  }
  const backup: BackupFile = {
    tag: BACKUP_TAG,
    version: 1,
    exported: new Date().toISOString(),
    documents,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(`vellum-backup-${stamp}.json`, JSON.stringify(backup), "application/json");
});

byId("btn-backup-import").addEventListener("click", () => {
  byId<HTMLInputElement>("input-backup").click();
});

byId("input-backup").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  let backup: BackupFile;
  try {
    backup = JSON.parse(await file.text()) as BackupFile;
  } catch {
    window.alert("That file is not valid JSON.");
    return;
  }
  if (backup?.tag !== BACKUP_TAG || !Array.isArray(backup.documents)) {
    window.alert("That is not a Vellum backup file.");
    return;
  }
  const n = backup.documents.length;
  if (
    !window.confirm(
      `Restore ${n} document${n === 1 ? "" : "s"}? They are added alongside your existing ones.`
    )
  ) {
    return;
  }
  await flushSave();
  try {
    docsCache = await listDocuments();
    for (const doc of backup.documents) {
      // Restored documents always get fresh ids, so a restore never overwrites current work.
      await saveDocument({
        id: uid("doc"),
        name: uniqueName(doc.name || "Untitled"),
        data: doc.data,
      });
      docsCache = await listDocuments();
    }
  } catch (err) {
    storageError(err);
    return;
  }
  setSectionOpen("documents", true);
  await refreshDocList();
});

// Anything that changes the document schedules an autosave; saves wait until the pointer is up.
setHistoryListener(noteChange);
window.addEventListener("pointerdown", () => (pointerDown = true), true);
window.addEventListener(
  "pointerup",
  () => {
    pointerDown = false;
    if (changeSeq !== savedSeq) noteChange();
  },
  true
);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flushSave();
});
window.addEventListener("beforeunload", (e) => {
  if (changeSeq !== savedSeq) {
    void flushSave();
    e.preventDefault();
  }
});

void (async () => {
  await refreshDocList();
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_DOC_KEY);
  } catch {
    last = null;
  }
  if (last && docsCache.some((d) => d.id === last)) await openDocument(last);
  else await createBlankDocument();
})();

registerServiceWorker();
