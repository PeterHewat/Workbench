import { getState, setState, mutate, findElement, selectOnly } from "./state.js";
import { setElementClosed } from "./selection-commands.js";
import { pushUndo } from "./undo.js";
import {
  MARKER_TYPES,
  MARKER_SHAPES,
  canToggleClosed,
  isClosedShape,
  elementBBox,
  translateElement,
  gradientStops,
  keepsRotation,
} from "./model.js";
import { escapeAttr } from "./utils.js";
import { openColorPicker, closeColorPicker, isColorPickerOpenFor } from "./colorpicker.js";
import {
  canMoveGroup,
  canMoveWithinParent,
  childBlocks,
  groupColor,
  groupsOf,
  moveGroup,
  type Block,
} from "./groups.js";
import { scaleAbout, transformElement } from "./transform.js";
import { type EditorState, type SceneElement } from "./types.js";
import { holdSvgFocus, setSvgFocus } from "./svg-source.js";
import {
  cachedList,
  accHeaderHtml,
  wireAccRow,
  setField,
  reorder,
  towardFront,
} from "./accordion.js";
import { byId } from "@workbench/ui";

const primitiveListEl = byId("primitive-list");

/* ---------- Primitives list ---------- */

function primitiveListKeyOf(state: EditorState): string {
  const els = state.elements
    .map(
      (e) =>
        `${e.id}:${e.type}:${groupsOf(e).join("/")}:${"closed" in e && e.closed ? 1 : 0}:${e.hidden ? 1 : 0}`
    )
    .join(",");
  return `${els}|${state.selection.elementIds.join(",")}|${state.ui.expandedElementId}`;
}

/** Each group's colour, from the hue it was given when it appeared (see `groupHues`). */
function groupColors(state: EditorState): Map<string, string> {
  const out = new Map<string, string>();
  for (const [gid, hue] of Object.entries(state.groupHues)) out.set(gid, groupColor(hue));
  return out;
}

/** Every element in group `gid`, at any depth. */
function membersOf(elements: readonly SceneElement[], gid: string): SceneElement[] {
  return elements.filter((e) => groupsOf(e).includes(gid));
}

function swatchHtml(kind: string, color: string, alpha: number, title: string): string {
  return `<button type="button" class="color-swatch" data-picker="${kind}" title="${title}" style="--c:${color};--a:${alpha}"><span class="color-swatch-fill"></span></button>`;
}

type Option = string | [string, string];

function selectHtml(field: string, value: string, options: readonly Option[]): string {
  const opts = options
    .map((o) => {
      const [v, label] = Array.isArray(o) ? o : [o, o];
      return `<option value="${v}"${v === value ? " selected" : ""}>${label}</option>`;
    })
    .join("");
  return `<select data-field="${field}">${opts}</select>`;
}

/**
 * Position and size, as numbers to type. Every shape reports the same four, measured from its
 * bounding box, so one set of fields works for a rect, an ellipse and a traced path alike -
 * and typing a number is the one way to be exact that a fingertip cannot manage.
 */
function geometryRowsHtml(el: SceneElement): string {
  const box = elementBBox(el);
  if (!box) return "";
  // Ordinary field rows, not a grid of their own: they land in the same two columns, with the
  // same label width and the same control width, as every other field in the body.
  const field = (key: string, label: string, aria: string, value: number, step = 1, min?: number) =>
    `<label class="field-row"><span>${label}</span><input type="number" data-field="${key}" step="${step}"${
      min == null ? "" : ` min="${min}"`
    } value="${Math.round(value * 100) / 100}" aria-label="${aria}" /></label>`;
  const position = field("geomX", "X", "X", box.x) + field("geomY", "Y", "Y", box.y);
  // Text has no width of its own - its size is the font size, which has its own field.
  const size =
    el.type === "text"
      ? ""
      : field("geomW", "W", "Width", box.width, 1, 0) +
        field("geomH", "H", "Height", box.height, 1, 0);
  // Only the shapes that store an angle get a field for it; on a path it is baked into points.
  const angle = keepsRotation(el)
    ? field("rotation", "Angle", "Rotation (degrees)", el.rotation ?? 0, 5)
    : "";
  return position + size + angle;
}

