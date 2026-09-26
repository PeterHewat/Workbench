/**
 * Exporting the drawing as a PNG, at the artboard's own size: one pixel to a unit. Anything else -
 * an icon at several sizes - is a job for the SVG, or for a tool made to resize.
 *
 * The picture is the exported SVG itself, drawn by the browser onto a canvas of that size - so it
 * shows exactly what the SVG does, transparent where the document is.
 */

import { byId, downloadBlob } from "@workbench/ui";

/** The pixel size of the artboard: whole pixels, never less than one. */
export function pngSize(artboard: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(1, Math.round(artboard.width)),
    height: Math.max(1, Math.round(artboard.height)),
  };
}

/** Draws SVG markup onto a canvas of the given size and returns it as a PNG. */
export async function renderPng(svg: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The drawing could not be rendered."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw the picture.");
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("The PNG could not be made."))),
        "image/png"
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PngExportDeps {
  /** The artboard, for the size. */
  artboard: () => { width: number; height: number };
  /** The SVG to draw. */
  svg: () => string;
  /** The file name without its extension. */
  baseName: () => string;
}

/** Wires the Export PNG button: one press, one file. */
export function initPngExport(deps: PngExportDeps): void {
  const btn = byId<HTMLButtonElement>("btn-export-png");
  btn.addEventListener("click", async () => {
    const { width, height } = pngSize(deps.artboard());
    btn.disabled = true;
    try {
      downloadBlob(`${deps.baseName()}.png`, await renderPng(deps.svg(), width, height));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
    }
  });
}
