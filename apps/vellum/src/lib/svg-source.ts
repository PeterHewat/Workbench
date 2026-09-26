import { getState, setState, findElement, selectOnly } from "./state.js";
import { pushUndo } from "./undo.js";
import {
  elementToSvgMarkup,
  buildDefsMarkup,
  sanitizeName,
  elementIdFromSvgId,
  groupIdFromSvgId,
  formatExportSvg,
  importSvgFile,
} from "./io.js";
import { escapeXml } from "./utils.js";
import { groupsOf, selectedGroups } from "./groups.js";
import { type EditorState, type SceneElement } from "./types.js";
import { byId } from "@workbench/ui";
import { noteChange } from "./documents.js";

/* ---------- SVG source: editable, highlighted, synced with the selection ---------- */
const svgInput = byId<HTMLTextAreaElement>("svg-input");
const svgPre = byId("svg-preview");
const svgError = byId("svg-error");
const primitiveListEl = byId("primitive-list");
let svgEditUndoPushed = false;
let svgApplyTimer: ReturnType<typeof setTimeout> | null = null;
let lastSelectionKey = "";
/** What the highlighted copy was last built from; see `refreshSvgHighlight`. */
let highlightKey = "";

// Primitive-row field that has keyboard focus -> the SVG attribute(s) it edits.
const FIELD_ATTRS: Record<string, string[]> = {
  stroke: ["stroke", "stroke-opacity"],
  strokeWidth: ["stroke-width", "stroke"],
  linecap: ["stroke-linecap"],
  linejoin: ["stroke-linejoin"],
  fill: ["fill", "fill-opacity"],
  fillEnabled: ["fill", "fill-opacity"],
  fillType: ["fill"],
  fillRule: ["fill-rule"],
  stopOffset: [],
  rx: ["rx", "ry"],
  ry: ["rx", "ry"],
  fontSize: ["font-size"],
  fontFamily: ["font-family"],
  anchor: ["text-anchor"],
  rotation: ["transform"],
  markerStart: ["marker-start"],
  markerEnd: ["marker-end"],
  name: ["id"],
  closed: ["d", "points"],
};
// Fields whose values live in a <defs> block: id prefix (and suffix) of that block.
const FIELD_BLOCKS: Record<string, [string, string?]> = {
  fillType: ["grad-"],
  fill: ["grad-"],
  stopOffset: ["grad-"],
  markerStart: ["mk-", "-start"],
  markerEnd: ["mk-", "-end"],
};
let svgFocus: { id: string; field: string } | null = null;

function highlightAttrs(esc: string, field: string): string {
  let out = esc;
  for (const attr of FIELD_ATTRS[field] ?? []) {
    out = out.replace(
      new RegExp(`(\\s)(${attr}="[^"]*")`, "g"),
      '$1<span class="svg-attr-focus">$2</span>'
    );
  }
  if (field === "text") {
    out = out.replace(/(&gt;)([^<]*)(&lt;\/text)/, '$1<span class="svg-attr-focus">$2</span>$3');
  }
  return out;
}

/** Colored copy of the textarea's text: selected shapes blue, the focused attribute highlighted. */
function refreshSvgHighlight(selectedIds: readonly string[]): void {
  // The copy is rebuilt only when what it shows changed: on a drag, the text changes every frame
  // but on a pointer move or a click elsewhere it rarely does, and a rebuild re-lays the panel.
  const key = `${svgInput.value}\0${selectedIds.join(",")}\0${svgFocus?.id}:${svgFocus?.field}`;
  if (key === highlightKey) {
    svgPre.scrollTop = svgInput.scrollTop;
    return;
  }
  highlightKey = key;
  const sel = new Set(selectedIds);
  // A group counts as selected when all of it is; its <g> and its </g> are highlighted then.
  const groups = selectedGroups(getState().elements, sel);
  // One entry per <g> still open, saying whether its </g> should be highlighted too.
  const open: boolean[] = [];
  const focus = svgFocus;
  const block = focus ? FIELD_BLOCKS[focus.field] : undefined;
  let inBlock = false;
  svgPre.innerHTML = svgInput.value
    .split("\n")
    .map((line) => {
      let esc = escapeXml(line);
      const m = line.match(/\bid="([^"]+)"/);
      const svgId = m ? m[1]! : "";
      const elId = m ? elementIdFromSvgId(svgId) : null;
      if (focus && elId === focus.id) esc = highlightAttrs(esc, focus.field);
      let selected = !!elId && sel.has(elId);
      if (/^\s*<g[\s>]/.test(line) && !/\/>\s*$/.test(line)) {
        const gid = groupIdFromSvgId(svgId);
        selected = !!gid && groups.has(gid);
        open.push(selected);
      } else if (/^\s*<\/g>/.test(line)) {
        selected = open.pop() ?? false;
      }
      let out = selected ? `<span class="svg-line svg-line--selected">${esc}</span>` : esc;
      if (block && focus) {
        if (svgId.startsWith(block[0] + focus.id) && (!block[1] || svgId.endsWith(block[1]))) {
          inBlock = true;
        }
        if (inBlock) out = `<span class="svg-attr-focus">${escapeXml(line)}</span>`;
        if (inBlock && /<\/(linearGradient|radialGradient|marker)>/.test(line)) inBlock = false;
      }
      return out;
    })
    .join("\n");
  svgPre.scrollTop = svgInput.scrollTop;
}

