import { describe, expect, test } from "bun:test";
import { createRect } from "./model.js";
import {
  assignGroupHuesInPlace,
  nextGroupHue,
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

  test("a member at the edge of its group stays put, and says so", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1"), el("d")];
    expect(ids(moveWithinParent(list, "c", 1, false))).toBe("a b c d");
    expect(ids(moveWithinParent(list, "c", 1, true))).toBe("a b c d");
    expect(ids(moveWithinParent(list, "b", -1, false))).toBe("a b c d");
    expect(canMoveWithinParent(list, "c", 1)).toBe(false);
    expect(canMoveWithinParent(list, "b", -1)).toBe(false);
    expect(canMoveWithinParent(list, "b", 1)).toBe(true);
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

  test("a nested group moves among its siblings and stops at its parent's edge", () => {
    const list = [el("a", "g1"), el("b", "g1", "g2"), el("c", "g1", "g2"), el("d")];
    expect(ids(moveGroup(list, "g2", -1, false))).toBe("b c a d");
    expect(ids(moveGroup(list, "g2", 1, false))).toBe("a b c d");
    expect(canMoveGroup(list, "g2", 1)).toBe(false);
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

describe("the arrows stop at the edge of a group", () => {
  // A group has a row of its own with its own arrows, so a member never moves it.
  test("the first member of a group cannot go up, and moving it does nothing", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1")];
    expect(ids(moveWithinParent(list, "b", -1, false))).toBe("a b c");
    expect(canMoveWithinParent(list, "b", -1)).toBe(false);
  });

  test("the last member cannot go down", () => {
    const list = [el("a", "g1"), el("b", "g1"), el("c")];
    expect(ids(moveWithinParent(list, "b", 1, false))).toBe("a b c");
    expect(canMoveWithinParent(list, "b", 1)).toBe(false);
  });

  test("the first member of a nested group stays inside it", () => {
    const list = [el("a", "g1"), el("b", "g1", "g2"), el("c", "g1", "g2"), el("d")];
    expect(ids(moveWithinParent(list, "b", -1, false))).toBe("a b c d");
    expect(canMoveWithinParent(list, "b", -1)).toBe(false);
  });

  test("a loose element still steps over a whole group", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1")];
    expect(ids(moveWithinParent(list, "a", 1, false))).toBe("b c a");
  });

  test("canMoveSelectionZ knows when the selection is already at an end", () => {
    const list = [el("a"), el("b", "g1"), el("c", "g1")];
    expect(canMoveSelectionZ(list, new Set(["a"]), -1)).toBe(false);
    expect(canMoveSelectionZ(list, new Set(["a"]), 1)).toBe(true);
    expect(canMoveSelectionZ(list, new Set(["b", "c"]), 1)).toBe(false);
    expect(canMoveSelectionZ(list, new Set(["b", "c"]), -1)).toBe(true);
  });
});

describe("group colours", () => {
  test("a group keeps its colour when groups are reordered", () => {
    const list = [el("a", "g1"), el("b", "g1"), el("c", "g2"), el("d", "g2")];
    const hues: Record<string, number> = {};
    assignGroupHuesInPlace(list, hues);
    const before = { ...hues };
    const moved = moveGroup(list, "g2", -1, false);
    assignGroupHuesInPlace(moved, hues);
    expect(hues).toEqual(before);
  });

  test("every group gets a colour well apart from the others", () => {
    const list = Array.from({ length: 8 }, (_, i) => [
      el(`a${i}`, `g${i}`),
      el(`b${i}`, `g${i}`),
    ]).flat();
    const hues: Record<string, number> = {};
    assignGroupHuesInPlace(list, hues);
    const values = Object.values(hues);
    expect(values).toHaveLength(8);
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const d = Math.abs(values[i]! - values[j]!) % 360;
        expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(30);
      }
    }
  });

  test("a new group avoids the colours already in use, not just the next one in line", () => {
    // The first hue in the sequence is taken, so the next group must not reuse it.
    const first = nextGroupHue([]);
    expect(nextGroupHue([first])).not.toBe(first);
  });
});
