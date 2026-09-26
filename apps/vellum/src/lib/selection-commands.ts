import { getState, setState, mutate, findElement, selectOnly } from "./state.js";
import {
  translateElement,
  duplicateElement,
  toPathElement,
  canToggleClosed,
  closeByMerge,
  closingEnd,
  setClosed,
  splitAt,
  joinPaths,
  canJoin,
  hasTwoHandles,
  hasHandle,
  removeHandle,
  setHandlesLinked,
  togglePointSmooth,
  translatePoint,
  deletePoints,
  hasPoint,
} from "./model.js";
import {
  canGroup,
  canMergeGroups,
  canUngroup,
  expandToGroups,
  groupElements,
  groupsOf,
  mergeGroups,
  moveSelectionZ,
  normalizeGroups,
  parentSelection,
  selectionContext,
  ungroupElements,
  type ZDirection,
} from "./groups.js";
import { uid } from "./utils.js";
import { pushUndo } from "./undo.js";
import { type Point, type SceneElement } from "./types.js";
import { commit } from "./ops.js";

/** Z-order moves whole top-level blocks, so a group never gets split across the list. */
export function moveZOrder(direction: ZDirection): void {
  const ids = new Set(getState().selection.elementIds);
  if (!ids.size) return;
  commit(() => {
    setState((s) => ({ ...s, elements: moveSelectionZ(s.elements, ids, direction) }));
  });
}

/** Selecting one member of a group selects the whole outermost group. */
export function expandGroups(ids: string[]): string[] {
  return expandToGroups(getState().elements, ids);
}

/**
 * Wraps the selection in a new group. Groups selected whole nest inside it rather than being
 * flattened; a selection made inside a group is grouped inside that group.
 */
export function groupSelection(): void {
  const st = getState();
  const ids = new Set(st.selection.elementIds);
  if (!canGroup(st.elements, ids)) return;
  pushUndo();
  setState((s) => ({ ...s, elements: groupElements(s.elements, ids, uid("group")) }));
}

/**
 * Puts the selection into one group without nesting: loose shapes join the selected group, and
 * several selected groups become one. The counterpart to `groupSelection`, which adds a level.
 */
export function mergeSelection(): void {
  const st = getState();
  const ids = new Set(st.selection.elementIds);
  if (!canMergeGroups(st.elements, ids)) return;
  const depth = selectionContext(st.elements, ids).length;
  pushUndo();
  setState((s) => {
    const elements = mergeGroups(s.elements, ids, s.groupNames);
    // The merged group is the one the selection now shares at its own level.
    const first = elements.find((e) => ids.has(e.id));
    const gid = groupsOf(first)[depth];
    const selected = gid
      ? elements.filter((e) => groupsOf(e).includes(gid)).map((e) => e.id)
      : [...ids];
    return { ...s, elements, selection: selectOnly(selected) };
  });
}

/**
 * Esc on a selection: from a picked point back to its shape, and from inside a group out to the
 * whole of that group, one level at a time. False when there is no level left to climb.
 */
export function stepOutSelection(): boolean {
  const { selection, elements } = getState();
  if (selection.pathEdit) {
    setState({ selection: selectOnly(selection.elementIds) });
    return true;
  }
  const parent = parentSelection(elements, new Set(selection.elementIds));
  if (!parent) return false;
  setState({ selection: selectOnly(parent) });
  return true;
}

/** Peels off the outermost group of the selection, leaving any nested groups inside it intact. */
export function ungroupSelection(): void {
  const st = getState();
  const ids = new Set(st.selection.elementIds);
  if (!canUngroup(st.elements, ids)) return;
  pushUndo();
  setState((s) => ({ ...s, elements: ungroupElements(s.elements, ids) }));
}

/**
 * Delete. With a curve handle picked it takes that handle and leaves its point; `handleFirst`
 * false skips that, for the bar's "Delete this point", which says what it deletes.
 */
export function deleteSelection(handleFirst = true): void {
  const st = getState();
  const pe = st.selection.pathEdit;
  if (handleFirst && pe?.handle) {
    removeSelectedHandle();
    return;
  }
  if (pe && pe.kind === "anchor") {
    const el = findElement(pe.pathId);
    if (!el) return;
    const next = deletePoints(el, [pe.index]);
    commit(() => {
      setState((s) => ({
        ...s,
        elements: next
          ? s.elements.map((x) => (x.id === el.id ? next : x))
          : s.elements.filter((x) => x.id !== el.id),
        selection: selectOnly(next ? [next.id] : []),
      }));
    });
    return;
  }
  if (st.selection.elementIds.length) {
    commit(() => {
      setState((s) => ({
        ...s,
        elements: s.elements.filter((e) => !s.selection.elementIds.includes(e.id)),
        selection: selectOnly(),
      }));
    });
  }
}

