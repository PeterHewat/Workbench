import { getState, setState, subscribe, selectOnly } from "./state.js";
import { initViewport } from "./viewport.js";
import { initRender, renderAll, renderPointer } from "./render.js";
import { bindInteraction, cancelOperation } from "./interaction.js";
import {
  setTool,
  finishPath,
  closeAndFinishPath,
  removeLastPenPoint,
  discardPath,
} from "./pen-commands.js";
import { isAlignSnap, isSelectMore, setAlignSnap, setSelectMore } from "./modes.js";
import { pasteFromClipboard } from "./clipboard.js";
import {
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  moveZOrder,
  groupSelection,
  mergeSelection,
  ungroupSelection,
  splitAtSelectedPoint,
  joinSelected,
  setElementClosed,
  setSelectedHandlesLinked,
  toggleSelectedPointCurve,
  removeSelectedHandle,
  stepOutSelection,
  combineSelection,
} from "./selection-commands.js";
import { pushUndo, canUndo, canRedo } from "./undo.js";
import { formatExportSvg, importSvgFile } from "./io.js";
import { canJoin } from "./model.js";
import { THEME_EVENT, bindThemeToggle, byId, copyText, downloadText } from "@workbench/ui";
import { bindTouch, setTouchFinishPathHandler } from "./touch.js";
import { openColorPicker, closeColorPicker, isColorPickerOpenFor } from "./colorpicker.js";
import { initRulers, renderRulers } from "./rulers.js";
import { initActionBar, syncActionBar } from "./actionbar.js";
import {
  beginTextEdit,
  endTextEdit,
  initTextEdit,
  isTextEditing,
  positionTextEditor,
} from "./textedit.js";
import { initPointerKind } from "./pointer.js";
import { writeSessionView } from "./session.js";
import { canGroup, canMergeGroups, canUngroup } from "./groups.js";
import { type EditorState } from "./types.js";
import { restoreLayout } from "./layout.js";
import { zoomBtn, zoomMenu, fitToView } from "./zoom.js";
import { doUndo, doRedo } from "./edit-commands.js";
import { imageList } from "./images-panel.js";
import { primitiveList } from "./primitives-panel.js";
import { syncSvgEditor } from "./svg-source.js";
import { currentDoc, saveNow, startDocuments, svgFileName } from "./documents.js";

const svg = byId<HTMLElement>("viewport-svg") as unknown as SVGSVGElement;
const camera = byId<HTMLElement>("camera") as unknown as SVGGElement;
const wrap = byId("canvas-wrap");

initPointerKind(() => renderAll(getState()));
initViewport(svg, camera);
initRender({
  artboardChecks: byId<HTMLElement>("artboard-checks-rect") as unknown as SVGRectElement,
  artboardBg: byId<HTMLElement>("artboard-bg") as unknown as SVGRectElement,
  images: byId<HTMLElement>("layer-images") as unknown as SVGGElement,
  grid: byId<HTMLElement>("layer-grid") as unknown as SVGGElement,
  document: byId<HTMLElement>("layer-document") as unknown as SVGGElement,
  overlay: byId<HTMLElement>("layer-overlay") as unknown as SVGGElement,
  pointer: byId<HTMLElement>("layer-pointer") as unknown as SVGGElement,
});

