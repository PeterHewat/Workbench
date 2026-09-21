import type { EditorState } from "./types.js";

const SIZE = 20;
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

interface RulerTargets {
  topCanvas: HTMLCanvasElement;
  leftCanvas: HTMLCanvasElement;
  cornerEl: HTMLElement;
  svg: SVGSVGElement;
}

let top: HTMLCanvasElement;
let left: HTMLCanvasElement;
let corner: HTMLElement;
let svgEl: SVGSVGElement;

export function initRulers(targets: RulerTargets): void {
  top = targets.topCanvas;
  left = targets.leftCanvas;
  corner = targets.cornerEl;
  svgEl = targets.svg;
}

function sizeCanvas(
  canvas: HTMLCanvasElement,
  w: number,
  h: number
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

function pickStep(zoom: number): number {
  return STEPS.find((s) => s * zoom >= 60) ?? STEPS[STEPS.length - 1]!;
}

function paintAxis(
  ctx: CanvasRenderingContext2D | null,
  length: number,
  pan: number,
  zoom: number,
  horizontal: boolean,
  cursorWorld: number | null
): void {
  if (!ctx) return;
  const step = pickStep(zoom);
  const minor = step / 5;
  ctx.fillStyle = "#25262b";
  ctx.fillRect(0, 0, horizontal ? length : SIZE, horizontal ? SIZE : length);
  ctx.strokeStyle = "#5a5f6c";
  ctx.fillStyle = "#9aa0ab";
  ctx.font = "10px system-ui, sans-serif";
  ctx.lineWidth = 1;
  const startWorld = Math.floor(-pan / zoom / minor) * minor;
  const endWorld = (length - pan) / zoom;
  ctx.beginPath();
  for (let w = startWorld; w <= endWorld; w += minor) {
    const p = Math.round(pan + w * zoom) + 0.5;
    const major = Math.abs(w / step - Math.round(w / step)) < 1e-6;
    const len = major ? SIZE : SIZE * 0.35;
    if (horizontal) {
      ctx.moveTo(p, SIZE);
      ctx.lineTo(p, SIZE - len);
    } else {
      ctx.moveTo(SIZE, p);
      ctx.lineTo(SIZE - len, p);
    }
  }
  ctx.stroke();
  for (let w = Math.ceil(startWorld / step) * step; w <= endWorld; w += step) {
    const p = pan + w * zoom;
    const label = String(Math.round(w));
    if (horizontal) {
      ctx.fillText(label, p + 3, 10);
    } else {
      ctx.save();
      ctx.translate(10, p - 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
  if (cursorWorld != null) {
    const p = Math.round(pan + cursorWorld * zoom) + 0.5;
    ctx.strokeStyle = "#5b8def";
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(p, 0);
      ctx.lineTo(p, SIZE);
    } else {
      ctx.moveTo(0, p);
      ctx.lineTo(SIZE, p);
    }
    ctx.stroke();
  }
}

let offsetX = 0;

/** Left edge (px) where the rulers start; moves right when the SVG panel covers the canvas. */
export function setRulerOffset(px: number): void {
  offsetX = Math.max(0, Math.round(px));
}

export function renderRulers(state: EditorState): void {
  const rect = svgEl.getBoundingClientRect();
  const { panX, panY, zoom } = state.viewport;
  const c = state.cursor;
  const x0 = offsetX + SIZE;
  const w = Math.max(0, rect.width - x0);
  const h = Math.max(0, rect.height - SIZE);
  corner.style.left = `${offsetX}px`;
  top.style.left = `${x0}px`;
  left.style.left = `${offsetX}px`;
  paintAxis(sizeCanvas(top, w, SIZE), w, panX - x0, zoom, true, c.x);
  paintAxis(sizeCanvas(left, SIZE, h), h, panY - SIZE, zoom, false, c.y);
}
