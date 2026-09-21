import { getState, setState, findElement, selectOnly } from "./state.js";
import { importSvgFile } from "./io.js";
import { type SceneElement } from "./types.js";
import { commit } from "./ops.js";
import { expandGroups, deleteSelection, copyElements } from "./selection-commands.js";

const CLIP_TAG = "vellum/elements";

let pasteCount = 0;

/** Serializes the selection for the clipboard (whole groups included), or null. */
export function copySelectionText(): string | null {
  const els = expandGroups(getState().selection.elementIds)
    .map((id) => findElement(id))
    .filter((e): e is SceneElement => !!e);
  if (!els.length) return null;
  pasteCount = 0;
  return JSON.stringify({ tag: CLIP_TAG, elements: els });
}

export function cutSelection(): string | null {
  const text = copySelectionText();
  if (text) deleteSelection();
  return text;
}

/** Pastes clipboard text: our own JSON, or plain SVG markup. True if anything was added. */
export function pasteFromText(text: string): boolean {
  let elements: SceneElement[] | null = null;
  let fromSvg = false;
  try {
    const data: unknown = JSON.parse(text);
    if (
      data &&
      typeof data === "object" &&
      (data as { tag?: string }).tag === CLIP_TAG &&
      Array.isArray((data as { elements?: unknown }).elements)
    ) {
      elements = (data as { elements: SceneElement[] }).elements;
    }
  } catch {
    if (/^\s*<(\?xml|svg)/i.test(text || "")) {
      try {
        elements = importSvgFile(text).elements;
        fromSvg = true;
      } catch {
        elements = null;
      }
    }
  }
  if (!elements?.length) return false;
  const source = elements;
  pasteCount += 1;
  commit(() => {
    setState((s) => {
      // SVG markup lands where it says it does; our own copies step away from the original.
      const off = fromSvg ? 0 : Math.max(s.grid.step, 10) * pasteCount;
      const copies = copyElements(source, off);
      return {
        ...s,
        elements: [...s.elements, ...copies],
        selection: selectOnly(copies.map((c) => c.id)),
      };
    });
  });
  return true;
}
