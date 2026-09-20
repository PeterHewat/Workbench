import { getState } from "./state.js";
import type { Point, Viewport } from "./types.js";

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

export function fitArtboardInView(padding = 40): Viewport {
  const state = getState();
  const rect = svgEl.getBoundingClientRect();
  const aw = state.artboard.width;
  const ah = state.artboard.height;
  const zoom = Math.min((rect.width - padding * 2) / aw, (rect.height - padding * 2) / ah, 1.6);
  return {
    panX: (rect.width - aw * zoom) / 2,
    panY: (rect.height - ah * zoom) / 2,
    zoom: clampZoom(zoom),
  };
}