export function setSvgFocus(next: { id: string; field: string } | null): void {
  const same = svgFocus?.id === next?.id && svgFocus?.field === next?.field;
  svgFocus = next;
  if (same) return;
  refreshSvgHighlight(getState().selection.elementIds);
  if (next && document.activeElement !== svgInput) {
    const hit = svgPre.querySelector<HTMLElement>(".svg-attr-focus");
    if (hit) {
      svgInput.scrollTop = Math.max(0, hit.offsetTop - 60);
      svgPre.scrollTop = svgInput.scrollTop;
    }
  }
}

function fieldOf(target: EventTarget | null): { id: string; field: string } | null {
  const el = target as HTMLElement | null;
  const li = el?.closest<HTMLElement>("[data-element-id]");
  if (!li || !primitiveListEl.contains(li)) return null;
  const field = el?.closest<HTMLElement>("[data-picker]")?.dataset.picker ?? el?.dataset.field;
  const id = li.dataset.elementId;
  return field && id ? { id, field } : null;
}

primitiveListEl.addEventListener("focusin", (e) => setSvgFocus(fieldOf(e.target)));
let pickerHold = false; // the color popover steals focus but its swatch stays "in use"

/** Called while the colour popover is open, which takes focus without the swatch leaving use. */
export function holdSvgFocus(hold: boolean): void {
  pickerHold = hold;
}
primitiveListEl.addEventListener("focusout", () => {
  if (!pickerHold) setSvgFocus(null);
});

/**
 * How often, at most, the panel follows a stream of changes. Keeping it current means exporting
 * the whole document, which on a large one is most of the cost of each frame of a drag; a few
 * updates a second read as live, and the last change always lands.
 */
const SYNC_INTERVAL_MS = 120;
let lastSyncAt = -Infinity;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
/** Changes were skipped while the panel was not on screen. */
let stale = false;

function onScreen(): boolean {
  return typeof svgInput.checkVisibility === "function" ? svgInput.checkVisibility() : true;
}

// Opening the section or the panel lays the field out again, and that is when it catches up.
new ResizeObserver(() => {
  if (stale && onScreen()) syncSvgEditorNow(getState());
}).observe(svgInput);

/** Keeps the panel in step with the document: at once when it can, soon after when it cannot. */
export function syncSvgEditor(state: EditorState): void {
  if (!onScreen()) {
    stale = true;
    return;
  }
  const wait = lastSyncAt + SYNC_INTERVAL_MS - performance.now();
  if (wait <= 0) {
    syncSvgEditorNow(state);
    return;
  }
  syncTimer ??= setTimeout(() => {
    syncTimer = null;
    syncSvgEditorNow(getState());
  }, wait);
}

function syncSvgEditorNow(state: EditorState): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  lastSyncAt = performance.now();
  stale = false;
  const focused = document.activeElement === svgInput;
  if (!focused) {
    const text = formatExportSvg(state, true);
    if (svgInput.value !== text) {
      const top = svgInput.scrollTop;
      svgInput.value = text;
      svgInput.scrollTop = top;
      hideSvgError();
    }
  }
  refreshSvgHighlight(state.selection.elementIds);
  const key = state.selection.elementIds.join(",");
  if (!focused && key !== lastSelectionKey) {
    const line = svgPre.querySelector<HTMLElement>(".svg-line--selected");
    if (line) svgInput.scrollTop = Math.max(0, line.offsetTop - 40);
    svgPre.scrollTop = svgInput.scrollTop;
  }
  lastSelectionKey = key;
}

