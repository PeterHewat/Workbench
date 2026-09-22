import { setState, mutate, selectOnly } from "./state.js";
import { pushUndo } from "./undo.js";
import { createImage } from "./model.js";
import { escapeAttr, escapeXml } from "./utils.js";
import { type EditorState, type ReferenceImage } from "./types.js";
import { setSectionOpen } from "./layout.js";
import { cachedList, accHeaderHtml, wireAccRow, setField, reorder } from "./accordion.js";
import { byId } from "@workbench/ui";

const imageListEl = byId("image-list");

/* ---------- Reference images list ---------- */

function imageListKeyOf(state: EditorState): string {
  const meta = state.images.map((i) => `${i.id}:${i.fileName || i.name}:${i.visible}`).join(",");
  return `${meta}|${state.ui.expandedImageId}`;
}

function imageBodyHtml(img: ReferenceImage): string {
  return `<div class="acc-body">
      <label class="field-row"><span>X</span><input type="number" data-field="x" step="1" value="${img.x}" /></label>
      <label class="field-row"><span>Y</span><input type="number" data-field="y" step="1" value="${img.y}" /></label>
      <label class="field-row"><span>Scale</span><input type="number" data-field="scale" min="0.01" step="0.01" value="${img.scaleX}" /></label>
      <label class="field-row"><span>Rotation°</span><input type="number" data-field="rotation" step="1" value="${img.rotation}" /></label>
      <label class="field-row"><span>Opacity</span><input type="number" data-field="opacity" min="0" max="1" step="0.05" value="${img.opacity}" /></label>
    </div>`;
}

function buildImageList(state: EditorState): void {
  imageListEl.innerHTML = "";
  state.images.forEach((img, index) => {
    const visible = img.visible !== false;
    const li = document.createElement("li");
    li.className = `acc-item${state.ui.expandedImageId === img.id ? " expanded" : ""}${visible ? "" : " acc-item--hidden"}`;
    li.dataset.imageId = img.id;
    li.innerHTML =
      accHeaderHtml({
        eye: { visible, title: visible ? "Hide overlay" : "Show overlay" },
        // A reference image is the file it came from, so the row says which file and lets you
        // swap it. There is nothing to rename: a name of its own would only be a second,
        // less true label for the same thing.
        titleHtml: `<button type="button" class="file-chip acc-title-file" data-action="replace-file" title="${escapeAttr(img.fileName || img.name)} — click to trace a different file">${escapeXml(img.fileName || img.name)}</button>`,
        index,
        count: state.images.length,
      }) + imageBodyHtml(img);
    wireAccRow(li, {
      onExpand: () => toggleImageExpanded(img.id),
      onEye: () => toggleImageVisible(img.id),
      onDelete: () => deleteImage(img.id),
      onMove: (dir, toEnd) => reorder("images", img.id, dir, toEnd),
    });
    li.querySelector('[data-action="replace-file"]')!.addEventListener("click", () => {
      replaceImageTargetId = img.id;
      byId<HTMLInputElement>("input-image-replace").click();
    });
    imageListEl.appendChild(li);
  });
}

function updateImageListValues(state: EditorState): void {
  for (const img of state.images) {
    const li = imageListEl.querySelector<HTMLElement>(`[data-image-id="${img.id}"]`);
    if (!li) continue;
    const fileChip = li.querySelector<HTMLElement>(".file-chip");
    if (fileChip) fileChip.textContent = img.fileName || img.name;
    if (!li.classList.contains("expanded")) continue;
    setField(li, "x", img.x);
    setField(li, "y", img.y);
    setField(li, "scale", img.scaleX);
    setField(li, "rotation", img.rotation);
    setField(li, "opacity", img.opacity);
  }
}

export const imageList = cachedList(imageListKeyOf, buildImageList, updateImageListValues);

function toggleImageVisible(id: string): void {
  pushUndo();
  setState((s) => ({
    ...s,
    images: s.images.map((img) =>
      img.id === id ? { ...img, visible: !(img.visible !== false) } : img
    ),
  }));
}

function toggleImageExpanded(id: string): void {
  setState((s) => ({
    ...s,
    ui: { ...s.ui, expandedImageId: s.ui.expandedImageId === id ? null : id },
    selection: selectOnly(),
  }));
}

function deleteImage(id: string): void {
  pushUndo();
  setState((s) => ({
    ...s,
    images: s.images.filter((i) => i.id !== id),
    ui: { ...s.ui, expandedImageId: s.ui.expandedImageId === id ? null : s.ui.expandedImageId },
  }));
}

imageListEl.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (!(input instanceof HTMLInputElement) || !input.dataset.field) return;
  const li = input.closest<HTMLElement>("[data-image-id]");
  const imgId = li?.dataset.imageId;
  if (!imgId) return;
  const field = input.dataset.field;
  pushUndo();
  setState((s) => ({
    ...s,
    images: s.images.map((img) => {
      if (img.id !== imgId) return img;
      const val = parseFloat(input.value);
      if (field === "scale") return { ...img, scaleX: val, scaleY: val };
      return { ...img, [field]: val };
    }),
  }));
});

/* ---------- Reference image files ---------- */

let replaceImageTargetId: string | null = null;

byId("btn-add-image").addEventListener("click", () => {
  byId<HTMLInputElement>("input-image").click();
});

byId("input-image").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  for (const file of files) await addImageFile(file);
});

byId("input-image-replace").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const targetId = replaceImageTargetId;
  replaceImageTargetId = null;
  if (!file || !targetId) return;
  const dataUrl = await readFileAsDataURL(file);
  const { naturalWidth, naturalHeight } = await loadImageDimensions(dataUrl);
  pushUndo();
  setState((s) => ({
    ...s,
    images: s.images.map((img) =>
      img.id === targetId
        ? { ...img, dataUrl, fileName: file.name, naturalWidth, naturalHeight }
        : img
    ),
  }));
});

function loadImageDimensions(
  dataUrl: string
): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve) => {
    const imageEl = new Image();
    imageEl.onload = () =>
      resolve({ naturalWidth: imageEl.naturalWidth, naturalHeight: imageEl.naturalHeight });
    imageEl.onerror = () => resolve({ naturalWidth: 0, naturalHeight: 0 });
    imageEl.src = dataUrl;
  });
}

async function addImageFile(file: File): Promise<void> {
  const dataUrl = await readFileAsDataURL(file);
  const img = createImage(dataUrl, file.name);
  Object.assign(img, await loadImageDimensions(dataUrl));
  pushUndo();
  setSectionOpen("images", true);
  setState((s) => ({
    ...s,
    images: [...s.images, img],
    ui: { ...s.ui, expandedImageId: img.id },
    selection: selectOnly(),
  }));
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function hydrateImageDimensions(images: ReferenceImage[]): Promise<void> {
  for (const img of images) {
    const dims = await loadImageDimensions(img.dataUrl);
    mutate(() => Object.assign(img, dims));
  }
}

const wrap = byId("canvas-wrap");

wrap.addEventListener("dragover", (e) => e.preventDefault());
wrap.addEventListener("drop", async (e) => {
  e.preventDefault();
  const files = [...((e as DragEvent).dataTransfer?.files ?? [])].filter((f) =>
    f.type.startsWith("image/")
  );
  for (const file of files) await addImageFile(file);
});
