/**
 * Exporting the drawing as a PNG, at a width you choose: an icon is often wanted at several
 * sizes, and a raster at the size it will be shown is sharper than one scaled down later.
 *
 * The picture is the exported SVG itself, drawn by the browser onto a canvas of that size - so it
 * shows exactly what the SVG does, transparent where the document is.
 */

import { byId, downloadBlob } from "@workbench/ui";

/** The pixel size for a width: the artboard's proportions, never less than one pixel. */
export function pngSize(
  artboard: { width: number; height: number },
  width: number
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round((w * artboard.height) / (artboard.width || 1)));
  return { width: w, height: h };
}

/** The largest side the export offers: well past any icon, and within what browsers can draw. */
export const MAX_PNG_SIDE = 8192;

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
  /** The artboard, for the proportions. */
  artboard: () => { width: number; height: number };
  /** The SVG to draw. */
  svg: () => string;
  /** The file name without its extension. */
  baseName: () => string;
}

/** Wires the Export PNG button and its dialog. */
export function initPngExport(deps: PngExportDeps): void {
  const dialog = byId<HTMLDialogElement>("png-dialog");
  const widthInput = byId<HTMLInputElement>("png-width");
  const heightOut = byId("png-height");
  const go = byId<HTMLButtonElement>("png-go");
  const error = byId("png-error");

  const show = () => {
    const w = parseFloat(widthInput.value);
    const ok = Number.isFinite(w) && w >= 1 && w <= MAX_PNG_SIDE;
    const { height } = pngSize(deps.artboard(), ok ? w : 1);
    heightOut.textContent = ok ? `× ${height} px` : "";
    go.disabled = !ok || height > MAX_PNG_SIDE;
    dialog.querySelectorAll<HTMLButtonElement>("[data-png-size]").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.pngSize) === w);
    });
  };

  byId("btn-export-png").addEventListener("click", () => {
    error.textContent = "";
    if (!widthInput.value) widthInput.value = String(Math.round(deps.artboard().width));
    show();
    dialog.showModal();
  });
  widthInput.addEventListener("input", show);
  dialog.addEventListener("click", (e) => {
    const preset = (e.target as HTMLElement).closest<HTMLElement>("[data-png-size]");
    if (!preset) return;
    widthInput.value = preset.dataset.pngSize ?? "";
    show();
  });
  go.addEventListener("click", async (e) => {
    e.preventDefault();
    const { width, height } = pngSize(deps.artboard(), parseFloat(widthInput.value));
    go.disabled = true;
    try {
      const blob = await renderPng(deps.svg(), width, height);
      downloadBlob(`${deps.baseName()}-${width}.png`, blob);
      dialog.close();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      go.disabled = false;
    }
  });
}
