import { describe, expect, test } from "bun:test";
import { findJsonError, formatJson, parseJson, positionAt } from "./json.js";

function errorAt(text: string) {
  const r = parseJson(text);
  if (r.ok) throw new Error(`expected ${JSON.stringify(text)} to fail`);
  return r;
}

describe("parseJson", () => {
  test("valid JSON parses to the same value as JSON.parse", () => {
    const text = '{"a":[1,2.5e3,-0.1,true,false,null,"x\\u00e9\\n"],"b":{}}';
    const r = parseJson(text);
    expect(r.ok && r.value).toEqual(JSON.parse(text));
  });

  test("a trailing comma is reported at the closing bracket", () => {
    const r = errorAt('{\n  "a": 1,\n}');
    expect(r.message).toMatch(/Trailing comma/);
    expect(r.position).toEqual({ offset: 12, line: 3, column: 1 });
  });

  test("single quotes get a message that says so", () => {
    expect(errorAt("{'a': 1}").message).toMatch(/[Kk]ey|double quotes/);
    expect(errorAt("['a']").message).toMatch(/double quotes/);
  });

  test("a missing comma points at the next value", () => {
    const r = errorAt("[1 2]");
    expect(r.position.offset).toBe(3);
  });

  test("an unterminated string points at the end", () => {
    const r = errorAt('{"a": "b');
    expect(r.message).toMatch(/Unterminated/);
    expect(r.position.offset).toBe(8);
  });

  test("garbage after the value is reported", () => {
    expect(errorAt("{} x").position.offset).toBe(3);
  });

  test("empty input fails at offset 0", () => {
    expect(errorAt("").position).toEqual({ offset: 0, line: 1, column: 1 });
  });
});

describe("findJsonError agrees with JSON.parse", () => {
  const samples = [
    "0",
    "-0",
    "01",
    "1.",
    ".5",
    "1e",
    "1e+2",
    "tru",
    "nul",
    "[",
    "]",
    "{,}",
    '{"a"}',
    '{"a":}',
    '"\\x"',
    '"\\u12"',
    '"a\tb"',
    "[1,]",
    "[,1]",
    '{"a":1 "b":2}',
    "  [ ]  ",
    '"\\/"',
  ];
  test.each(samples)("%p", (text) => {
    let valid = true;
    try {
      JSON.parse(text);
    } catch {
      valid = false;
    }
    expect(findJsonError(text) === null).toBe(valid);
  });
});

describe("formatJson", () => {
  test("indents by two spaces by default, and 0 minifies", () => {
    expect(formatJson({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(formatJson({ a: [1] }, { indent: 0 })).toBe('{"a":[1]}');
  });

  test("sorts keys at every depth, leaving arrays in order", () => {
    expect(formatJson({ b: 1, a: { d: 1, c: [3, 1] } }, { indent: 0, sortKeys: true })).toBe(
      '{"a":{"c":[3,1],"d":1},"b":1}'
    );
  });
});

test("positionAt counts lines and columns from 1", () => {
  expect(positionAt("ab\ncd", 4)).toEqual({ offset: 4, line: 2, column: 2 });
});
