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
