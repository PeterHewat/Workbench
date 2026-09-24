import { getState, setState, findElement, selectOnly } from "./state.js";
import { importSvgFile, isInert } from "./io.js";
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
  const gids = new Set(els.flatMap((e) => e.groups ?? []));
  const names = Object.entries(getState().groupNames).filter(([gid]) => gids.has(gid));
  return JSON.stringify({ tag: CLIP_TAG, elements: els, groupNames: Object.fromEntries(names) });
}

/**
 * What the bar's Copy put away, for its Paste. The system clipboard gets it too, so it reaches
 * other tabs, but reading that back needs a permission prompt on some phones, and the copy
 * made a moment ago in this tab should not have to ask for one.
 */
let copied: string | null = null;

/** Copy, as a button rather than Ctrl+C. */
export async function copyToClipboard(): Promise<void> {
  const text = copySelectionText();
  if (!text) return;
  copied = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* kept for this tab only */
  }
}

/** Paste, as a button: this tab's last copy, else whatever the system clipboard holds. */
export async function pasteFromClipboard(): Promise<void> {
  if (copied && pasteFromText(copied)) return;
  try {
    pasteFromText(await navigator.clipboard.readText());
  } catch {
    /* nothing readable */
  }
}

export function cutSelection(): string | null {
  const text = copySelectionText();
  if (text) deleteSelection();
  return text;
}

/** Pastes clipboard text: our own JSON, or plain SVG markup. True if anything was added. */
export function pasteFromText(text: string): boolean {
  let elements: SceneElement[] | null = null;
  let names: Record<string, string> = {};
  let fromSvg = false;
  try {
    const data: unknown = JSON.parse(text);
    if (
      data &&
      typeof data === "object" &&
      (data as { tag?: string }).tag === CLIP_TAG &&
      Array.isArray((data as { elements?: unknown }).elements) &&
      // The system clipboard can hold anything another page put there.
      isInert(data)
    ) {
      elements = (data as { elements: SceneElement[] }).elements;
      names = (data as { groupNames?: Record<string, string> }).groupNames ?? {};
    }
  } catch {
    if (/^\s*<(\?xml|svg)/i.test(text || "")) {
      try {
        ({ elements, groupNames: names } = importSvgFile(text));
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
      const { copies, groupNames } = copyElements(source, off, names);
      return {
        ...s,
        elements: [...s.elements, ...copies],
        groupNames: { ...s.groupNames, ...groupNames },
        selection: selectOnly(copies.map((c) => c.id)),
      };
    });
  });
  return true;
}
