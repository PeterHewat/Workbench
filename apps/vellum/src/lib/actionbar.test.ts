import { describe, expect, test } from "bun:test";
import { paginate, type Action } from "./actionbar.js";

const act = (key: string, danger = false): Action => ({ key, label: key, danger, run: () => {} });
const keys = (list: readonly Action[]) => list.map((a) => a.key);

describe("the bar's rows", () => {
  test("a set that fits is shown as it is", () => {
    const set = ["a", "b", "c", "d", "e", "f", "g"].map((k) => act(k));
    expect(keys(paginate(set).row)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  test("a longer set keeps delete in the row, after a way to the rest", () => {
    const set = [...["a", "b", "c", "d", "e", "f", "g"].map((k) => act(k)), act("delete", true)];
    const { row, rest } = paginate(set);
    expect(keys(row)).toEqual(["a", "b", "c", "d", "e", "page-more", "delete"]);
    expect(keys(rest)).toEqual(["f", "g"]);
    expect(keys(row[5]!.menu!())).toEqual(["f", "g"]);
  });

  test("without a delete, the row fills up to the more button", () => {
    const set = ["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => act(k));
    expect(keys(paginate(set).row)).toEqual(["a", "b", "c", "d", "e", "f", "page-more"]);
  });
});
