/**
 * JSON parsing that says *where* it failed, the same way in every browser.
 *
 * `JSON.parse` does the parsing; its error messages differ between engines and some carry no
 * position at all. When it throws, a small scanner walks the text to the first offending
 * character, so the tools can put the caret on it.
 */

export interface JsonPosition {
  /** 0-based offset into the text. */
  offset: number;
  /** 1-based, as editors count. */
  line: number;
  column: number;
}

export type JsonResult =
  { ok: true; value: unknown } | { ok: false; message: string; position: JsonPosition };

export function positionAt(text: string, offset: number): JsonPosition {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { offset, line, column: offset - lineStart + 1 };
}

export function parseJson(text: string): JsonResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const found = findJsonError(text);
    const message = found?.message ?? (err instanceof Error ? err.message : String(err));
    return { ok: false, message, position: positionAt(text, found?.offset ?? 0) };
  }
}

export interface FormatOptions {
  /** Spaces per level, or 0 for one line. Defaults to 2. */
  indent?: number;
  /** Sort object keys alphabetically, recursively. */
  sortKeys?: boolean;
}

export function formatJson(
  value: unknown,
  { indent = 2, sortKeys = false }: FormatOptions = {}
): string {
  return JSON.stringify(sortKeys ? sortDeep(value) : value, null, indent || undefined);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

class Stop {
  constructor(
    readonly message: string,
    readonly offset: number
  ) {}
}

/** The first syntax error in `text`, or null if it is valid JSON. */
export function findJsonError(text: string): { message: string; offset: number } | null {
  let i = 0;
  const describe = (at: number) => (at >= text.length ? "end of input" : `"${text[at]}"`);
  const fail = (what: string, at = i): never => {
    throw new Stop(`Expected ${what} but found ${describe(at)}`, at);
  };
  const space = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const literal = (word: string) => {
    for (let k = 0; k < word.length; k++) {
      if (text[i + k] !== word[k]) fail(`"${word}"`, i + k);
    }
    i += word.length;
  };
  const string = () => {
    i++; // opening quote
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
            throw new Stop("Invalid \\u escape: needs four hex digits", i);
          }
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          i += 2;
        } else {
          throw new Stop(`Invalid escape "\\${e ?? ""}"`, i);
        }
        continue;
      }
      if (c < " ") throw new Stop("Control character in string: escape it", i);
      i++;
    }
    throw new Stop("Unterminated string", text.length);
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail("a number");
    i += m![0].length;
  };
  const value = (): void => {
    space();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "t") return literal("true");
    if (c === "f") return literal("false");
    if (c === "n") return literal("null");
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return number();
    if (c === "'") throw new Stop("Strings need double quotes, not single", i);
    fail("a value");
  };
  const object = () => {
    i++;
    space();
    if (text[i] === "}") {
      i++;
      return;
    }
    for (;;) {
      space();
      if (text[i] === "}") throw new Stop("Trailing comma before }", i);
      if (text[i] !== '"') fail("a double-quoted key");
      string();
      space();
      if (text[i] !== ":") fail('":"');
      i++;
      value();
      space();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return;
      }
      fail('"," or "}"');
    }
  };
  const array = () => {
    i++;
    space();
    if (text[i] === "]") {
      i++;
      return;
    }
    for (;;) {
      space();
      if (text[i] === "]") throw new Stop("Trailing comma before ]", i);
      value();
      space();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return;
      }
      fail('"," or "]"');
    }
  };

  try {
    value();
    space();
    if (i < text.length) fail("end of input");
    return null;
  } catch (e) {
    if (e instanceof Stop) return { message: e.message, offset: e.offset };
    throw e;
  }
}
