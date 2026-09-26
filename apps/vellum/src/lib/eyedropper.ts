/**
 * Picking a colour from the reference images: what is traced is usually the colour it should be.
 *
 * The colour picker's dropper starts a pick; the next press on the canvas reads the pixel of the
 * topmost visible reference image under it - its own colour, not blended with the opacity it is
 * shown at - and ends the pick. Esc, or a press anywhere else, ends it with nothing picked.
 */

import { getState } from "./state.js";
import { screenToWorld } from "./viewport.js";
import type { Point, ReferenceImage } from "./types.js";

/** Each image drawn once onto a canvas of its own size, kept while its pixels stay the same. */
const canvases = new Map<string, { url: string; ctx: CanvasRenderingContext2D }>();

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

async function pixels(image: ReferenceImage): Promise<CanvasRenderingContext2D | null> {
  const cached = canvases.get(image.id);
  if (cached?.url === image.dataUrl) return cached.ctx;
  const img = await load(image.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  canvases.set(image.id, { url: image.dataUrl, ctx });
  return ctx;
}

/**
 * Where an artboard point falls in an image's own pixels: the image is drawn translated, turned
 * and scaled (`translate(x y) rotate(r) scale(sx sy)`), so this undoes those in reverse.
 */
export function toImagePixel(image: ReferenceImage, p: Point): Point {
  const dx = p.x - image.x;
  const dy = p.y - image.y;
  const a = (-image.rotation * Math.PI) / 180;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return { x: rx / (image.scaleX || 1), y: ry / (image.scaleY || 1) };
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** The colour of the topmost visible reference image at an artboard point, or null. */
export async function sampleImages(
  images: readonly ReferenceImage[],
  at: Point
): Promise<string | null> {
  for (const image of [...images].reverse()) {
    if (image.visible === false) continue;
    const q = toImagePixel(image, at);
    const w = image.naturalWidth ?? 0;
    const h = image.naturalHeight ?? 0;
    if (q.x < 0 || q.y < 0 || q.x >= w || q.y >= h) continue;
    const ctx = await pixels(image).catch(() => null);
    if (!ctx) continue;
    const [r, g, b, alpha] = ctx.getImageData(Math.floor(q.x), Math.floor(q.y), 1, 1).data;
    // A transparent pixel is not this image's colour there: look at the one underneath.
    if (!alpha) continue;
    return `#${hex2(r!)}${hex2(g!)}${hex2(b!)}`;
  }
  return null;
}

/** Whether there is anything to pick from. */
export function canPickFromImages(): boolean {
  return getState().images.some((img) => img.visible !== false && !!img.naturalWidth);
}

/**
 * Starts a pick: resolves with the colour under the next press on the canvas, or null when it is
 * cancelled. `wrap` is the canvas's container, which shows a crosshair while the pick is on.
 */
export function pickFromImages(wrap: HTMLElement, svg: SVGSVGElement): Promise<string | null> {
  return new Promise((resolve) => {
    wrap.classList.add("mode-pick");
    const finish = (value: string | null) => {
      wrap.classList.remove("mode-pick");
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onDown = (e: PointerEvent) => {
      // The press is the pick's, not the canvas's: nothing is selected or drawn by it.
      e.stopPropagation();
      e.preventDefault();
      if (!svg.contains(e.target as Node)) {
        finish(null);
        return;
      }
      const at = screenToWorld(e.clientX, e.clientY);
      void sampleImages(getState().images, at).then(finish);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      finish(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
  });
}
