import { getState, setState, subscribe, selectOnly } from "./state.js";
import { initViewport } from "./viewport.js";
import { initRender, renderAll } from "./render.js";
import { bindInteraction, cancelOperation } from "./interaction.js";
import { setTool, finishPath, closeAndFinishPath, removeLastPenPoint } from "./pen-commands.js";
import {
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  moveZOrder,
  groupSelection,
  ungroupSelection,
  splitAtSelectedPoint,
  joinSelected,
  setElementClosed,
} from "./selection-commands.js";
import { pushUndo, canUndo, canRedo } from "./undo.js";
import { formatExportSvg, importSvgFile } from "./io.js";
import { canJoin } from "./model.js";
import { downloadText } from "./utils.js";
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
import { groupsOf, outerGroup } from "./groups.js";
import { type EditorState } from "./types.js";
import { restoreLayout } from "./layout.js";
import { zoomBtn, zoomMenu, fitToView } from "./zoom.js";
import { doUndo, doRedo } from "./edit-commands.js";
import { imageList } from "./images-panel.js";
import { primitiveList } from "./primitives-panel.js";
import { syncSvgEditor } from "./svg-source.js";
import { byId } from "./dom.js";
import { currentDoc, saveNow, startDocuments } from "./documents.js";

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

let lastSavedViewport: EditorState["viewport"] | null = null;

subscribe((state) => {
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
  const percent = `${Math.round(state.viewport.zoom * 100)}%`;
  if (zoomBtn.textContent !== percent) zoomBtn.textContent = percent;
  zoomMenu.querySelectorAll<HTMLElement>("[data-zoom]").forEach((btn) => {
    const on = Math.abs(Number(btn.dataset.zoom) - state.viewport.zoom) < 1e-6;
    btn.classList.toggle("active", on);
    btn.parentElement?.setAttribute("aria-selected", String(on));
  });

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
function setGridSnap(on: boolean): void {
  setState((s) => ({ ...s, grid: { ...s.grid, snap: on } }));
}
byId("btn-snap").addEventListener("click", () => setGridSnap(!getState().grid.snap));
byId("btn-final").addEventListener("click", () => {
  setState((s) => ({ ...s, finalOnly: !s.finalOnly }));
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
  const { artboard, background, elements } = importSvgFile(await file.text());
  pushUndo();
  setState((s) => ({
    ...s,
    elements: [...s.elements, ...elements],
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

restoreLayout();
renderAll(getState());
setState({ viewport: fitToView() });

startDocuments();
