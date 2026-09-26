import { getState } from "./state.js";
import type { BBox, Point, Viewport } from "./types.js";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 16;

let svgEl: SVGSVGElement;
let cameraEl: SVGGElement;

export function initViewport(svg: SVGSVGElement, camera: SVGGElement): void {
  svgEl = svg;
  cameraEl = camera;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function applyCameraTransform(): void {
  const { viewport } = getState();
  cameraEl.setAttribute(
    "transform",
    `translate(${viewport.panX} ${viewport.panY}) scale(${viewport.zoom})`
  );
}

/** Client point -> the SVG root's own coordinate space. */
function toSvgRoot(clientX: number, clientY: number): Point {
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** Screen (client) point -> artboard / world coordinates. */
export function screenToWorld(clientX: number, clientY: number): Point {
  const root = toSvgRoot(clientX, clientY);
  const { panX, panY, zoom } = getState().viewport;
  return { x: (root.x - panX) / zoom, y: (root.y - panY) / zoom };
}

/** Artboard / world coordinates -> client (screen) coordinates. */
export function worldToScreen(x: number, y: number): Point {
  const { panX, panY, zoom } = getState().viewport;
  const pt = svgEl.createSVGPoint();
  pt.x = x * zoom + panX;
  pt.y = y * zoom + panY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: pt.x, y: pt.y };
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

/** Zoom around pointer; keeps the world point under the cursor fixed. */
export function zoomAt(clientX: number, clientY: number, factor: number): Viewport {
  const root = toSvgRoot(clientX, clientY);
  const { viewport } = getState();
  const wx = (root.x - viewport.panX) / viewport.zoom;
  const wy = (root.y - viewport.panY) / viewport.zoom;
  const zoom = clampZoom(viewport.zoom * factor);
  return { panX: root.x - wx * zoom, panY: root.y - wy * zoom, zoom };
}

/** Strips of the canvas covered by something floating over it, in screen pixels. */
interface ViewInsets {
  top?: number;
  bottom?: number;
}

/**
 * Fits the artboard in what you can actually see. On a phone the toolbars float over the canvas
 * rather than taking a strip of it, so "fit" has to leave their height out or the top and bottom
 * of the artboard land underneath them.
 */
export function fitArtboardInView(padding = 40, insets: ViewInsets = {}): Viewport {
  const { width, height } = getState().artboard;
  return fitBoxInView({ x: 0, y: 0, width, height }, padding, insets);
}

/**
 * The view that shows `box` as large as it fits, centred in what is free. A box with no extent
 * on one side - a flat line - is fitted by the other, and a single point keeps the zoom.
 */
export function fitBoxInView(box: BBox, padding = 40, insets: ViewInsets = {}): Viewport {
  const rect = svgEl.getBoundingClientRect();
  const top = insets.top ?? 0;
  const bottom = insets.bottom ?? 0;
  const usableH = Math.max(1, rect.height - top - bottom);
  const fits = [
    box.width > 0 ? (rect.width - padding * 2) / box.width : Infinity,
    box.height > 0 ? (usableH - padding * 2) / box.height : Infinity,
  ];
  // No cap of its own: "fit" means fill what is free, and clampZoom already has the last word.
  const want = Math.min(...fits);
  const zoom = clampZoom(Number.isFinite(want) ? want : getState().viewport.zoom);
  return {
    panX: rect.width / 2 - (box.x + box.width / 2) * zoom,
    panY: top + usableH / 2 - (box.y + box.height / 2) * zoom,
    zoom,
  };
}