function primitiveBodyHtml(el: SceneElement): string {
  const rows: string[] = [geometryRowsHtml(el)];
  if (el.type === "text") {
    rows.push(
      `<div class="field-row field-row--wide"><span>Text</span><input type="text" data-field="text" value="${escapeAttr(el.text || "")}" /></div>`,
      `<div class="field-row"><span>Size</span><input type="number" data-field="fontSize" min="1" step="1" value="${el.fontSize || 48}" /></div>`,
      `<div class="field-row"><span>Font</span>${selectHtml("fontFamily", el.fontFamily || "sans-serif", ["sans-serif", "serif", "monospace", "cursive"])}</div>`,
      `<div class="field-row"><span>Align</span>${selectHtml("anchor", el.anchor || "start", [
        ["start", "left"],
        ["middle", "center"],
        ["end", "right"],
      ])}</div>`
    );
  }
  rows.push(
    `<div class="field-row"><span>Stroke</span>${swatchHtml("stroke", el.stroke, el.strokeOpacity ?? 1, "Stroke color and opacity")}</div>`
  );
  if (el.type !== "line") {
    rows.push(
      `<div class="field-row"><label class="fill-toggle"><span>Fill</span><input type="checkbox" data-field="fillEnabled"${el.fillEnabled ? " checked" : ""} /></label>${swatchHtml("fill", el.fill ?? "#000000", el.fillOpacity ?? 1, "Fill color and opacity")}</div>`,
      `<div class="field-row"><span>Fill type</span>${selectHtml(
        "fillType",
        el.fillType || "solid",
        [
          ["solid", "Solid"],
          ["linear", "Linear Gradient"],
          ["radial", "Radial Gradient"],
        ]
      )}</div>`,
      gradientStopsHtml(el)
    );
  }
  if (canToggleClosed(el)) {
    rows.push(
      `<div class="field-row"><label class="fill-toggle"><span>Closed</span><input type="checkbox" data-field="closed"${isClosedShape(el) ? " checked" : ""} /></label></div>`
    );
  }
  rows.push(
    `<div class="field-row"><span>Width</span><input type="number" data-field="strokeWidth" min="0" step="0.5" value="${el.strokeWidth}" /></div>`,
    `<div class="field-row"><span>Line cap</span>${selectHtml("linecap", el.linecap, ["round", "butt", "square"])}</div>`,
    `<div class="field-row"><span>Line join</span>${selectHtml("linejoin", el.linejoin, ["round", "miter", "bevel"])}</div>`
  );
  if (el.type === "rect") {
    rows.push(
      `<div class="field-row"><span>Corner X</span><input type="number" data-field="rx" min="0" step="1" value="${Math.round(el.rx || 0)}" /></div>`,
      `<div class="field-row"><span>Corner Y</span><input type="number" data-field="ry" min="0" step="1" value="${Math.round(el.ry ?? el.rx ?? 0)}" /></div>`
    );
  }
  if (MARKER_TYPES.includes(el.type)) {
    rows.push(
      `<div class="field-row"><span>Start</span>${selectHtml("markerStart", el.markerStart || "none", MARKER_SHAPES)}</div>`,
      `<div class="field-row"><span>End</span>${selectHtml("markerEnd", el.markerEnd || "none", MARKER_SHAPES)}</div>`
    );
  }
  return rows.join("");
}

/**
 * The gradient's stops, one row each: colour, where it sits along the gradient, and a way to
 * remove it. Where the gradient *runs* is not here - that is the two handles on the canvas,
 * which beat typing an angle on a touch screen and can express more than an angle could.
 */