/** Links the curve handles of the selected anchor, or breaks them apart into a cusp. */
export function setSelectedHandlesLinked(linked: boolean): void {
  const pe = getState().selection.pathEdit;
  const el = pe ? findElement(pe.pathId) : undefined;
  const p = pe && el?.type === "path" ? el.points[pe.index] : undefined;
  if (!p || !hasTwoHandles(p) || p.smooth === linked) return;
  commit(() => mutate(() => setHandlesLinked(p, linked)));
}

/**
 * Turns the selected point into a curve, or a curved one back into a corner: what double-clicking
 * the point does. A line, polyline or polygon becomes a path first, as it has no curves to give.
 */
export function toggleSelectedPointCurve(): void {
  const pe = getState().selection.pathEdit;
  const el = pe ? findElement(pe.pathId) : undefined;
  if (!pe || !el || !canToggleClosed(el)) return;
  commit(() => {
    setState((s) => {
      const path = toPathElement(el);
      togglePointSmooth(path, pe.index);
      return {
        ...s,
        elements: s.elements.map((x) => (x.id === el.id ? path : x)),
        selection: selectOnly([path.id], { pathId: path.id, kind: "anchor", index: pe.index }),
      };
    });
  });
}

/** Takes the selected point's last-grabbed curve handle off it. */
export function removeSelectedHandle(): void {
  const pe = getState().selection.pathEdit;
  const el = pe ? findElement(pe.pathId) : undefined;
  const p = pe && el?.type === "path" ? el.points[pe.index] : undefined;
  const kind = pe?.handle;
  if (!pe || !p || !kind || !hasHandle(p, kind)) return;
  commit(() => {
    mutate(() => removeHandle(p, kind));
    setState({
      selection: selectOnly([pe.pathId], { pathId: pe.pathId, kind: "anchor", index: pe.index }),
    });
  });
}

/** Cuts the selected path at the selected anchor. */
export function splitAtSelectedPoint(): void {
  const pe = getState().selection.pathEdit;
  if (!pe || pe.kind !== "anchor") return;
  const el = findElement(pe.pathId);
  const parts = el ? splitAt(el, pe.index) : null;
  if (!el || !parts) return;
  commit(() => {
    setState((s) => ({
      ...s,
      elements: s.elements.flatMap((x) => (x.id === el.id ? parts : [x])),
      selection: selectOnly(parts.map((p) => p.id)),
    }));
  });
}

/** Joins the two selected open shapes at their closest ends. */
export function joinSelected(): void {
  const ids = getState().selection.elementIds;
  if (ids.length !== 2) return;
  const a = findElement(ids[0]);
  const b = findElement(ids[1]);
  if (!a || !b) return;
  const joined = joinPaths(a, b);
  if (!joined) return;
  commit(() => {
    setState((s) => ({
      ...s,
      elements: s.elements.filter((x) => x.id !== b.id).map((x) => (x.id === a.id ? joined : x)),
      selection: selectOnly([joined.id]),
    }));
  });
}

export function ends(el: SceneElement): [Point, Point] | null {
  if (el.type === "line") {
    return [
      { x: el.x1, y: el.y1 },
      { x: el.x2, y: el.y2 },
    ];
  }
  if (!("points" in el) || !el.points.length) return null;
  return [el.points[0]!, el.points[el.points.length - 1]!];
}

function canJoinEnds(el: SceneElement, idx: number): boolean {
  if (!canJoin(el)) return false;
  const n = el.type === "line" ? 2 : "points" in el ? el.points.length : 0;
  return n >= 2 && (idx === 0 || idx === n - 1);
}

export function setElementClosed(id: string, closed: boolean): void {
  const el = findElement(id);
  if (!el || !canToggleClosed(el)) return;
  commit(() => {
    setState((s) => {
      const cur = findElement(id);
      if (!cur) return s;
      const next = setClosed(cur, closed);
      return {
        ...s,
        elements: s.elements.map((x) => (x.id === id ? next : x)),
        selection: selectOnly([id]),
      };
    });
  });
}

