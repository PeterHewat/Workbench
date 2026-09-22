import { describe, expect, test } from "bun:test";
import { createRect } from "./model.js";
import {
  canMoveSelectionZ,
  canMoveGroup,
  canMoveWithinParent,
  moveGroup,
  moveSelectionZ,
  moveWithinParent,
  normalizeGroups,
  pruneGroups,
  pruneGroupsInPlace,
  expandToGroups,
  topLevelBlocks,
} from "./groups.js";
import type { SceneElement } from "./types.js";

/** A rect named `id`, in the given groups (outermost first). */
function el(id: string, ...groups: string[]): SceneElement {
  const rect = createRect(0, 0, 1, 1);
  rect.id = id;
  rect.name = id;
  if (groups.length) rect.groups = groups;
  return rect;
}

const ids = (list: readonly SceneElement[]) => list.map((e) => e.id).join(" ");

describe("blocks", () => {
  test("a group counts as one top-level block", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1"), el("d")];
    expect(topLevelBlocks(list)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
      { start: 3, end: 4 },
    ]);
  });
});

describe("moveSelectionZ", () => {
  test("moves a whole group, never one member out of it", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1"), el("d")];
    expect(ids(moveSelectionZ(list, new Set(["b", "c"]), "forward"))).toBe("a d b c");
    expect(ids(moveSelectionZ(list, new Set(["b"]), "back"))).toBe("b c a d");
  });

  test("front and back keep the group together too", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1"), el("d")];
    expect(ids(moveSelectionZ(list, new Set(["c"]), "front"))).toBe("a d b c");
    expect(ids(moveSelectionZ(list, new Set(["c"]), "backmost"))).toBe("b c a d");
  });

  test("a loose element steps over a group in one move", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1")];
    expect(ids(moveSelectionZ(list, new Set(["a"]), "forward"))).toBe("b c a");
  });
});

describe("moveWithinParent", () => {
  test("reorders inside the group without leaving it", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1"), el("d", "g1")];
    expect(ids(moveWithinParent(list, "b", 1, false))).toBe("a c b d");
    expect(ids(moveWithinParent(list, "d", -1, false))).toBe("a b d c");
  });

  test("a member at the edge takes its group with it rather than leaving it", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1"), el("d")];
    // c is last inside g1, so the whole group steps over d; c is still beside b.
    expect(ids(moveWithinParent(list, "c", 1, false))).toBe("a d b c");
    expect(ids(moveWithinParent(list, "c", 1, true))).toBe("a d b c");
  });

  test("a nested group moves as one sibling", () => {
    const list = [el("a", "g1"), el("b", "g1", "g2"), el("c", "g1", "g2"), el("d", "g1")];
    expect(ids(moveWithinParent(list, "a", 1, false))).toBe("b c a d");
  });
});

describe("moveGroup", () => {
  test("a top-level group steps over its neighbour as one block", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1"), el("d")];
    expect(ids(moveGroup(list, "g1", 1, false))).toBe("a d b c");
    expect(ids(moveGroup(list, "g1", -1, false))).toBe("b c a d");
  });

  test("Shift sends it to the end", () => {
    const list = [el("a"), el("b"), el("c", "g1"), el("d", "g1")];
    expect(ids(moveGroup(list, "g1", -1, true))).toBe("c d a b");
  });

  test("a nested group moves among its siblings, then widens to its parent at the edge", () => {
    const list = [el("a", "g1"), el("b", "g1", "g2"), el("c", "g1", "g2"), el("d")];
    expect(ids(moveGroup(list, "g2", -1, false))).toBe("b c a d");
    // Already last inside g1: the move takes g1 past d.
    expect(ids(moveGroup(list, "g2", 1, false))).toBe("d a b c");
  });

  test("says when there is nowhere to go", () => {
    const list = [el("b", "g1"), el("c", "g1"), el("d")];
    expect(canMoveGroup(list, "g1", -1)).toBe(false);
    expect(canMoveGroup(list, "g1", 1)).toBe(true);
    expect(canMoveGroup(list, "nope", 1)).toBe(false);
  });
});

describe("normalizeGroups", () => {
  test("gathers a split group back together, keeping first-seen order", () => {
    const list = [el("a", "g1"), el("b"), el("c", "g1")];
    expect(ids(normalizeGroups(list))).toBe("a c b");
  });

  test("nested groups are gathered at every level", () => {
    const list = [el("a", "g1", "g2"), el("b", "g1"), el("c", "g1", "g2")];
    expect(ids(normalizeGroups(list))).toBe("a c b");
  });

  test("elements outside any group keep their places", () => {
    const list = [el("a"), el("b"), el("c")];
    expect(ids(normalizeGroups(list))).toBe("a b c");
  });
});

