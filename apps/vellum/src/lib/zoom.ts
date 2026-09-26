import { getState, selectedElements, setState } from "./state.js";
import { fitArtboardInView, fitBoxInView, zoomAt } from "./viewport.js";
import { unionBox } from "./selection-transform.js";
import { byId, bySelector } from "@workbench/ui";

/**
 * Zoom is one control: it says what the zoom is, and opens a list to set it.
 *
 * Three buttons - minus, 100%, plus - took three slots to do what one does, and on a phone that
 * was most of the reason the view controls had to hide behind a menu at all. The label follows
 * the viewport however it changed, so a pinch or a wheel is read back here too.
 */
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8];
const zoomWrap = byId("zoom-wrap");
export const zoomBtn = byId("btn-zoom-level");
export const zoomMenu = byId("zoom-menu");

zoomMenu.innerHTML =
  `<li role="option" aria-selected="false"><button type="button" data-fit="artboard" title="Shift+1">Fit artboard</button></li>` +
  `<li role="option" aria-selected="false"><button type="button" data-fit="selection" title="Shift+2">Fit selection</button></li>` +
  ZOOM_LEVELS.map(
    (z) =>
      `<li role="option" aria-selected="false"><button type="button" data-zoom="${z}">${Math.round(z * 100)}%</button></li>`
  ).join("");

function closeZoomMenu(): void {
  zoomMenu.classList.add("hidden");
  zoomBtn.setAttribute("aria-expanded", "false");
}

zoomBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = zoomMenu.classList.contains("hidden");
  zoomMenu.classList.toggle("hidden", !open);
  zoomBtn.setAttribute("aria-expanded", String(open));
});

zoomMenu.addEventListener("click", (e) => {
  const fit = (e.target as HTMLElement).closest<HTMLElement>("[data-fit]");
  if (fit) {
    if (fit.dataset.fit === "selection") fitSelection();
    else setState({ viewport: fitToView() });
    closeZoomMenu();
    return;
  }
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-zoom]");
  if (!target) return;
  zoomTo(Number(target.dataset.zoom));
  closeZoomMenu();
});

zoomBtn.addEventListener("click", () => {
  // Fitting the selection means something only with one.
  const fit = zoomMenu.querySelector<HTMLButtonElement>('[data-fit="selection"]');
  if (fit) fit.disabled = !selectedElements().length;
});

document.addEventListener("pointerdown", (e) => {
  if (!zoomWrap.contains(e.target as Node)) closeZoomMenu();
});

// Esc closes the open list, and only that: back on its button, not stepping out of a selection.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || zoomMenu.classList.contains("hidden")) return;
  e.stopPropagation();
  closeZoomMenu();
  zoomBtn.focus();
});

/* ---------- Fitting the view ---------- */

const svg = byId<HTMLElement>("viewport-svg") as unknown as SVGSVGElement;

/** The artboard as large as it fits in what the toolbars leave free. */
export function fitToView(): ReturnType<typeof fitArtboardInView> {
  return fitArtboardInView(40, viewInsets());
}

/** Shows the selection as large as it fits; nothing happens with nothing selected. */
export function fitSelection(): void {
  const box = unionBox(selectedElements());
  if (box) setState({ viewport: fitBoxInView(box, 40, viewInsets()) });
}

/** 100%, about the middle of the canvas. */
export function zoomToActualSize(): void {
  zoomTo(1);
}

/**
 * How much of the canvas the floating toolbars cover. On a phone they sit over it rather than
 * beside it, so anything that fits the view has to know where the free part actually is; on a
 * wider screen the bars are in the flow, the strips measure zero, and nothing changes.
 */
function viewInsets(): { top: number; bottom: number } {
  const rect = svg.getBoundingClientRect();
  const strip = (el: HTMLElement, edge: "top" | "bottom"): number => {
    // Not offsetParent: that is null for a fixed element, which is exactly the case here.
    if (!el.getClientRects().length) return 0;
    const r = el.getBoundingClientRect();
    const covered = edge === "top" ? r.bottom - rect.top : rect.bottom - r.top;
    return covered <= 0 ? 0 : Math.min(covered + 8, rect.height / 3);
  };
  return {
    top: strip(bySelector<HTMLElement>(".top-bar"), "top"),
    bottom: strip(byId("tool-bar"), "bottom"),
  };
}

/** Picking a level zooms about the middle of the canvas, the way the wheel works on the cursor. */
function zoomTo(level: number): void {
  const rect = svg.getBoundingClientRect();
  const factor = level / getState().viewport.zoom;
  setState({ viewport: zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor) });
}
