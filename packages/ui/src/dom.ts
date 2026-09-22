/** Small DOM helpers the apps would otherwise each write for themselves. */

export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function bySelector<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

/** Saves a file to the user's downloads. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking in the same tick can cancel the download in Firefox and Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

/**
 * Copies text, and flashes `.copied` on the button that asked for it. False when the clipboard
 * refused (no permission, insecure context), so the caller can offer a download instead.
 */
export async function copyText(text: string, button?: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return false;
  }
  if (button) {
    button.classList.add("copied");
    setTimeout(() => button.classList.remove("copied"), 1000);
  }
  return true;
}

/** Opens the system file picker; resolves with the chosen files (empty when cancelled). */
export function pickFiles(accept = "", multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

/**
 * Accepts files dropped anywhere on `target`, marking it `.dragging` while something hovers.
 * Returns a function that removes the listeners.
 */
export function onFileDrop(target: HTMLElement, handle: (files: File[]) => void): () => void {
  let depth = 0;
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
  const enter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth += 1;
    target.classList.add("dragging");
  };
  const leave = () => {
    depth = Math.max(0, depth - 1);
    if (!depth) target.classList.remove("dragging");
  };
  const over = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };
  const drop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    target.classList.remove("dragging");
    handle([...(e.dataTransfer?.files ?? [])]);
  };
  target.addEventListener("dragenter", enter);
  target.addEventListener("dragleave", leave);
  target.addEventListener("dragover", over);
  target.addEventListener("drop", drop);
  return () => {
    target.removeEventListener("dragenter", enter);
    target.removeEventListener("dragleave", leave);
    target.removeEventListener("dragover", over);
    target.removeEventListener("drop", drop);
  };
}
