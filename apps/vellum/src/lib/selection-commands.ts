import { getState, setState, mutate, findElement, selectOnly } from "./state.js";
import {
  translateElement,
  duplicateElement,
  simplifyPathIfStraight,
  toPathElement,
  canToggleClosed,
  closeByMerge,
  setClosed,
  splitAt,
  joinPaths,
  canJoin,
} from "./model.js";
import {
  expandToGroups,
  groupsOf,
  moveSelectionZ,
  normalizeGroups,
  outerGroup,
  pruneGroups,
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
 * Wraps the selection in a new group. The selection is always whole groups (selecting a member
 * selects its group), so grouping two groups nests them rather than flattening either.
 */
export function groupSelection(): void {
  const st = getState();
  const ids = new Set(st.selection.elementIds);
  if (st.elements.filter((e) => ids.has(e.id)).length < 2) return;
  const gid = uid("group");
  pushUndo();
  setState((s) => {
    const lastIdx = Math.max(...s.elements.map((e, i) => (ids.has(e.id) ? i : -1)));
    const rest = s.elements.filter((e) => !ids.has(e.id));
    const before = s.elements.slice(0, lastIdx + 1).filter((e) => !ids.has(e.id)).length;
    const grouped = s.elements
      .filter((e) => ids.has(e.id))
      .map((e) => ({ ...e, groups: [gid, ...groupsOf(e)] }));
    return {
      ...s,
      elements: normalizeGroups([...rest.slice(0, before), ...grouped, ...rest.slice(before)]),
    };
  });
}

/** Peels off the outermost group of the selection, leaving any nested groups inside it intact. */
export function ungroupSelection(): void {
  const st = getState();
  const gids = new Set(
    st.elements
      .filter((e) => st.selection.elementIds.includes(e.id))
      .map(outerGroup)
      .filter((g): g is string => !!g)
  );
  if (!gids.size) return;
  pushUndo();
  setState((s) => ({
    ...s,
    elements: pruneGroups(
      s.elements.map((e) => {
        const chain = groupsOf(e);
        if (!chain.length || !gids.has(chain[0]!)) return e;
        const rest = chain.slice(1);
        const next = { ...e };
        if (rest.length) next.groups = rest;
        else delete next.groups;
        return next;
      })
    ),
  }));
}

export function deleteSelection(): void {
  const st = getState();
  const pe = st.selection.pathEdit;
  if (pe && pe.kind === "anchor") {
    commit(() => {
      setState((s) => {
        const el = findElement(pe.pathId);
        if (!el || !("points" in el)) {
          return { ...s, selection: selectOnly(s.selection.elementIds) };
        }
        el.points.splice(pe.index, 1);
        let next: SceneElement | null = el;
        if (el.points.length < 2) next = null;
        else if (el.type !== "path" && el.points.length === 2) {
          next = simplifyPathIfStraight(toPathElement(el));
        }
        return {
          ...s,
          elements: next
            ? s.elements.map((x) => (x.id === el.id ? next : x))
            : s.elements.filter((x) => x.id !== el.id),
          selection: selectOnly(next ? [next.id] : []),
        };
      });
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

/** Copies elements with fresh ids and fresh group ids, offset by `off`. */
/**
 * Fresh copies of `elements`, shifted by `off`, in fresh groups. The copied groups keep their
 * names, returned by their new ids so the caller can add them to the document.
 */
export function copyElements(
  elements: readonly SceneElement[],
  off: number,
  groupNames: Readonly<Record<string, string>> = {}
): { copies: SceneElement[]; groupNames: Record<string, string> } {
  const groupMap = new Map<string, string>();
  const names: Record<string, string> = {};
  const remap = (gid: string) => {
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
      const { copies, groupNames } = copyElements(source, s.grid.step, s.groupNames);
      return {
        ...s,
        elements: [...s.elements, ...copies],
        groupNames: { ...s.groupNames, ...groupNames },
        selection: selectOnly(copies.map((c) => c.id)),
      };
    });
  });
}

export function nudgeSelection(dx: number, dy: number): void {
  if (!getState().selection.elementIds.length) return;
  commit(() =>
    mutate((s) => {
      for (const id of s.selection.elementIds) {
        const el = findElement(id);
        if (el) translateElement(el, dx, dy);
      }
    })
  );
}

/** After dragging an endpoint: close the shape onto itself, or join it to another. */
export function mergeDroppedEnd(el: SceneElement, idx: number, tol: number): void {
  const merged = closeByMerge(el, idx, tol);
  if (merged) {
    setState((s) => ({
      ...s,
      elements: s.elements.map((x) => (x.id === el.id ? merged : x)),
      selection: selectOnly([el.id]),
    }));
    return;
  }
  if (!canJoinEnds(el, idx)) return;
  const pair = ends(el);
  if (!pair) return;
  const dragged = pair[idx === 0 ? 0 : 1];
  for (const other of getState().elements) {
    if (other.id === el.id || !canJoin(other)) continue;
    const oe = ends(other);
    if (!oe?.some((p) => Math.hypot(p.x - dragged.x, p.y - dragged.y) <= tol)) continue;
    const joined = joinPaths(el, other, tol, tol);
    if (!joined) continue;
    setState((s) => ({
      ...s,
      elements: s.elements
        .filter((x) => x.id !== other.id)
        .map((x) => (x.id === el.id ? joined : x)),
      selection: selectOnly([joined.id]),
    }));
    return;
  }
}