initTextEdit(wrap, () => primitiveList.invalidate());
initActionBar(byId("action-bar"), {
  duplicate: () => duplicateSelection(),
  remove: () => deleteSelection(),
  removePoint: () => deleteSelection(false),
  combine: (op) => combineSelection(op),
  forward: () => moveZOrder("forward"),
  back: () => moveZOrder("back"),
  toggleClosed: (id, closed) => {
    setElementClosed(id, closed);
    primitiveList.invalidate();
  },
  group: () => groupSelection(),
  merge: () => mergeSelection(),
  ungroup: () => ungroupSelection(),
  splitPoint: () => splitAtSelectedPoint(),
  linkHandles: (linked) => setSelectedHandlesLinked(linked),
  togglePointCurve: () => toggleSelectedPointCurve(),
  removeHandle: () => removeSelectedHandle(),
  join: () => joinSelected(),
  editText: (id) => beginTextEdit(id),
  finishPath: () => {
    pushUndo();
    finishPath();
  },
  closeAndFinishPath: () => closeAndFinishPath(),
  undoPoint: () => removeLastPenPoint(),
  discardPath: () => discardPath(),
  selectMore: (on) => setSelectMore(on),
  selectAll: () => selectAll(),
  paste: () => void pasteFromClipboard(),
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
window.addEventListener(THEME_EVENT, () => renderRulers(getState()));
document
  .querySelectorAll<HTMLElement>("[data-theme-toggle]")
  .forEach((btn) => bindThemeToggle(btn, "ui-icon"));

let lastSavedViewport: EditorState["viewport"] | null = null;

subscribe((state, { pointerOnly }) => {
  if (pointerOnly) {
    renderPointer(state);
    renderRulers(state);
    syncCursorReadout(state);
    return;
  }
  // Adding to a selection that has gone empty is starting a new one: the switch lets go.
  if (isSelectMore() && !state.selection.elementIds.length) setSelectMore(false);
  // A document opened with grid snap on keeps it: the snap to shapes the tab had lets go.
  if (isAlignSnap() && state.grid.snap) setAlignSnap(false);
  renderAll(state);
  // Where you are looking belongs to the tab, not to the drawing: kept so a refresh returns it.
  if (state.viewport !== lastSavedViewport) {
    lastSavedViewport = state.viewport;
    writeSessionView({ docId: currentDoc.id, viewport: state.viewport });
  }
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

function syncCursorReadout(state: EditorState): void {
  const c = state.cursor;
  const x = c.snapActive ? c.snapX : c.x;
  const y = c.snapActive ? c.snapY : c.y;
  const text = `${Math.round(x)}, ${Math.round(y)}`;
  const readout = byId("cursor-pos");
  if (readout.textContent !== text) readout.textContent = text;
}

function syncPanel(state: EditorState): void {
  byId<HTMLInputElement>("artboard-width").value = String(state.artboard.width);
  byId<HTMLInputElement>("artboard-height").value = String(state.artboard.height);
  byId<HTMLInputElement>("grid-step").value = String(state.grid.step);
  const bgSwatch = byId("bg-swatch");
  bgSwatch.style.setProperty("--c", state.background.color);
  bgSwatch.style.setProperty("--a", String(state.background.opacity));
  setToggle("btn-grid", state.grid.visible);
  setToggle("btn-final", state.finalOnly);
  setToggle("btn-snap", state.grid.snap);
  setToggle("btn-align", isAlignSnap());
  const percent = `${Math.round(state.viewport.zoom * 100)}%`;
  if (zoomBtn.textContent !== percent) zoomBtn.textContent = percent;
  zoomMenu.querySelectorAll<HTMLElement>("[data-zoom]").forEach((btn) => {
    const on = Math.abs(Number(btn.dataset.zoom) - state.viewport.zoom) < 1e-6;
    btn.classList.toggle("active", on);
    btn.parentElement?.setAttribute("aria-selected", String(on));
  });

  syncCursorReadout(state);

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

/** Group / Merge / Ungroup / Join are only enabled when they would actually do something. */
function syncGroupButtons(state: EditorState): void {
  const ids = new Set(state.selection.elementIds);
  const sel = state.elements.filter((e) => ids.has(e.id));
  byId<HTMLButtonElement>("btn-group").disabled = !canGroup(state.elements, ids);
  byId<HTMLButtonElement>("btn-merge").disabled = !canMergeGroups(state.elements, ids);
  byId<HTMLButtonElement>("btn-ungroup").disabled = !canUngroup(state.elements, ids);
  byId<HTMLButtonElement>("btn-join").disabled = !(sel.length === 2 && sel.every(canJoin));
}

/* ---------- Toolbar ---------- */

/** Sizes and steps are whole, positive numbers; anything else puts the field back as it was. */
function bindNumber(id: string, apply: (v: number) => void): void {
  byId(id).addEventListener("change", (e) => {
    const v = Math.round(parseFloat((e.target as HTMLInputElement).value));
    if (!Number.isFinite(v) || v < 1) {
      syncPanel(getState());
      return;
    }
    pushUndo();
    apply(v);
  });
}

bindNumber("artboard-width", (v) =>
  setState((s) => ({ ...s, artboard: { ...s.artboard, width: v } }))
);
bindNumber("artboard-height", (v) =>
  setState((s) => ({ ...s, artboard: { ...s.artboard, height: v } }))
);
bindNumber("grid-step", (v) => setState((s) => ({ ...s, grid: { ...s.grid, step: v } })));

byId("bg-swatch").addEventListener("click", () => {
  const swatch = byId("bg-swatch");
  if (isColorPickerOpenFor(swatch)) {
    closeColorPicker();
    return;
  }
  const start = getState().background;
  let pushed = false;
  openColorPicker({
    anchor: swatch,
    color: start.color,
    alpha: start.opacity,
    onChange: (color, opacity) => {
      if (!pushed) {
        pushUndo();
        pushed = true;
      }
      setState((s) => ({ ...s, background: { color, opacity } }));
    },
  });
});

byId("btn-grid").addEventListener("click", () => {
  setState((s) => ({ ...s, grid: { ...s.grid, visible: !s.grid.visible } }));
});
/** Grid snap and snap to shapes are one choice: switching this on switches the other off. */
function setGridSnap(on: boolean): void {
  if (on) setAlignSnap(false);
  setState((s) => ({ ...s, grid: { ...s.grid, snap: on } }));
}
byId("btn-snap").addEventListener("click", () => setGridSnap(!getState().grid.snap));
byId("btn-align").addEventListener("click", () => setAlignSnap(!isAlignSnap()));

/** Every shape that is showing: hidden ones stay out of it, as they do out of a click. */
function selectAll(): void {
  setState((s) => ({
    ...s,
    selection: selectOnly(s.elements.filter((el) => !el.hidden).map((el) => el.id)),
    tool: "select",
  }));
}
byId("btn-final").addEventListener("click", () => {
  setState((s) => ({ ...s, finalOnly: !s.finalOnly }));
});

byId("btn-save-svg").addEventListener("click", () => {
  downloadText(svgFileName(), formatExportSvg(getState(), true), "image/svg+xml");
});
byId("btn-copy-svg").addEventListener("click", async (e) => {
  e.stopPropagation();
  const text = formatExportSvg(getState(), true);
  if (!(await copyText(text, byId("btn-copy-svg")))) {
    downloadText(svgFileName(), text, "image/svg+xml");
  }
});
byId("btn-import-svg").addEventListener("click", () => {
  byId<HTMLInputElement>("input-import-svg").click();
});

byId("input-import-svg").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  let imported: ReturnType<typeof importSvgFile>;
  try {
    imported = importSvgFile(await file.text());
  } catch (err) {
    window.alert(`Could not import ${file.name}: ${err instanceof Error ? err.message : err}`);
    return;
  }
  const { artboard, background, elements, groupNames } = imported;
  pushUndo();
  setState((s) => ({
    ...s,
    elements: [...s.elements, ...elements],
    groupNames: { ...s.groupNames, ...groupNames },
    artboard: artboard ?? s.artboard,
    background: background ?? s.background,
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
    // Ctrl+Y on Windows, Cmd+Shift+Z on a Mac; both work everywhere.
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
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
      selectAll();
    }
    // By code, not key: Option+G on a Mac types a character rather than "g".
    if (e.altKey && e.code === "KeyG") {
      e.preventDefault();
      mergeSelection();
    } else if (key === "g") {
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
  if (key === "t") setTool("text");
  if (key === "g") setGridSnap(!getState().grid.snap);
  if (key === "escape") {
    const st = getState();
    if (isTextEditing()) endTextEdit(false);
    else if (st.drawing || st.tool !== "select" || !stepOutSelection()) cancelOperation();
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

restoreLayout();
renderAll(getState());
setState({ viewport: fitToView() });

startDocuments();
