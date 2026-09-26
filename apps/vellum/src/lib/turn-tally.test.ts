import { beforeEach, describe, expect, test } from "bun:test";
import { addTurn, forgetTurns, turnedBy } from "./turn-tally.js";

describe("turn tally", () => {
  beforeEach(forgetTurns);

  test("adds up the turns of one set, whatever order its ids come in", () => {
    addTurn(["a", "b"], 5);
    addTurn(["b", "a"], 15);
    expect(turnedBy(["a", "b"])).toBe(20);
  });

  test("another set starts from 0, and the first is forgotten", () => {
    addTurn(["a"], 30);
    expect(turnedBy(["b"])).toBe(0);
    addTurn(["b"], 10);
    expect(turnedBy(["b"])).toBe(10);
    expect(turnedBy(["a"])).toBe(0);
  });

  test("forgetting puts every set back to 0", () => {
    addTurn(["a"], 30);
    forgetTurns();
    expect(turnedBy(["a"])).toBe(0);
  });
});
