import { getState, setState } from "./state.js";
import { clampZoom, zoomAt } from "./viewport.js";
import { pushUndo } from "./undo.js";
import type { Point, Viewport } from "./types.js";

let onFinishPath: () => void = () => {};

export function setTouchFinishPathHandler(fn: () => void): void {
  onFinishPath = fn;
}

function touchDist(t0: Touch, t1: Touch): number {
  return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
}

function touchCenter(t0: Touch, t1: Touch): Point {
  return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
}

/**
 * Pinch-zoom, two-finger pan and double-tap to finish path (pen) on touch devices.
 * Drawing uses the same Pointer Events path as mouse.
 */
export function bindTouch(svg: SVGSVGElement): void {
  let pinchStartDist: number | null = null;
  let pinchStartZoom = 1;
  let lastCenter: Point | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  svg.addEventListener(
    "touchstart",
    (e) => {
      const [t0, t1] = [e.touches[0], e.touches[1]];
      if (e.touches.length === 2 && t0 && t1) {
        e.preventDefault();
        pinchStartDist = touchDist(t0, t1);
        pinchStartZoom = getState().viewport.zoom;
        lastCenter = touchCenter(t0, t1);
        svg.dispatchEvent(new Event("pinch-start"));
      }
    },
    { passive: false }
  );

  svg.addEventListener(
    "touchmove",
    (e) => {
      const [t0, t1] = [e.touches[0], e.touches[1]];
      if (e.touches.length !== 2 || pinchStartDist == null || !t0 || !t1) return;
      e.preventDefault();
      const center = touchCenter(t0, t1);
      const targetZoom = clampZoom(pinchStartZoom * (touchDist(t0, t1) / pinchStartDist));
      const current = getState().viewport.zoom;
      let viewport: Viewport = getState().viewport;
      if (Math.abs(targetZoom - current) > 0.0001) {
        viewport = zoomAt(center.x, center.y, targetZoom / current);
      }
      if (lastCenter) {
        viewport = {
          ...viewport,
          panX: viewport.panX + center.x - lastCenter.x,
          panY: viewport.panY + center.y - lastCenter.y,
        };
      }
      lastCenter = center;
      setState({ viewport });
    },
    { passive: false }
  );

  svg.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) pinchStartDist = null;

    const t = e.changedTouches[0];
    if (e.changedTouches.length !== 1 || !t) return;
    const st = getState();
    if (st.tool !== "pen" || !st.drawing?.activePathId) return;

    const now = Date.now();
    const tol = 24 / st.viewport.zoom;
    if (now - lastTap.t < 400 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < tol) {
      pushUndo();
      onFinishPath();
      lastTap = { t: 0, x: 0, y: 0 };
      return;
    }
    lastTap = { t: now, x: t.clientX, y: t.clientY };
  });
}