function gradientStopsHtml(el: SceneElement): string {
  const stops = gradientStops(el);
  const rows = stops
    .map(
      (stop, i) =>
        `<div class="grad-stop">
          ${swatchHtml(`stop-${i}`, stop.color, stop.opacity, `Stop ${i + 1} colour and opacity`)}
          <input type="number" data-field="stopOffset" data-stop="${i}" min="0" max="100" step="1"
            value="${Math.round(stop.offset * 100)}" aria-label="Stop ${i + 1} position (%)" />
          <span class="grad-stop-unit">%</span>
          <button type="button" class="grad-stop-del" data-stop-remove="${i}" title="Remove stop"
            aria-label="Remove stop ${i + 1}"${stops.length > 2 ? "" : " disabled"}>×</button>
        </div>`
    )
    .join("");
  return `<div class="field-row field-row--wide grad-only grad-stops-row"><span>Stops</span>
      <div class="grad-stops">${rows}
        <button type="button" class="grad-stop-add" data-stop-add title="Add a stop">+ Stop</button>
      </div>
    </div>`;
}

function isInvisible(el: SceneElement): boolean {
  return el.strokeWidth === 0 && !el.fillEnabled;
}

function rgba(hex: string, a: number | undefined): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a ?? 1})`;
}

/** Circle in the row header: border = stroke color, inside = fill (transparent when none). */
function headerSwatchStyle(el: SceneElement): string {
  const border =
    el.strokeWidth === 0 ? "rgba(255,255,255,0.25)" : rgba(el.stroke, el.strokeOpacity);
  let inside = "transparent";
  if (el.fillEnabled) {
    if (el.fillType === "solid") {
      inside = rgba(el.fill, el.fillOpacity);
    } else {
      const stops = gradientStops(el)
        .map((s) => `${rgba(s.color, s.opacity)} ${Math.round(s.offset * 100)}%`)
        .join(", ");
      const angle =
        (Math.atan2(el.gradTo.y - el.gradFrom.y, el.gradTo.x - el.gradFrom.x) * 180) / Math.PI;
      inside =
        el.fillType === "radial"
          ? `radial-gradient(${stops})`
          : `linear-gradient(${Math.round(angle) + 90}deg, ${stops})`;
    }
  }
  return `border-color:${border};background:${inside}`;
}

/**
 * The list is a tree, because the document is one. A group is a single bracket drawn down the
 * left of the rows inside it, and a group within a group is a bracket within a bracket - not a
 * list of its own, and not a coloured stripe repeated on every row, which said "these rows are
 * the same kind of thing" rather than "these rows are one thing".
 */
function buildPrimitiveList(state: EditorState): void {
  primitiveListEl.innerHTML = "";
  rowRefs.clear();
  if (!state.elements.length) {
    const li = document.createElement("li");
    li.className = "primitive-empty muted";
    li.textContent = "No primitives yet";
    primitiveListEl.appendChild(li);
    return;
  }
  const colors = groupColors(state);
  appendBlocks(primitiveListEl, state, { start: 0, end: state.elements.length }, 0, colors);
}

/**
 * Each row and its header swatch, by element id, filled in as the list is built. The in-place
 * update runs on every state change, pointer moves included, and looking each row up with
 * `querySelector` there cost a scan of the whole list per shape.
 */
const rowRefs = new Map<string, { li: HTMLElement; swatch: HTMLElement | null; style: string }>();

/** One level of the tree: each block is either a nested group or a single row. */
function appendBlocks(
  parent: HTMLElement,
  state: EditorState,
  range: Block,
  depth: number,
  colors: Map<string, string>
): void {
  // Back to front: the shape drawn last, on top of the others, heads the list.
  for (const block of childBlocks(state.elements, range, depth).reverse()) {
    const gid = groupsOf(state.elements[block.start])[depth];
    if (gid == null) {
      parent.appendChild(primitiveRow(state, block.start));
      continue;
    }
    const run = document.createElement("li");
    run.className = "group-run";
    run.dataset.groupId = gid;
    run.style.setProperty("--gc", colors.get(gid) ?? "var(--accent)");
    run.classList.toggle("collapsed", collapsedGroups.has(gid));
    run.appendChild(groupHead(state, gid));
    const inner = document.createElement("ul");
    inner.className = "group-items";
    run.appendChild(inner);
    appendBlocks(inner, state, block, depth + 1, colors);
    parent.appendChild(run);
  }
}

/**
 * Groups folded shut in the list. Where you are looking, not part of the drawing: not saved,
 * not undone, and forgotten when the group is.
 */
const collapsedGroups = new Set<string>();

/**
 * A group's own row, built like a shape's so every button lines up down the list: the chevron
 * folds the group, the checkbox selects all of it, the name is what `<g id>` carries after the
 * group's id, the count stands where a shape shows its colours, the eye shows or hides every
 * member, the arrows move the group as one block, and the bin deletes it with everything in it.
 */
function groupHead(state: EditorState, gid: string): HTMLElement {
  const members = membersOf(state.elements, gid);
  const selected = new Set(state.selection.elementIds);
  const allSelected = members.every((e) => selected.has(e.id));
  const allHidden = members.every((e) => e.hidden);
  const head = document.createElement("div");
  head.className = "acc-item group-head";
  head.innerHTML = accHeaderHtml({
    dot: { on: allSelected, title: allSelected ? "Deselect the group" : "Select the group" },
    eye: { visible: !allHidden, title: allHidden ? "Show the group" : "Hide the group" },
    titleHtml: `<input type="text" class="acc-title-input group-name-input" data-group-name value="${escapeAttr(state.groupNames[gid] ?? "")}" placeholder="group" aria-label="Group name" title="Group name - exported in the group's id" />`,
    extra: `<span class="acc-swatch group-count" title="${members.length} shapes in this group">${members.length}</span>`,
    canUp: canMoveGroup(state.elements, gid, towardFront(-1)),
    canDown: canMoveGroup(state.elements, gid, towardFront(1)),
    index: 0,
    count: 0,
  });
  wireAccRow(head, {
    onExpand: () => toggleGroupCollapsed(gid),
    onDot: () => toggleGroupSelected(gid),
    onEye: () =>
      setHidden(
        members.map((e) => e.id),
        !allHidden
      ),
    onDelete: () => deleteGroup(gid),
    onMove: (dir, toEnd) => moveGroupBy(gid, towardFront(dir), toEnd),
  });
  const input = head.querySelector<HTMLInputElement>("[data-group-name]")!;
  input.addEventListener("input", () => renameGroup(gid, input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  return head;
}

function primitiveRow(state: EditorState, index: number): HTMLElement {
  const el = state.elements[index]!;
  const isSelected = state.selection.elementIds.includes(el.id);
  const li = document.createElement("li");
  li.className = `acc-item${state.ui.expandedElementId === el.id ? " expanded" : ""}`;
  li.dataset.elementId = el.id;
  li.innerHTML = `
    ${accHeaderHtml({
      dot: { on: isSelected, title: isSelected ? "Deselect" : "Select" },
      eye: { visible: !el.hidden, title: el.hidden ? "Show" : "Hide" },
      name: el.name || "",
      placeholder: el.type,
      extra: `<span class="acc-swatch" style="${headerSwatchStyle(el)}"></span>`,
      canUp: canMoveWithinParent(state.elements, el.id, towardFront(-1)),
      canDown: canMoveWithinParent(state.elements, el.id, towardFront(1)),
      index,
      count: state.elements.length,
    })}
    <div class="acc-body">${primitiveBodyHtml(el)}</div>
  `;
  li.dataset.filltype = el.fillType || "solid";
  li.classList.toggle("acc-item--hidden", !!el.hidden);
  li.classList.toggle("acc-item--invisible", isInvisible(el));
  const swatch = li.querySelector<HTMLElement>(".acc-swatch");
  if (swatch && isInvisible(el)) swatch.title = "Invisible: no stroke and no fill";
  rowRefs.set(el.id, { li, swatch, style: headerSwatchStyle(el) });
  wireAccRow(li, {
    onExpand: () => toggleElementExpanded(el.id),
    onDot: () => toggleElementSelected(el.id),
    onEye: () => setHidden([el.id], !el.hidden),
    onDelete: () => deletePrimitive(el.id),
    onMove: (dir, toEnd) => reorder("elements", el.id, towardFront(dir), toEnd),
  });
  return li;
}

function updatePrimitiveListValues(state: EditorState): void {
  primitiveListEl.querySelectorAll<HTMLElement>(".group-run").forEach((run) => {
    const input = run.querySelector<HTMLInputElement>(":scope > .group-head [data-group-name]");
    const gid = run.dataset.groupId;
    if (input && gid && input !== document.activeElement) input.value = state.groupNames[gid] ?? "";
  });
  for (const el of state.elements) {
    const row = rowRefs.get(el.id);
    if (!row) continue;
    const { li } = row;
    setField(li, "name", el.name || "");
    // Only what changed is written: an unchanged write still restyles the row.
    const style = headerSwatchStyle(el);
    if (row.swatch && style !== row.style) {
      row.swatch.style.cssText = style;
      row.style = style;
    }
    li.classList.toggle("acc-item--invisible", isInvisible(el));
    const fillType = el.fillType || "solid";
    if (li.dataset.filltype !== fillType) li.dataset.filltype = fillType;
    if (!li.classList.contains("expanded")) continue;
    const setSwatch = (kind: string, color: string, alpha: number) => {
      const btn = li.querySelector<HTMLElement>(`[data-picker="${kind}"]`);
      if (!btn) return;
      btn.style.setProperty("--c", color);
      btn.style.setProperty("--a", String(alpha));
    };
    setSwatch("stroke", el.stroke, el.strokeOpacity ?? 1);
    setSwatch("fill", el.fill ?? "#000000", el.fillOpacity ?? 1);
    gradientStops(el).forEach((stop, i) => {
      setSwatch(`stop-${i}`, stop.color, stop.opacity);
      const input = li.querySelector<HTMLInputElement>(
        `[data-field="stopOffset"][data-stop="${i}"]`
      );
      if (input && input !== document.activeElement)
        input.value = String(Math.round(stop.offset * 100));
    });
    if (el.type === "text") {
      setField(li, "text", el.text ?? "");
      setField(li, "fontSize", el.fontSize ?? 48);
      setField(li, "fontFamily", el.fontFamily ?? "sans-serif");
      setField(li, "anchor", el.anchor ?? "start");
    }
    const box = elementBBox(el);
    if (box) {
      const round = (n: number) => Math.round(n * 100) / 100;
      setField(li, "geomX", round(box.x));
      setField(li, "geomY", round(box.y));
      setField(li, "geomW", round(box.width));
      setField(li, "geomH", round(box.height));
      setField(li, "rotation", Math.round(el.rotation ?? 0));
    }
    setField(li, "strokeWidth", el.strokeWidth);
    setField(li, "linecap", el.linecap);
    setField(li, "linejoin", el.linejoin);
    setField(li, "fillType", el.fillType ?? "solid");
    if (el.type === "rect") {
      setField(li, "rx", Math.round(el.rx || 0));
      setField(li, "ry", Math.round(el.ry ?? el.rx ?? 0));
    }
    setField(li, "markerStart", el.markerStart || "none");
    setField(li, "markerEnd", el.markerEnd || "none");
    const fillCheckbox = li.querySelector<HTMLInputElement>('[data-field="fillEnabled"]');
    if (fillCheckbox && fillCheckbox !== document.activeElement) {
      fillCheckbox.checked = !!el.fillEnabled;
    }
  }
}

export const primitiveList = cachedList(
  primitiveListKeyOf,
  buildPrimitiveList,
  updatePrimitiveListValues
);

function toggleElementExpanded(id: string): void {
  setState((s) => ({
    ...s,
    ui: { ...s.ui, expandedElementId: s.ui.expandedElementId === id ? null : id },
  }));
}

function toggleElementSelected(id: string): void {
  setState((s) => {
    const ids = s.selection.elementIds;
    return {
      ...s,
      selection: selectOnly(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
      tool: "select",
    };
  });
}

/** Selects every member of a group, or, when they all are already, none of them. */
function toggleGroupSelected(gid: string): void {
  setState((s) => {
    const ids = membersOf(s.elements, gid).map((e) => e.id);
    const current = new Set(s.selection.elementIds);
    const all = ids.every((id) => current.has(id));
    const next = all
      ? s.selection.elementIds.filter((id) => !ids.includes(id))
      : [...new Set([...s.selection.elementIds, ...ids])];
    return { ...s, selection: selectOnly(next), tool: "select" };
  });
}

/**
 * Shows or hides shapes. A hidden shape leaves the selection, since nothing on the canvas would
 * show what a drag or a Delete was about to act on.
 */
function setHidden(ids: readonly string[], hidden: boolean): void {
  const wanted = new Set(ids);
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.map((e) => {
      if (!wanted.has(e.id) || !!e.hidden === hidden) return e;
      const next = { ...e };
      if (hidden) next.hidden = true;
      else delete next.hidden;
      return next;
    }),
    selection: hidden
      ? selectOnly(s.selection.elementIds.filter((id) => !wanted.has(id)))
      : s.selection,
  }));
}

/** Live while typing, like a shape's name: one undo step for the whole edit. */
function renameGroup(gid: string, raw: string): void {
  const name = raw.trim();
  const st = getState();
  if ((st.groupNames[gid] ?? "") === name) return;
  if (!textUndoPushed) {
    pushUndo();
    textUndoPushed = true;
  }
  setState((s) => {
    const groupNames = { ...s.groupNames };
    if (name) groupNames[gid] = name;
    else delete groupNames[gid];
    return { ...s, groupNames };
  });
}

function toggleGroupCollapsed(gid: string): void {
  if (collapsedGroups.has(gid)) collapsedGroups.delete(gid);
  else collapsedGroups.add(gid);
  primitiveList.invalidate();
  primitiveList.sync(getState());
}

/** `dir` is in document order: +1 towards the front. */
function moveGroupBy(gid: string, dir: -1 | 1, toEnd: boolean): void {
  const before = getState().elements;
  const next = moveGroup(before, gid, dir, toEnd);
  if (next.every((e, i) => e === before[i])) return;
  pushUndo();
  setState((s) => ({ ...s, elements: next }));
}

/** Deletes a group and everything in it, as the bin on a shape's row deletes that shape. */
function deleteGroup(gid: string): void {
  const doomed = new Set(membersOf(getState().elements, gid).map((e) => e.id));
  if (!doomed.size) return;
  pushUndo();
  collapsedGroups.delete(gid);
  setState((s) => {
    const groupNames = { ...s.groupNames };
    delete groupNames[gid];
    return {
      ...s,
      elements: s.elements.filter((e) => !doomed.has(e.id)),
      groupNames,
      selection: selectOnly(s.selection.elementIds.filter((id) => !doomed.has(id))),
      ui: {
        ...s.ui,
        expandedElementId: doomed.has(s.ui.expandedElementId ?? "") ? null : s.ui.expandedElementId,
      },
    };
  });
}

function deletePrimitive(id: string): void {
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.filter((e) => e.id !== id),
    selection: selectOnly(s.selection.elementIds.filter((x) => x !== id)),
    ui: {
      ...s.ui,
      expandedElementId: s.ui.expandedElementId === id ? null : s.ui.expandedElementId,
    },
  }));
}

const GEOMETRY_FIELDS = ["geomX", "geomY", "geomW", "geomH"];

/**
 * Moves or scales a shape to put one edge of its bounding box at a typed value. Scaling runs
 * through the same matrix code that bakes imported transforms, so every shape type behaves.
 */
function applyGeometryField(id: string, field: string, value: number): void {
  const el = findElement(id);
  const box = el ? elementBBox(el) : null;
  if (!el || !box) return;
  if (field === "geomX" || field === "geomY") {
    const dx = field === "geomX" ? value - box.x : 0;
    const dy = field === "geomY" ? value - box.y : 0;
    if (!dx && !dy) return;
    pushUndo();
    mutate(() => {
      const target = findElement(id);
      if (target) translateElement(target, dx, dy);
    });
    return;
  }
  const horizontal = field === "geomW";
  const from = horizontal ? box.width : box.height;
  // A shape with no extent in that direction (a horizontal line, say) cannot be scaled into one.
  if (from <= 0 || value <= 0 || value === from) return;
  const factor = value / from;
  pushUndo();
  setState((s) => ({
    ...s,
    elements: s.elements.map((x) =>
      x.id === id
        ? transformElement(
            x,
            horizontal ? scaleAbout(factor, 1, box.x, box.y) : scaleAbout(1, factor, box.x, box.y)
          )
        : x
    ),
  }));
  primitiveList.invalidate();
}

function applyToElement(id: string, fn: (el: SceneElement) => void): void {
  if (!findElement(id)) return;
  pushUndo();
  mutate(() => {
    const el = findElement(id);
    if (el) fn(el);
  });
}

const NUMERIC_FIELDS: Record<string, (v: number) => number> = {
  strokeWidth: (v) => Math.max(0, v),
  fontSize: (v) => Math.max(1, v),
  rx: (v) => Math.max(0, v),
  ry: (v) => Math.max(0, v),
  rotation: (v) => ((v % 360) + 360) % 360,
};

// Fields that update the shape (and the SVG panel) live while typing; one undo step per session.
const LIVE_TEXT = ["text", "name"];
const LIVE_NUMBER = ["fontSize", "strokeWidth", "rx", "ry"];
const WRAPPING_ANGLES = ["rotation"];

let textUndoPushed = false;

primitiveListEl.addEventListener("focusin", () => {
  textUndoPushed = false;
});

primitiveListEl.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  const field = input.dataset?.field;
  if (!field) return;

  // Spinner arrows (no inputType) wrap the angle around instead of running past 0/360.
  if (!(e as InputEvent).inputType && WRAPPING_ANGLES.includes(field)) {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) input.value = String(((v % 360) + 360) % 360);
    return;
  }

  if (!LIVE_TEXT.includes(field) && !LIVE_NUMBER.includes(field)) return;
  const li = input.closest<HTMLElement>("[data-element-id]");
  const el = li?.dataset.elementId ? findElement(li.dataset.elementId) : undefined;
  if (!el) return;
  let value: string | number = input.value;
  if (LIVE_NUMBER.includes(field)) {
    const v = parseFloat(input.value);
    if (Number.isNaN(v)) return;
    value = NUMERIC_FIELDS[field]!(v);
  }
  const target = el as unknown as Record<string, unknown>;
  if (target[field] === value) return;
  if (!textUndoPushed) {
    pushUndo();
    textUndoPushed = true;
  }
  mutate(() => {
    target[field] = value;
  });
});

primitiveListEl.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const field = input.dataset?.field;
  if (!field || field === "text") return;
  const li = input.closest<HTMLElement>("[data-element-id]");
  const id = li?.dataset.elementId;
  if (!id) return;
  const current = findElement(id);
  if (LIVE_TEXT.includes(field) || LIVE_NUMBER.includes(field)) {
    const v = LIVE_NUMBER.includes(field)
      ? NUMERIC_FIELDS[field]!(parseFloat(input.value))
      : input.value.trim();
    if (current && (current as unknown as Record<string, unknown>)[field] === v) return;
  }
  if (field === "fillEnabled") {
    applyToElement(id, (el) => {
      el.fillEnabled = input.checked;
    });
  } else if (field === "closed") {
    setElementClosed(id, input.checked);
    primitiveList.invalidate();
  } else if (field === "fillType") {
    applyToElement(id, (el) => {
      el.fillType = input.value as SceneElement["fillType"];
      if (input.value !== "solid") el.fillEnabled = true;
    });
  } else if (field === "stopOffset") {
    const percent = parseFloat(input.value);
    if (Number.isNaN(percent)) return;
    const index = parseInt(input.dataset.stop ?? "0", 10);
    applyToElement(id, (el) => {
      const stops = gradientStops(el);
      const stop = stops[index];
      if (stop) stop.offset = Math.min(1, Math.max(0, percent / 100));
      el.gradStops = stops;
    });
    primitiveList.invalidate();
  } else if (GEOMETRY_FIELDS.includes(field)) {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) applyGeometryField(id, field, v);
  } else if (field in NUMERIC_FIELDS) {
    const v = parseFloat(input.value);
    if (Number.isNaN(v)) return;
    applyToElement(id, (el) => {
      (el as unknown as Record<string, unknown>)[field] = NUMERIC_FIELDS[field]!(v);
    });
  } else if (field === "name") {
    applyToElement(id, (el) => {
      el.name = input.value.trim();
    });
  } else {
    // Plain string selects: linecap, linejoin, markers, font family, anchor.
    applyToElement(id, (el) => {
      (el as unknown as Record<string, unknown>)[field] = input.value;
    });
  }
});

const PICKER_FIELDS: Record<string, [string, string]> = {
  stroke: ["stroke", "strokeOpacity"],
  fill: ["fill", "fillOpacity"],
};

/** Writes a colour into a gradient stop, or into one of the plain colour fields. */
function writeColor(el: SceneElement, kind: string, hex: string, alpha: number): void {
  const stopIndex = kind.startsWith("stop-") ? parseInt(kind.slice(5), 10) : -1;
  if (stopIndex >= 0) {
    const stops = gradientStops(el);
    const stop = stops[stopIndex];
    if (!stop) return;
    stop.color = hex;
    stop.opacity = alpha;
    el.gradStops = stops;
    // The first stop is also the solid colour, so turning the gradient off keeps something.
    if (stopIndex === 0) {
      el.fill = hex;
      el.fillOpacity = alpha;
    }
    el.fillEnabled = true;
    return;
  }
  const keys = PICKER_FIELDS[kind];
  if (!keys) return;
  const target = el as unknown as Record<string, unknown>;
  target[keys[0]] = hex;
  target[keys[1]] = alpha;
  if (kind !== "stroke") el.fillEnabled = true;
}

/** The colour and alpha a swatch currently shows. */
function readColor(el: SceneElement, kind: string): { color: string; alpha: number } {
  if (kind.startsWith("stop-")) {
    const stop = gradientStops(el)[parseInt(kind.slice(5), 10)];
    return { color: stop?.color ?? "#000000", alpha: stop?.opacity ?? 1 };
  }
  const keys = PICKER_FIELDS[kind];
  const src = el as unknown as Record<string, unknown>;
  return {
    color: keys ? ((src[keys[0]] as string) ?? "#000000") : "#000000",
    alpha: keys ? ((src[keys[1]] as number) ?? 1) : 1,
  };
}

primitiveListEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-picker]");
  if (!btn) return;
  if (isColorPickerOpenFor(btn)) {
    closeColorPicker();
    return;
  }
  const id = btn.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
  const kind = btn.dataset.picker;
  const el = id ? findElement(id) : undefined;
  if (!id || !kind || !el) return;
  if (!kind.startsWith("stop-") && !PICKER_FIELDS[kind]) return;
  const start = readColor(el, kind);
  let pushed = false;
  holdSvgFocus(true);
  setSvgFocus({ id, field: kind.startsWith("stop-") ? "fill" : kind });
  openColorPicker({
    anchor: btn,
    onClose: () => {
      holdSvgFocus(false);
      if (!primitiveListEl.contains(document.activeElement)) setSvgFocus(null);
    },
    color: start.color,
    alpha: start.alpha,
    onChange: (hex, alpha) => {
      const cur = findElement(id);
      if (!cur) return;
      if (!pushed) {
        pushUndo();
        pushed = true;
      }
      mutate(() => writeColor(cur, kind, hex, alpha));
    },
  });
});

/* Adding, moving and removing gradient stops. */
primitiveListEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const add = target.closest<HTMLElement>("[data-stop-add]");
  const remove = target.closest<HTMLElement>("[data-stop-remove]");
  if (!add && !remove) return;
  const id = target.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
  if (!id) return;
  applyToElement(id, (el) => {
    const stops = gradientStops(el);
    if (add) {
      // A new stop lands midway between the last two, taking a blend of their colours.
      const a = stops[stops.length - 2]!;
      const b = stops[stops.length - 1]!;
      stops.splice(stops.length - 1, 0, {
        offset: (a.offset + b.offset) / 2,
        color: b.color,
        opacity: (a.opacity + b.opacity) / 2,
      });
    } else if (stops.length > 2) {
      stops.splice(parseInt(remove!.dataset.stopRemove ?? "0", 10), 1);
    }
    el.gradStops = stops;
  });
  primitiveList.invalidate();
});