/**
 * Fresh copies of `elements`, shifted by `off`, in fresh groups. The copied groups keep their
 * names, returned by their new ids so the caller can add them to the document. Groups in `keep`
 * are not copied: the copies join them, as a duplicate of one member joins its group.
 */
export function copyElements(
  elements: readonly SceneElement[],
  off: number,
  groupNames: Readonly<Record<string, string>> = {},
  keep: ReadonlySet<string> = new Set()
): { copies: SceneElement[]; groupNames: Record<string, string> } {
  const groupMap = new Map<string, string>();
  const names: Record<string, string> = {};
  const remap = (gid: string) => {
    if (keep.has(gid)) return gid;
    if (!groupMap.has(gid)) {
      const next = uid("group");
      groupMap.set(gid, next);
      if (groupNames[gid]) names[next] = groupNames[gid];
    }
    return groupMap.get(gid)!;
  };
  const copies = elements.map((el) => {
    const c = duplicateElement(el);
    translateElement(c, off, off);
    const chain = groupsOf(c);
    if (chain.length) c.groups = chain.map(remap);
    return c;
  });
  return { copies, groupNames: names };
}

export function duplicateSelection(): void {
  if (!getState().selection.elementIds.length) return;
  commit(() => {
    setState((s) => {
      const source = s.selection.elementIds
        .map((id) => findElement(id))
        .filter((e): e is SceneElement => !!e);
      // A group only partly selected - one member picked inside it - takes the copies in, right
      // above its other members; a group selected whole is copied along with its members.
      const picked = new Set(source.map((e) => e.id));
      const partial = new Set(
        s.elements.filter((e) => !picked.has(e.id)).flatMap((e) => groupsOf(e))
      );
      const { copies, groupNames } = copyElements(source, s.grid.step, s.groupNames, partial);
      return {
        ...s,
        elements: normalizeGroups([...s.elements, ...copies]),
        groupNames: { ...s.groupNames, ...groupNames },
        selection: selectOnly(copies.map((c) => c.id)),
      };
    });
  });
}

/**
 * The arrow keys. With a point picked they move that point, or the curve handle grabbed last,
 * as a drag would; otherwise they move the whole selection.
 */
export function nudgeSelection(dx: number, dy: number): void {
  const { selection } = getState();
  const pe = selection.pathEdit;
  const pointOwner = pe ? findElement(pe.pathId) : undefined;
  if (pe && pointOwner && hasPoint(pointOwner, pe.index)) {
    commit(() => mutate(() => translatePoint(pointOwner, pe.index, dx, dy, pe.handle)));
    return;
  }
  if (!selection.elementIds.length) return;
  commit(() =>
    mutate((s) => {
      for (const id of s.selection.elementIds) {
        const el = findElement(id);
        if (el) translateElement(el, dx, dy);
      }
    })
  );
}

/**
 * What dropping the end `idx` of `el` where it is now would merge it with: its own other end,
 * which closes it, or an end of another open shape, which joins the two. `point` is that end.
 */
export function endDropTarget(
  el: SceneElement,
  idx: number,
  tol: number
): { point: Point; other: SceneElement | null } | null {
  const own = closingEnd(el, idx, tol);
  if (own) return { point: { x: own.x, y: own.y }, other: null };
  if (!canJoinEnds(el, idx)) return null;
  const pair = ends(el);
  if (!pair) return null;
  const dragged = pair[idx === 0 ? 0 : 1];
  for (const other of getState().elements) {
    if (other.id === el.id || !canJoin(other)) continue;
    const hit = ends(other)?.find((p) => Math.hypot(p.x - dragged.x, p.y - dragged.y) <= tol);
    if (hit) return { point: { x: hit.x, y: hit.y }, other };
  }
  return null;
}

/** After dragging an endpoint: close the shape onto itself, or join it to another. */
export function mergeDroppedEnd(el: SceneElement, idx: number, tol: number): void {
  const target = endDropTarget(el, idx, tol);
  if (!target) return;
  const other = target.other;
  const merged = other ? joinPaths(el, other, tol, tol) : closeByMerge(el, idx, tol);
  if (!merged) return;
  setState((s) => ({
    ...s,
    elements: s.elements
      .filter((x) => x.id !== other?.id)
      .map((x) => (x.id === el.id ? merged : x)),
    selection: selectOnly([merged.id]),
  }));
}
