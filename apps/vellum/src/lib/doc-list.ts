/**
 * What the Documents list knows about a document beyond its name: the tags given to it, what is
 * in it, and whether it matches a search. Plain data in, plain data out.
 */

import type { ProjectFile } from "./types.js";
import { escapeXml } from "./utils.js";

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 32;

/**
 * Tags from what was typed ("icons, arrows") or read from a file: trimmed, inner spaces single,
 * each at most 32 characters, no empties, and no repeats - "Icons" and "icons" are one tag, the
 * first spelling kept. Anything that is not a string or a list of strings gives none.
 */
export function cleanTags(raw: unknown): string[] {
  const parts =
    typeof raw === "string"
      ? raw.split(",")
      : Array.isArray(raw)
        ? raw.filter((t): t is string => typeof t === "string")
        : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    // Control characters have no business in a label.
    const printable = [...part].filter((c) => c >= " " && c !== "\u007f").join("");
    const tag = printable.replace(/\s+/g, " ").trim();
    const clipped = tag.slice(0, MAX_TAG_LENGTH).trim();
    const key = clipped.toLowerCase();
    if (!clipped || seen.has(key)) continue;
    seen.add(key);
    out.push(clipped);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

export interface DocStats {
  shapes: number;
  groups: number;
  /** Points that can be picked and moved: a path's anchors, a polyline's vertices, a line's ends. */
  points: number;
  images: number;
  width: number;
  height: number;
}

export function docStats(
  data: Pick<ProjectFile, "elements" | "images" | "artboard"> | null | undefined
): DocStats {
  const elements = data?.elements ?? [];
  const groups = new Set<string>();
  let points = 0;
  for (const el of elements) {
    for (const g of el.groups ?? []) groups.add(g);
    if (el.type === "path" || el.type === "polyline" || el.type === "polygon") {
      points += el.points.length;
    } else if (el.type === "line") {
      points += 2;
    }
  }
  return {
    shapes: elements.length,
    groups: groups.size,
    points,
    images: data?.images?.length ?? 0,
    width: data?.artboard?.width ?? 0,
    height: data?.artboard?.height ?? 0,
  };
}

/** The stats as the row shows them: what there is, and nothing that is none. */
export function statsText(s: DocStats): string {
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    count(s.shapes, "shape"),
    s.groups ? count(s.groups, "group") : "",
    s.points ? count(s.points, "point") : "",
    s.images ? count(s.images, "reference image") : "",
    `${Math.round(s.width)} × ${Math.round(s.height)}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * A file's size as the row shows it: bytes under a kilobyte, then kilobytes and megabytes to one
 * decimal (of 1024), written close up - "850B", "6.7KB".
 */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const one = (n: number) => String(Math.round(n * 10) / 10);
  const kb = bytes / 1024;
  return kb < 1024 ? `${one(kb)}KB` : `${one(kb / 1024)}MB`;
}

/**
 * A search as typed: commas separate alternatives, spaces the words of one - "arrow icons, logo"
 * is (arrow and icons) or logo. Lower case, empties dropped; nothing typed is no alternative.
 */
export function parseSearch(query: string): string[][] {
  return query
    .toLowerCase()
    .split(",")
    .map((alt) => alt.split(/\s+/).filter(Boolean))
    .filter((alt) => alt.length);
}

/**
 * Whether a document matches a search: for one of its alternatives, every word is found in the
 * name or in one of the tags, ignoring case. An empty search matches everything.
 */
export function matchesSearch(
  doc: { name: string; tags?: readonly string[] },
  query: string
): boolean {
  const alts = parseSearch(query);
  if (!alts.length) return true;
  const haystacks = [doc.name, ...(doc.tags ?? [])].map((s) => s.toLowerCase());
  return alts.some((words) => words.every((w) => haystacks.some((h) => h.includes(w))));
}

/** Every word of a search, for marking where they are found. */
export const searchWords = (query: string): string[] => [...new Set(parseSearch(query).flat())];

/** The stretches of `text` where any of the words is found, ignoring case, merged and in order. */
export function findRanges(text: string, words: readonly string[]): [number, number][] {
  const lower = text.toLowerCase();
  const hits: [number, number][] = [];
  for (const w of words) {
    for (let at = lower.indexOf(w); at >= 0; at = lower.indexOf(w, at + 1)) {
      hits.push([at, at + w.length]);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of hits) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/** `text`, escaped, with each found stretch in a `<mark>`. */
export function markHtml(text: string, words: readonly string[]): string {
  let out = "";
  let from = 0;
  for (const [s, e] of findRanges(text, words)) {
    out += escapeXml(text.slice(from, s)) + `<mark>${escapeXml(text.slice(s, e))}</mark>`;
    from = e;
  }
  return out + escapeXml(text.slice(from));
}

/** The tags in which a word of the search is found. */
export function tagsHit(tags: readonly string[] | undefined, words: readonly string[]): string[] {
  return (tags ?? []).filter((t) => findRanges(t, words).length);
}
