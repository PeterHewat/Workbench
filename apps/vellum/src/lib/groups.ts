/**
 * Groups, as a flat list.
 *
 * Every element carries `groups`: the ids of the groups that contain it, outermost first. Two
 * elements are in the same group when their chains share that prefix, so nesting needs no tree
 * and z-order stays what it has always been - the order of `elements`.
 *
 * The one invariant everything else relies on: the members of a group are **contiguous**. An
 * `<g>` in SVG cannot be interleaved with anything else, so a group split across the list would
 * export as two separate `<g>` elements. Reordering therefore moves whole blocks, never a single
 * member out of its group, and `normalizeGroups` repairs a list that arrived out of order.
 */

import type { SceneElement } from "./types.js";

/** A half-open range of `elements`. */
export interface Block {
  start: number;
  end: number;
}

export function groupsOf(el: SceneElement | undefined): readonly string[] {
  return el?.groups ?? [];
}

/** The outermost group of an element, which is what selecting it selects. */
export function outerGroup(el: SceneElement | undefined): string | null {
  return groupsOf(el)[0] ?? null;
}

function samePrefix(a: readonly string[], b: readonly string[], depth: number): boolean {
  for (let i = 0; i < depth; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The run of elements around `index` that share its first `depth` groups. */
export function groupRange(elements: readonly SceneElement[], index: number, depth: number): Block {
  if (depth <= 0) return { start: 0, end: elements.length };
  const chain = groupsOf(elements[index]);
  let start = index;
  let end = index + 1;
  while (start > 0 && samePrefix(groupsOf(elements[start - 1]), chain, depth)) start--;
  while (end < elements.length && samePrefix(groupsOf(elements[end]), chain, depth)) end++;
  return { start, end };
}

/**
 * The blocks one level inside `range`: each is a nested group, or a single element that sits
 * directly in the containing group.
 */
export function childBlocks(
  elements: readonly SceneElement[],
  range: Block,
  depth: number
): Block[] {
  const out: Block[] = [];
  let i = range.start;
  while (i < range.end) {
    const key = groupsOf(elements[i])[depth];
    if (key == null) {
      out.push({ start: i, end: i + 1 });
      i += 1;
      continue;
    }
    let j = i;
    while (j < range.end && groupsOf(elements[j])[depth] === key) j += 1;
    out.push({ start: i, end: j });
    i = j;
  }
  return out;
}

/** The blocks of the whole document: top-level groups, and elements outside any group. */
export function topLevelBlocks(elements: readonly SceneElement[]): Block[] {
  return childBlocks(elements, { start: 0, end: elements.length }, 0);
}

function flatten(elements: readonly SceneElement[], blocks: readonly Block[]): SceneElement[] {
  const out: SceneElement[] = [];
  for (const b of blocks) for (let i = b.start; i < b.end; i++) out.push(elements[i]!);
  return out;
}

export type ZDirection = "forward" | "back" | "front" | "backmost";

function reorderBlocks(blocks: Block[], picked: boolean[], direction: ZDirection): Block[] {
  const chosen = blocks.filter((_, i) => picked[i]);
  const rest = blocks.filter((_, i) => !picked[i]);
  if (direction === "front") return [...rest, ...chosen];
  if (direction === "backmost") return [...chosen, ...rest];
  const next = [...blocks];
  const swap = (i: number, j: number) => {
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    const p = picked[i]!;
    picked[i] = picked[j]!;
    picked[j] = p;
  };
  if (direction === "forward") {
    for (let i = next.length - 2; i >= 0; i--) if (picked[i] && !picked[i + 1]) swap(i, i + 1);
  } else {
    for (let i = 1; i < next.length; i++) if (picked[i] && !picked[i - 1]) swap(i, i - 1);
  }
  return next;
}

/** Moves whole top-level blocks in z-order, so a group travels as one. */
export function moveSelectionZ(
  elements: readonly SceneElement[],
  selectedIds: ReadonlySet<string>,
  direction: ZDirection
): SceneElement[] {
  const blocks = topLevelBlocks(elements);
  const picked = blocks.map((b) => {
    for (let i = b.start; i < b.end; i++) if (selectedIds.has(elements[i]!.id)) return true;
    return false;
  });
  if (!picked.some(Boolean)) return [...elements];
  return flatten(elements, reorderBlocks(blocks, picked, direction));
}

/**
 * The level a block moves within: the siblings of the block that holds `index` at `depth` -
 * the element itself when `depth` is its whole chain, or one of its groups when it is less.
 */
function siblingsAt(
  elements: readonly SceneElement[],
  index: number,
  depth: number
): { range: Block; blocks: Block[]; at: number } {
  const range = groupRange(elements, index, depth);
  const blocks = childBlocks(elements, range, depth);
  return { range, blocks, at: blocks.findIndex((b) => index >= b.start && index < b.end) };
}

function hasRoom(blocks: readonly Block[], at: number, dir: -1 | 1): boolean {
  return at >= 0 && (dir < 0 ? at > 0 : at < blocks.length - 1);
}

function moveFrom(
  elements: readonly SceneElement[],
  index: number,
  depth: number,
  dir: -1 | 1,
  toEnd: boolean
): SceneElement[] {
  const { range, blocks, at } = siblingsAt(elements, index, depth);
  if (!hasRoom(blocks, at, dir)) return [...elements];
  const direction: ZDirection = toEnd
    ? dir < 0
      ? "backmost"
      : "front"
    : dir < 0
      ? "back"
      : "forward";
  const picked = blocks.map((_, i) => i === at);
  const moved = flatten(elements, reorderBlocks(blocks, picked, direction));
  return [...elements.slice(0, range.start), ...moved, ...elements.slice(range.end)];
}

function canMoveFrom(
  elements: readonly SceneElement[],
  index: number,
  depth: number,
  dir: -1 | 1
): boolean {
  const { blocks, at } = siblingsAt(elements, index, depth);
  return hasRoom(blocks, at, dir);
}

/**
 * Moves one element among its siblings - the other members of the group that directly contains
 * it, with a nested group counting as one sibling. An element never leaves its group this way,
 * and at the edge of its group it stays put: the group has a row of its own to move it by.
 */
export function moveWithinParent(
  elements: readonly SceneElement[],
  id: string,
  dir: -1 | 1,
  toEnd: boolean
): SceneElement[] {
  const index = elements.findIndex((e) => e.id === id);
  if (index < 0) return [...elements];
  return moveFrom(elements, index, groupsOf(elements[index]).length, dir, toEnd);
}

/** Whether `moveWithinParent` would change anything, so the arrow can be disabled when not. */
export function canMoveWithinParent(
  elements: readonly SceneElement[],
  id: string,
  dir: -1 | 1
): boolean {
  const index = elements.findIndex((e) => e.id === id);
  if (index < 0) return false;
  return canMoveFrom(elements, index, groupsOf(elements[index]).length, dir);
}

/** Where a group starts in the list, and how deep it sits: its place in its members' chains. */
function groupAt(elements: readonly SceneElement[], gid: string): { index: number; depth: number } {
  const index = elements.findIndex((e) => groupsOf(e).includes(gid));
  return { index, depth: index < 0 ? -1 : groupsOf(elements[index]).indexOf(gid) };
}

/**
 * Moves a whole group among its siblings as one block, by the same rule as an element: it stays
 * inside the group that holds it, and stops at that group's edge.
 */
export function moveGroup(
  elements: readonly SceneElement[],
  gid: string,
  dir: -1 | 1,
  toEnd: boolean
): SceneElement[] {
  const { index, depth } = groupAt(elements, gid);
  if (index < 0) return [...elements];
  return moveFrom(elements, index, depth, dir, toEnd);
}

export function canMoveGroup(elements: readonly SceneElement[], gid: string, dir: -1 | 1): boolean {
  const { index, depth } = groupAt(elements, gid);
  return index >= 0 && canMoveFrom(elements, index, depth, dir);
}

/** Whether the selection has anywhere to go in z-order, for the same reason. */
export function canMoveSelectionZ(
  elements: readonly SceneElement[],
  selectedIds: ReadonlySet<string>,
  dir: -1 | 1
): boolean {
  const blocks = topLevelBlocks(elements);
  const picked = blocks.map((b) => {
    for (let i = b.start; i < b.end; i++) if (selectedIds.has(elements[i]!.id)) return true;
    return false;
  });
  // A block moves when the neighbour it would swap with is not itself part of the selection.
  return picked.some((p, i) => p && !picked[i + (dir < 0 ? -1 : 1)] && blocks[i + dir] != null);
}

/**
 * Rebuilds the list so every group's members sit together, keeping the order they first appear
 * in. Import and paste can hand us interleaved groups; everything downstream assumes they are not.
 */
export function normalizeGroups(elements: readonly SceneElement[]): SceneElement[] {
  const level = (items: readonly SceneElement[], depth: number): SceneElement[] => {
    const order: string[] = [];
    const buckets = new Map<string, SceneElement[]>();
    items.forEach((el, i) => {
      const gid = groupsOf(el)[depth];
      // An element with no group at this depth is its own bucket, so its place is kept.
      const key = gid == null ? `solo:${i}` : `g:${gid}`;
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(key);
      }
      buckets.get(key)!.push(el);
    });
    return order.flatMap((key) => {
      const bucket = buckets.get(key)!;
      return key.startsWith("g:") && bucket.length > 1 ? level(bucket, depth + 1) : bucket;
    });
  };
  return level(elements, 0);
}

/**
 * Group ids that hold only one thing, and so hold nothing: a group of one element, and a group
 * whose entire content is one other group. Both are a `<g>` around a single child, which in a
 * model where a group carries nothing but its membership says exactly as much as no group at all.
 *
 * Measured by what sits one level in from each id: if every member of a group continues into the
 * same nested group, or there is only one member, that id has a single child.
 */
function redundantGroupIds(elements: readonly SceneElement[]): Set<string> {
  const children = new Map<string, Set<string>>();
  for (const el of elements) {
    const chain = groupsOf(el);
    chain.forEach((gid, depth) => {
      let set = children.get(gid);
      if (!set) children.set(gid, (set = new Set()));
      // An element that does not continue into a nested group is a child in its own right.
      set.add(chain[depth + 1] ?? `only:${el.id}`);
    });
  }
  const redundant = new Set<string>();
  for (const [gid, kids] of children) if (kids.size < 2) redundant.add(gid);
  return redundant;
}

/** Drops the groups that hold only one thing, returning a new list. */
export function pruneGroups(elements: readonly SceneElement[]): SceneElement[] {
  const gone = redundantGroupIds(elements);
  if (!gone.size) return [...elements];
  return elements.map((el) => {
    const chain = groupsOf(el);
    if (!chain.some((gid) => gone.has(gid))) return el;
    const kept = chain.filter((gid) => !gone.has(gid));
    const next = { ...el };
    if (kept.length) next.groups = kept;
    else delete next.groups;
    return next;
  });
}

/**
 * The same rule, applied in place.
 *
 * Deleting members of a group used to leave the survivor still carrying the group id - a group
 * of one, which exports as a `<g>` around a single shape and behaves like a group when you
 * select it. This runs on every state change, so the moment a group is down to one child it
 * stops being a group, whatever emptied it.
 */
export function pruneGroupsInPlace(elements: SceneElement[]): void {
  const gone = redundantGroupIds(elements);
  if (!gone.size) return;
  for (const el of elements) {
    const chain = groupsOf(el);
    if (!chain.some((gid) => gone.has(gid))) continue;
    const kept = chain.filter((gid) => !gone.has(gid));
    if (kept.length) el.groups = kept;
    else delete el.groups;
  }
}

/** Every element whose outermost group is one of the outermost groups of `ids`. */
export function expandToGroups(
  elements: readonly SceneElement[],
  ids: readonly string[]
): string[] {
  const wanted = new Set(
    elements
      .filter((e) => ids.includes(e.id))
      .map(outerGroup)
      .filter((g): g is string => !!g)
  );
  const out = new Set(ids);
  if (wanted.size) {
    for (const el of elements) {
      const g = outerGroup(el);
      if (g && wanted.has(g)) out.add(el.id);
    }
  }
  return [...out];
}

/**
 * What a click on element `id` picks: the elements it selects, and the group they make up (null
 * for the element alone).
 *
 * From outside a group a click takes the whole outermost group, as it always has. Once you are
 * inside one - everything selected sits in the same group - a click on another of its members
 * picks that member, or the nested group holding it, so you can go from one member to the next
 * without climbing back out.
 */
export function clickTarget(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>,
  id: string
): { ids: string[]; gid: string | null } {
  const chain = groupsOf(elements.find((e) => e.id === id));
  const chains = elements.filter((e) => selected.has(e.id)).map(groupsOf);
  let depth = 0;
  while (depth < chain.length && chains.length && chains.every((c) => c[depth] === chain[depth])) {
    depth++;
  }
  return levelTarget(elements, id, chain, depth);
}

/** Level `depth` of `id`'s chain: group `chain[depth]`, or the element alone past its end. */
function levelTarget(
  elements: readonly SceneElement[],
  id: string,
  chain: readonly string[],
  depth: number
): { ids: string[]; gid: string | null } {
  const gid = chain[depth];
  if (gid == null) return { ids: [id], gid: null };
  return { ids: elements.filter((e) => groupsOf(e).includes(gid)).map((e) => e.id), gid };
}

/**
 * What a click on an element that is already selected steps down to: when the selection is
 * exactly one of the groups holding it, the next level in - the nested group holding it, or the
 * element itself. Null when there is nothing further in, and the selection should stay as it is.
 */
export function drillTarget(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>,
  id: string
): { ids: string[]; gid: string | null } | null {
  const chain = groupsOf(elements.find((e) => e.id === id));
  for (let depth = 0; depth < chain.length; depth++) {
    const level = levelTarget(elements, id, chain, depth);
    if (level.ids.length === selected.size && level.ids.every((x) => selected.has(x))) {
      return levelTarget(elements, id, chain, depth + 1);
    }
  }
  return null;
}

/**
 * The level a selection works at: the groups that hold everything selected without being
 * selected whole themselves, outermost first. Empty for a selection made from the top, as it is
 * whenever whole groups are picked; a member picked inside a group has that group as context,
 * so grouping, ungrouping and merging it stay inside the group rather than tearing it open.
 */
export function selectionContext(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): string[] {
  const chains = elements.filter((e) => selected.has(e.id)).map(groupsOf);
  if (!chains.length) return [];
  const context: string[] = [];
  for (let depth = 0; ; depth++) {
    const gid = chains[0]![depth];
    if (gid == null || !chains.every((c) => c[depth] === gid)) break;
    if (elements.every((e) => !groupsOf(e).includes(gid) || selected.has(e.id))) break;
    context.push(gid);
  }
  return context;
}

/**
 * Runs `fn` on the members of the group that `context` ends in, as if that group were the whole
 * document - `context` taken off the front of their chains - and puts the result back in its
 * place. With an empty context, `fn` sees the document itself.
 */
function withinContext(
  elements: readonly SceneElement[],
  context: readonly string[],
  fn: (inner: SceneElement[]) => SceneElement[]
): SceneElement[] {
  if (!context.length) return fn([...elements]);
  const inside = (e: SceneElement) => samePrefix(groupsOf(e), context, context.length);
  const start = elements.findIndex(inside);
  if (start < 0) return [...elements];
  let end = start;
  while (end < elements.length && inside(elements[end]!)) end++;
  const inner = elements.slice(start, end).map((e) => {
    const next = { ...e };
    const rest = groupsOf(e).slice(context.length);
    if (rest.length) next.groups = rest;
    else delete next.groups;
    return next;
  });
  const back = fn(inner).map((e) => ({ ...e, groups: [...context, ...groupsOf(e)] }));
  return [...elements.slice(0, start), ...back, ...elements.slice(end)];
}

/** The selection's elements with its context stripped, for the checks below. */
function innerSelection(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): SceneElement[] {
  const depth = selectionContext(elements, selected).length;
  return elements
    .filter((e) => selected.has(e.id))
    .map((e) => ({ ...e, groups: groupsOf(e).slice(depth) }));
}

/**
 * Wraps the selection in a new group `gid`, placed where the frontmost selected element was.
 * Groups selected whole nest inside it rather than being flattened; a selection made inside a
 * group gets its new group inside that one.
 */
export function groupElements(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>,
  gid: string
): SceneElement[] {
  return withinContext(elements, selectionContext(elements, selected), (inner) => {
    const lastIdx = Math.max(...inner.map((e, i) => (selected.has(e.id) ? i : -1)));
    const rest = inner.filter((e) => !selected.has(e.id));
    const before = inner.slice(0, lastIdx + 1).filter((e) => !selected.has(e.id)).length;
    const grouped = inner
      .filter((e) => selected.has(e.id))
      .map((e) => ({ ...e, groups: [gid, ...groupsOf(e)] }));
    return normalizeGroups([...rest.slice(0, before), ...grouped, ...rest.slice(before)]);
  });
}

/** Whether grouping would add anything: two or more things, and not exactly one group already. */
export function canGroup(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): boolean {
  const sel = innerSelection(elements, selected);
  const outer = new Set(sel.map((e) => outerGroup(e) ?? ""));
  return sel.length >= 2 && !(outer.size === 1 && !outer.has(""));
}

/** Takes off the outermost group of the selection, at its level; groups inside it stay. */
export function ungroupElements(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): SceneElement[] {
  return withinContext(elements, selectionContext(elements, selected), (inner) => {
    const gids = new Set(
      inner
        .filter((e) => selected.has(e.id))
        .map(outerGroup)
        .filter((g): g is string => !!g)
    );
    return pruneGroups(
      inner.map((e) => {
        const chain = groupsOf(e);
        if (!chain.length || !gids.has(chain[0]!)) return e;
        const next = { ...e };
        if (chain.length > 1) next.groups = chain.slice(1);
        else delete next.groups;
        return next;
      })
    );
  });
}

export function canUngroup(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): boolean {
  return innerSelection(elements, selected).some((e) => groupsOf(e).length);
}

/**
 * What a merge would act on: the selected elements plus the rest of their outermost groups, and
 * those groups. A merge takes whole groups, so a member picked alone from the list brings its
 * group along rather than splitting it.
 */
function mergeScope(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): { merging: string[]; involved: (el: SceneElement) => boolean; blocks: number } {
  const merging = [
    ...new Set(
      elements
        .filter((e) => selected.has(e.id))
        .map(outerGroup)
        .filter((g): g is string => !!g)
    ),
  ];
  const outer = new Set(merging);
  const involved = (el: SceneElement) => selected.has(el.id) || outer.has(outerGroup(el) ?? "");
  const keys = new Set(elements.filter(involved).map((e) => outerGroup(e) ?? `el:${e.id}`));
  return { merging, involved, blocks: keys.size };
}

/** Whether `mergeGroups` would change anything: a group, and at least one other thing with it. */
export function canMergeGroups(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): boolean {
  let can = false;
  withinContext(elements, selectionContext(elements, selected), (inner) => {
    const { merging, blocks } = mergeScope(inner, selected);
    can = merging.length > 0 && blocks > 1;
    return inner;
  });
  return can;
}

/**
 * Puts everything selected into one group, without adding a level: loose shapes join the group,
 * and several groups become one. Only the outermost level merges - groups nested inside the
 * merged ones stay as they were.
 *
 * The surviving group is the backmost named one, so a name is not lost to an unnamed group, or
 * else simply the backmost. The result sits where the frontmost selected thing was, as a new
 * group does, since its members must end up contiguous and anything unselected between them has
 * to land on one side.
 */
export function mergeGroups(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>,
  groupNames: Readonly<Record<string, string>> = {}
): SceneElement[] {
  return withinContext(elements, selectionContext(elements, selected), (inner) =>
    mergeAtTop(inner, selected, groupNames)
  );
}

function mergeAtTop(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>,
  groupNames: Readonly<Record<string, string>>
): SceneElement[] {
  const { merging, involved, blocks } = mergeScope(elements, selected);
  if (!merging.length || blocks < 2) return [...elements];
  const target = merging.find((gid) => groupNames[gid]) ?? merging[0]!;
  const outer = new Set(merging);
  let last = -1;
  elements.forEach((e, i) => {
    if (involved(e)) last = i;
  });
  const rest = elements.filter((e) => !involved(e));
  const before = elements.slice(0, last + 1).filter((e) => !involved(e)).length;
  const merged = elements.filter(involved).map((e) => {
    const chain = groupsOf(e);
    const inner = chain.length && outer.has(chain[0]!) ? chain.slice(1) : chain;
    return { ...e, groups: [target, ...inner] };
  });
  return normalizeGroups([...rest.slice(0, before), ...merged, ...rest.slice(before)]);
}

/** Closest two group hues may be, in degrees, before they read as the same colour. */
const HUE_GAP = 30;

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/**
 * The hue for a new group: the first step of the golden-angle sequence that is at least
 * `HUE_GAP` from every hue already in use, or, when none is left that far away, the one that
 * stands furthest from its nearest neighbour.
 */
export function nextGroupHue(taken: readonly number[]): number {
  let best = 210;
  let bestGap = -1;
  for (let k = 0; k < 64; k++) {
    const hue = Math.round((210 + k * 137.508) % 360);
    const gap = taken.length ? Math.min(...taken.map((t) => hueDistance(t, hue))) : 360;
    if (gap >= HUE_GAP) return hue;
    if (gap > bestGap) {
      best = hue;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Gives every group in `elements` a hue of its own, in place, and leaves the ones it has alone:
 * a group keeps its colour wherever it moves, and only a group new to the document gets one.
 * Runs on every state change, like `pruneGroupsInPlace`, so no command has to remember it.
 */
export function assignGroupHuesInPlace(
  elements: readonly SceneElement[],
  hues: Record<string, number>
): void {
  const live = new Set(elements.flatMap((e) => groupsOf(e)));
  const missing = [...live].filter((gid) => hues[gid] == null);
  if (!missing.length) return;
  const taken = [...live].filter((gid) => hues[gid] != null).map((gid) => hues[gid]!);
  for (const gid of missing) {
    const hue = nextGroupHue(taken);
    hues[gid] = hue;
    taken.push(hue);
  }
}

/** A group's colour, from its hue: the same in the Primitives list and on the canvas. */
export function groupColor(hue: number): string {
  return `hsl(${hue} 65% 62%)`;
}

/**
 * The groups every member of which is selected, with their members: what the canvas draws a
 * group box around and the SVG panel highlights a `<g>` for.
 */
export function selectedGroups(
  elements: readonly SceneElement[],
  selected: ReadonlySet<string>
): Map<string, SceneElement[]> {
  const members = new Map<string, SceneElement[]>();
  for (const el of elements) {
    for (const gid of groupsOf(el)) {
      const list = members.get(gid);
      if (list) list.push(el);
      else members.set(gid, [el]);
    }
  }
  for (const [gid, list] of members) {
    if (!list.every((e) => selected.has(e.id))) members.delete(gid);
  }
  return members;
}
