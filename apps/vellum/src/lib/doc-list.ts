/**
 * What the Documents list knows about a document beyond its name: the tags given to it, what is
 * in it, and whether it matches a search. Plain data in, plain data out.
 */

import type { ProjectFile } from "./types.js";

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
 * Whether a document matches what was typed in the search: every word of it, ignoring case, is
 * found in the name or in one of the tags. An empty search matches everything.
 */
export function matchesSearch(doc: { name: string; tags?: readonly string[] }, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystacks = [doc.name, ...(doc.tags ?? [])].map((s) => s.toLowerCase());
  return words.every((w) => haystacks.some((h) => h.includes(w)));
}
