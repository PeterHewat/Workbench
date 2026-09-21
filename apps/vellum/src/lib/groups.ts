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

/** The innermost group, which is what the Primitives list marks with a colour. */
export function innerGroup(el: SceneElement | undefined): string | null {
  const chain = groupsOf(el);
  return chain.length ? chain[chain.length - 1]! : null;
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

/** The widening blocks around an element: itself, then the group holding it, and so on out. */
function blockLadder(
  elements: readonly SceneElement[],
  index: number
): { depth: number; range: Block; blocks: Block[]; at: number }[] {
  const out: { depth: number; range: Block; blocks: Block[]; at: number }[] = [];
  for (let depth = groupsOf(elements[index]).length; depth >= 0; depth--) {
    const range = groupRange(elements, index, depth);
    const blocks = childBlocks(elements, range, depth);
    const at = blocks.findIndex((b) => index >= b.start && index < b.end);
    if (at >= 0) out.push({ depth, range, blocks, at });
  }
  return out;
}

/**
 * Moves one element among its siblings - the other members of the group that directly contains
 * it, with a nested group counting as one sibling. An element never leaves its group this way.
 *
 * When it is already at the edge of its group there is nowhere left to go at that level, so the
 * move widens: the group itself steps past whatever is beyond it, and so on outwards. That keeps
 * the arrows from going dead while there is still somewhere to move, and it is the only way to
 * reorder a group, since the list has rows for elements rather than for groups.
 */
export function moveWithinParent(
  elements: readonly SceneElement[],
  id: string,
  dir: -1 | 1,
  toEnd: boolean
): SceneElement[] {
  const index = elements.findIndex((e) => e.id === id);
  if (index < 0) return [...elements];
  const direction: ZDirection = toEnd
    ? dir < 0
      ? "backmost"
      : "front"
    : dir < 0
      ? "back"
      : "forward";
  for (const level of blockLadder(elements, index)) {
    const room = dir < 0 ? level.at > 0 : level.at < level.blocks.length - 1;
    if (!room) continue;
    const picked = level.blocks.map((_, i) => i === level.at);
    const moved = flatten(elements, reorderBlocks(level.blocks, picked, direction));
    return [...elements.slice(0, level.range.start), ...moved, ...elements.slice(level.range.end)];
  }
  return [...elements];
}

/** Whether `moveWithinParent` would change anything, so the arrow can be disabled when not. */
export function canMoveWithinParent(
  elements: readonly SceneElement[],
  id: string,
  dir: -1 | 1
): boolean {
  const index = elements.findIndex((e) => e.id === id);
  if (index < 0) return false;
  return blockLadder(elements, index).some((level) =>
    dir < 0 ? level.at > 0 : level.at < level.blocks.length - 1
  );
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
