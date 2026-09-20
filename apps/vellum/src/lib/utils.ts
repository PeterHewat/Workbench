import { ELEMENT_TYPES, type ElementType, type Point } from "./types.js";

const ELEMENT_TYPE_SET: ReadonlySet<string> = new Set(ELEMENT_TYPES);

/** `path,line,rect,…` — for querySelectorAll on an imported document. */
export const ELEMENT_SELECTOR = ELEMENT_TYPES.join(",");

/** Matches a generated default name: "path 1", "rect_2", … */
export const AUTO_NAME_RE = new RegExp(`^(${ELEMENT_TYPES.join("|")})[ _](\\d+)$`);

export function isElementType(type: string): type is ElementType {
  return ELEMENT_TYPE_SET.has(type);
}

/** A name the app generated, as opposed to one the user typed. */
export function isDefaultName(name: string | undefined): boolean {
  return !name || AUTO_NAME_RE.test(name);
}

/** Element ids are 8 hex chars starting with a letter (valid as an XML id); others keep a prefix. */
export function uid(prefix = "el"): string {
  const hex = crypto.randomUUID().slice(0, 8);
  if (ELEMENT_TYPE_SET.has(prefix)) {
    return "abcdef"[parseInt(hex[0]!, 16) % 6] + hex.slice(1);
  }
  return `${prefix}-${hex}`;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Escapes XML/HTML content. Quotes are left as-is so attribute regexes still match the result. */
export function escapeXml(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes a value going into a double-quoted attribute. */
export function escapeAttr(s: unknown): string {
  return escapeXml(s).replace(/"/g, "&quot;");
}