function showSvgError(message: string): void {
  svgError.textContent = `Invalid SVG — not applied: ${message}`;
  svgError.classList.remove("hidden");
  svgInput.classList.add("invalid");
}

function hideSvgError(): void {
  svgError.classList.add("hidden");
  svgInput.classList.remove("invalid");
}

function sameElement(a: SceneElement, b: SceneElement): boolean {
  return (
    a.type === b.type &&
    elementToSvgMarkup(a) === elementToSvgMarkup(b) &&
    buildDefsMarkup([a]) === buildDefsMarkup([b]) &&
    sanitizeName(a.name) === sanitizeName(b.name) &&
    groupsOf(a).join("/") === groupsOf(b).join("/")
  );
}

/**
 * Group names from the markup. A name typed with spaces comes back underscored from its id, so
 * where the markup still says the same thing the name as typed is kept, as shapes' names are.
 */
function mergeGroupNames(
  parsed: Record<string, string>,
  current: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [gid, name] of Object.entries(parsed)) {
    const typed = current[gid];
    out[gid] = typed && sanitizeName(typed) === sanitizeName(name) ? typed : name;
  }
  return out;
}

const sameNames = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

/** Applies the edited markup. Untouched shapes keep their exact float geometry. */
function applySvgText(): void {
  svgApplyTimer = null;
  let parsed;
  try {
    parsed = importSvgFile(svgInput.value, { keepIds: true });
  } catch (err) {
    showSvgError(err instanceof Error ? err.message : String(err));
    return;
  }
  hideSvgError();
  const st = getState();
  const old = new Map(st.elements.map((e) => [e.id, e]));
  const next = parsed.elements.map((n) => {
    const o = old.get(n.id);
    return o && sameElement(o, n) ? o : n;
  });
  const artboard = parsed.artboard ? { ...st.artboard, ...parsed.artboard } : st.artboard;
  // No background rect in the markup means a transparent document; the colour is kept so that
  // deleting the rect and typing it back does not lose what was chosen.
  const background = parsed.background ?? { color: st.background.color, opacity: 0 };
  const groupNames = mergeGroupNames(parsed.groupNames, st.groupNames);
  const same =
    sameNames(groupNames, st.groupNames) &&
    next.length === st.elements.length &&
    next.every((e, i) => e === st.elements[i]) &&
    artboard.width === st.artboard.width &&
    artboard.height === st.artboard.height &&
    background.color === st.background.color &&
    background.opacity === st.background.opacity;
  if (same) return;
  if (!svgEditUndoPushed) {
    pushUndo();
    svgEditUndoPushed = true;
  }
  const ids = new Set(next.map((e) => e.id));
  setState((s) => ({
    ...s,
    elements: next,
    groupNames,
    artboard,
    background,
    selection: selectOnly(s.selection.elementIds.filter((id) => ids.has(id))),
  }));
  noteChange();
}

svgInput.addEventListener("focus", () => {
  svgEditUndoPushed = false;
});
svgInput.addEventListener("input", () => {
  refreshSvgHighlight(getState().selection.elementIds);
  if (svgApplyTimer) clearTimeout(svgApplyTimer);
  svgApplyTimer = setTimeout(applySvgText, 500);
});
svgInput.addEventListener("blur", () => {
  if (svgApplyTimer) {
    clearTimeout(svgApplyTimer);
    applySvgText();
  }
});
svgInput.addEventListener("scroll", () => {
  svgPre.scrollTop = svgInput.scrollTop;
});

// Cursor inside a shape's line selects that shape (like picking it in Primitives).
document.addEventListener("selectionchange", () => {
  if (document.activeElement !== svgInput) return;
  const before = svgInput.value.slice(0, svgInput.selectionStart ?? 0);
  const line = svgInput.value.split("\n")[before.split("\n").length - 1] ?? "";
  const m = line.match(/\bid="([^"]+)"/);
  const elId = m ? elementIdFromSvgId(m[1]) : null;
  if (!elId || !findElement(elId)) return;
  const cur = getState().selection.elementIds;
  if (cur.length === 1 && cur[0] === elId) return;
  setState({ tool: "select", selection: selectOnly([elId]) });
});