describe("a group that holds one thing is not a group", () => {
  test("deleting all but one member leaves the survivor loose", () => {
    const list = [el("a", "g1"), el("b", "g1"), el("c")];
    const after = pruneGroups(list.filter((e) => e.id !== "b"));
    expect(after.map((e) => e.groups)).toEqual([undefined, undefined]);
  });

  test("in place, the same rule, for the pass that runs on every change", () => {
    const list = [el("a", "g1"), el("b", "g1"), el("c", "g2"), el("d", "g2")];
    list.splice(1, 1); // b goes
    pruneGroupsInPlace(list);
    expect(list.map((e) => e.groups)).toEqual([undefined, ["g2"], ["g2"]]);
  });

  test("an emptied inner group goes while the outer one stays", () => {
    const list = [el("a", "g1", "g2"), el("b", "g1", "g2"), el("c", "g1")];
    list.splice(1, 1); // one of the two members of g2 goes
    pruneGroupsInPlace(list);
    expect(list.map((e) => e.groups)).toEqual([["g1"], ["g1"]]);
  });

  test("a group whose whole content is one other group collapses into it", () => {
    const list = [el("a", "g1", "g2"), el("b", "g1", "g2")];
    pruneGroupsInPlace(list);
    expect(list.map((e) => e.groups)).toEqual([["g2"], ["g2"]]);
  });

  test("an outer group with a second child of its own stays", () => {
    const list = [el("a", "g1", "g2"), el("b", "g1", "g2"), el("c", "g1")];
    pruneGroupsInPlace(list);
    expect(list.map((e) => e.groups)).toEqual([["g1", "g2"], ["g1", "g2"], ["g1"]]);
  });
});

describe("pruneGroups", () => {
  test("a group of one is dropped", () => {
    const [only] = pruneGroups([el("a", "g1")]);
    expect(only!.groups).toBeUndefined();
  });

  test("an outer group holding only the inner one is dropped", () => {
    const out = pruneGroups([el("a", "g1", "g2"), el("b", "g1", "g2")]);
    expect(out[0]!.groups).toEqual(["g2"]);
  });
});

describe("expandToGroups", () => {
  test("picking one member picks the whole outermost group", () => {
    const list = [el("a"), el("b", "g1", "g2"), el("c", "g1")];
    expect(expandToGroups(list, ["b"]).sort()).toEqual(["b", "c"]);
  });

  test("a loose element stays alone", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1")];
    expect(expandToGroups(list, ["a"])).toEqual(["a"]);
  });
});

describe("the arrows widen when there is no room left", () => {
  test("the first member of a group moves the whole group up instead of nothing", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1")];
    expect(ids(moveWithinParent(list, "b", -1, false))).toBe("b c a");
  });

  test("the last member moves the whole group down", () => {
    const list = [el("a", "g1"), el("b", "g1"), el("c")];
    expect(ids(moveWithinParent(list, "b", 1, false))).toBe("c a b");
  });

  test("a nested group escalates one level at a time", () => {
    const list = [el("a", "g1"), el("b", "g1", "g2"), el("c", "g1", "g2"), el("d")];
    // b is first inside g2, so the move widens to g2 inside g1: g2 steps over a.
    expect(ids(moveWithinParent(list, "b", -1, false))).toBe("b c a d");
    // From there the next press widens again, taking the whole of g1 past d.
    const next = moveWithinParent(list, "b", -1, false);
    expect(ids(moveWithinParent(next, "b", -1, false))).toBe("b c a d");
  });

  test("at the very top there is genuinely nowhere to go", () => {
    const list = [el("a", "g1"), el("b", "g1"), el("c")];
    expect(ids(moveWithinParent(list, "a", -1, false))).toBe("a b c");
    expect(canMoveWithinParent(list, "a", -1)).toBe(false);
    expect(canMoveWithinParent(list, "a", 1)).toBe(true);
  });

  test("canMoveSelectionZ knows when the selection is already at an end", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1")];
    expect(canMoveSelectionZ(list, new Set(["a"]), -1)).toBe(false);
    expect(canMoveSelectionZ(list, new Set(["a"]), 1)).toBe(true);
    expect(canMoveSelectionZ(list, new Set(["b", "c"]), 1)).toBe(false);
    expect(canMoveSelectionZ(list, new Set(["b", "c"]), -1)).toBe(true);
  });
});
