/**
 * Combining shapes: union, subtract, intersect and exclude, with curves kept as curves.
 *
 * Every outline is a loop of cubic segments (a straight one is a cubic whose controls sit on its
 * ends). The operation runs in four steps:
 *
 * 1. Every segment is cut wherever another one crosses or touches it, so no two pieces cross.
 * 2. Each piece is kept or dropped by what lies on either side of it: a point just to its left
 *    and one just to its right are tested against every operand, and the operation says whether
 *    each is inside the result. A piece with the result on one side only is part of its edge.
 *    Two shapes sharing an edge need no special case: both copies classify alike, and one goes.
 * 3. Kept pieces are turned so the result is on their left, and chained end to end into loops.
 *    With the inside always on the left, every loop winds the same way round what it encloses
 *    and the other way round a hole, so the non-zero rule fills the result exactly, whichever
 *    way the loops happened to be chained.
 * 4. Pieces cut from one segment and chained back to back are joined again, and straight pieces
 *    in line are merged, so a union of two squares does not leave points along its edges.
 */

import { contours, createPath, toPathElement } from "./model.js";
import type { Anchor, BBox, PathElement, Point, SceneElement, StyleCarrier } from "./types.js";

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

/** One cubic segment, and where it came from, so pieces of it can be joined again. */
interface Seg {
  a: Point;
  c1: Point;
  c2: Point;
  b: Point;
  line: boolean;
  /** The segment it was cut from, and the stretch of that segment it covers. */
  origin: number;
  t0: number;
  t1: number;
}

/** A shape as the operation sees it: its outlines, and how it fills where they overlap. */
interface Region {
  loops: Seg[][];
  evenOdd: boolean;
}

/* ---------- Cubic arithmetic ---------- */

function at(s: Seg, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.a.x + b * s.c1.x + c * s.c2.x + d * s.b.x,
    y: a * s.a.y + b * s.c1.y + c * s.c2.y + d * s.b.y,
  };
}

function tangent(s: Seg, t: number): Point {
  if (s.line) return { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
  const u = 1 - t;
  const d = {
    x: 3 * (u * u * (s.c1.x - s.a.x) + 2 * u * t * (s.c2.x - s.c1.x) + t * t * (s.b.x - s.c2.x)),
    y: 3 * (u * u * (s.c1.y - s.a.y) + 2 * u * t * (s.c2.y - s.c1.y) + t * t * (s.b.y - s.c2.y)),
  };
  // At a cusp the derivative vanishes; the chord still says which way the piece runs.
  return Math.hypot(d.x, d.y) > 1e-12 ? d : { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
}

const lerp = (p: Point, q: Point, t: number): Point => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
});

/** The stretch of `s` from `t0` to `t1`, as a cubic of its own (de Casteljau, twice). */
function sub(s: Seg, t0: number, t1: number): Seg {
  if (s.line) {
    const a = lerp(s.a, s.b, t0);
    const b = lerp(s.a, s.b, t1);
    return { ...s, a, b, c1: a, c2: b, t0: lerpT(s, t0), t1: lerpT(s, t1) };
  }
  const right = splitAt(s, t0)[1];
  const span = t0 < 1 ? (t1 - t0) / (1 - t0) : 0;
  const piece = splitAt(right, span)[0];
  return { ...piece, t0: lerpT(s, t0), t1: lerpT(s, t1) };
}

const lerpT = (s: Seg, t: number) => s.t0 + (s.t1 - s.t0) * t;

function splitAt(s: Seg, t: number): [Seg, Seg] {
  const p01 = lerp(s.a, s.c1, t);
  const p12 = lerp(s.c1, s.c2, t);
  const p23 = lerp(s.c2, s.b, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return [
    { ...s, a: s.a, c1: p01, c2: p012, b: m },
    { ...s, a: m, c1: p123, c2: p23, b: s.b },
  ];
}

function hull(s: Seg): BBox {
  const xs = [s.a.x, s.c1.x, s.c2.x, s.b.x];
  const ys = [s.a.y, s.c1.y, s.c2.y, s.b.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function overlaps(p: BBox, q: BBox, pad: number): boolean {
  return (
    p.x <= q.x + q.width + pad &&
    q.x <= p.x + p.width + pad &&
    p.y <= q.y + q.height + pad &&
    q.y <= p.y + p.height + pad
  );
}

/* ---------- Shapes in, shapes out ---------- */

/** Whether a shape encloses an area that can be combined: every closed-able outline does. */
export function canCombine(el: SceneElement): boolean {
  return ["path", "polygon", "polyline", "rect", "circle", "ellipse"].includes(el.type);
}

/** A shape's outlines as loops of cubics. An open outline is filled as if closed, as SVG does. */
function regionOf(el: SceneElement): Region {
  const path = toPathElement(el) as PathElement;
  const pts = path.points;
  const loops: Seg[][] = [];
  for (const { start, end } of contours(path)) {
    if (end - start < 2) continue;
    const loop: Seg[] = [];
    for (let i = start; i < end; i++) {
      const p = pts[i]!;
      const q = pts[i + 1 < end ? i + 1 : start]!;
      const c1 = p.hOut ?? p;
      const c2 = q.hIn ?? q;
      const line = c1.x === p.x && c1.y === p.y && c2.x === q.x && c2.y === q.y;
      if (p.x === q.x && p.y === q.y && line) continue;
      loop.push({ a: p, c1, c2, b: q, line, origin: 0, t0: 0, t1: 1 });
    }
    if (loop.length) loops.push(loop);
  }
  return { loops, evenOdd: el.fillRule === "evenodd" };
}

/* ---------- Inside or outside ---------- */

/** The parameters in (0, 1) where a cubic's y turns back: it is monotone in y between them. */
function yTurns(s: Seg): number[] {
  if (s.line) return [];
  // dy/dt = 3(A t^2 + B t + C), from the Bernstein form of the derivative.
  const p0 = s.a.y;
  const p1 = s.c1.y;
  const p2 = s.c2.y;
  const p3 = s.b.y;
  const A = -p0 + 3 * p1 - 3 * p2 + p3;
  const B = 2 * (p0 - 2 * p1 + p2);
  const C = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) roots.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      roots.push((-B + r) / (2 * A), (-B - r) / (2 * A));
    }
  }
  return roots.filter((t) => t > 1e-9 && t < 1 - 1e-9).sort((a, b) => a - b);
}

/**
 * How many times, and which way round, the region's outlines wind about `q`: a ray to the right
 * crossed by each outline, counted up or down by the way it crosses. Each segment is taken in
 * pieces over which its y only rises or only falls, and a crossing counts at its lower end but
 * not its upper one, so a ray through a point where two pieces meet counts it once.
 */
function winding(region: Region, q: Point): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const loop of region.loops) {
    for (const s of loop) {
      const ts = [0, ...yTurns(s), 1];
      for (let k = 0; k < ts.length - 1; k++) {
        const t0 = ts[k]!;
        const t1 = ts[k + 1]!;
        const p0 = k === 0 ? s.a : at(s, t0);
        const p1 = k === ts.length - 2 ? s.b : at(s, t1);
        if (p0.y === p1.y) continue;
        const up = p1.y > p0.y;
        const lo = up ? p0.y : p1.y;
        const hi = up ? p1.y : p0.y;
        if (q.y < lo || q.y >= hi) continue;
        // Where on this piece y reaches q.y: halve the interval until it is found.
        let a = t0;
        let b = t1;
        for (let it = 0; it < 60; it++) {
          const m = (a + b) / 2;
          const below = at(s, m).y < q.y;
          if (below === up) a = m;
          else b = m;
        }
        if (at(s, (a + b) / 2).x > q.x) {
          sum += up ? 1 : -1;
          count++;
        }
      }
    }
  }
  return { sum, count };
}

function inside(region: Region, q: Point): boolean {
  const w = winding(region, q);
  return region.evenOdd ? w.count % 2 === 1 : w.sum !== 0;
}

function resultAt(op: BooleanOp, regions: readonly Region[], q: Point): boolean {
  const ins = regions.map((r) => inside(r, q));
  switch (op) {
    case "union":
      return ins.some(Boolean);
    case "intersect":
      return ins.every(Boolean);
    case "subtract":
      return ins[0]! && !ins.slice(1).some(Boolean);
    case "exclude":
      return ins.filter(Boolean).length % 2 === 1;
  }
}

/* ---------- Cutting ---------- */

/** One place two segments meet: the parameter on each, and the one point both are cut at. */
interface Hit {
  ta: number;
  tb: number;
  p: Point;
}

function lineHits(s: Seg, r: Seg, tol: number): Hit[] {
  const d1 = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
  const d2 = { x: r.b.x - r.a.x, y: r.b.y - r.a.y };
  const cross = d1.x * d2.y - d1.y * d2.x;
  const len1 = Math.hypot(d1.x, d1.y);
  const len2 = Math.hypot(d2.x, d2.y);
  if (!len1 || !len2) return [];
  const w = { x: r.a.x - s.a.x, y: r.a.y - s.a.y };
  if (Math.abs(cross) <= 1e-12 * len1 * len2) {
    // Parallel: only lines on one line can meet, and then along a stretch - each is cut where
    // the other's ends fall on it.
    if (Math.abs(w.x * d1.y - w.y * d1.x) / len1 > tol) return [];
    const hits: Hit[] = [];
    const onS = (p: Point) => ((p.x - s.a.x) * d1.x + (p.y - s.a.y) * d1.y) / (len1 * len1);
    const onR = (p: Point) => ((p.x - r.a.x) * d2.x + (p.y - r.a.y) * d2.y) / (len2 * len2);
    for (const p of [r.a, r.b]) {
      const t = onS(p);
      if (t > -1e-9 && t < 1 + 1e-9) hits.push({ ta: t, tb: p === r.a ? 0 : 1, p });
    }
    for (const p of [s.a, s.b]) {
      const t = onR(p);
      if (t > -1e-9 && t < 1 + 1e-9) hits.push({ ta: p === s.a ? 0 : 1, tb: t, p });
    }
    return hits;
  }
  const ta = (w.x * d2.y - w.y * d2.x) / cross;
  const tb = (w.x * d1.y - w.y * d1.x) / cross;
  const eps = tol / Math.min(len1, len2);
  if (ta < -eps || ta > 1 + eps || tb < -eps || tb > 1 + eps) return [];
  return [{ ta, tb, p: lerp(s.a, s.b, Math.max(0, Math.min(1, ta))) }];
}

/**
 * Where two segments meet, by halving both until the pieces that still overlap are smaller than
 * `tol`. Segments that run along each other overlap everywhere; the work is capped for them, and
 * the cut is made where the run of meeting points starts and ends.
 */
function curveHits(s: Seg, r: Seg, tol: number): Hit[] {
  const found: Hit[] = [];
  let budget = 4000;
  const walk = (
    p: Seg,
    pa: number,
    pb: number,
    q: Seg,
    qa: number,
    qb: number,
    depth: number
  ): void => {
    if (budget-- <= 0) return;
    const hp = hull(p);
    const hq = hull(q);
    if (!overlaps(hp, hq, tol)) return;
    const small = (h: BBox) => Math.max(h.width, h.height) <= tol;
    if ((small(hp) && small(hq)) || depth > 50) {
      const ta = (pa + pb) / 2;
      const tb = (qa + qb) / 2;
      const m1 = at(s, ta);
      const m2 = at(r, tb);
      found.push({ ta, tb, p: { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 } });
      return;
    }
    const pm = (pa + pb) / 2;
    const qm = (qa + qb) / 2;
    const [p1, p2] = small(hp) ? [p, null] : splitAt(p, 0.5);
    const [q1, q2] = small(hq) ? [q, null] : splitAt(q, 0.5);
    const ps: [Seg, number, number][] = p2
      ? [
          [p1, pa, pm],
          [p2, pm, pb],
        ]
      : [[p1, pa, pb]];
    const qs: [Seg, number, number][] = q2
      ? [
          [q1, qa, qm],
          [q2, qm, qb],
        ]
      : [[q1, qa, qb]];
    for (const [pp, a0, a1] of ps)
      for (const [qq, b0, b1] of qs) walk(pp, a0, a1, qq, b0, b1, depth + 1);
  };
  walk(s, 0, 1, r, 0, 1, 0);
  if (!found.length) return [];
  // Close meeting points are one meeting; a long run of them is two curves on top of each other.
  found.sort((x, y) => x.ta - y.ta);
  const clusters: Hit[][] = [];
  for (const h of found) {
    const last = clusters[clusters.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && Math.hypot(h.p.x - prev.p.x, h.p.y - prev.p.y) <= tol * 4) last!.push(h);
    else clusters.push([h]);
  }
  return clusters.flatMap((c) =>
    c.length <= 2 ? [c[Math.floor(c.length / 2)]!] : [c[0]!, c[c.length - 1]!]
  );
}

/**
 * Every segment of every operand, cut wherever another meets it. At each cut both segments end
 * on the very same point - the other's end when the meeting is at one - so the pieces chain
 * exactly.
 */
function cutAll(regions: readonly Region[], tol: number): { seg: Seg; op: number }[] {
  const all: { seg: Seg; op: number }[] = [];
  regions.forEach((r, op) =>
    r.loops.forEach((loop) => loop.forEach((seg) => all.push({ seg, op })))
  );
  all.forEach((x, i) => (x.seg = { ...x.seg, origin: i }));
  const cuts: Map<number, Point>[] = all.map(() => new Map());
  const hulls = all.map((x) => hull(x.seg));
  const clampT = (t: number) => (t < 1e-9 ? 0 : t > 1 - 1e-9 ? 1 : t);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (!overlaps(hulls[i]!, hulls[j]!, tol)) continue;
      const s = all[i]!.seg;
      const r = all[j]!.seg;
      const hits = s.line && r.line ? lineHits(s, r, tol) : curveHits(s, r, tol);
      for (const h of hits) {
        // Neighbouring segments meet at the corner they share, and the search finds that corner
        // a hair along one of them: a meeting that close to an end is the end.
        const near = (p: Point) => samePoint(h.p, p, tol * 100);
        const ta = near(s.a) ? 0 : near(s.b) ? 1 : clampT(h.ta);
        const tb = near(r.a) ? 0 : near(r.b) ? 1 : clampT(h.tb);
        // A meeting at a segment's end is that end, exactly.
        const p = ta === 0 ? s.a : ta === 1 ? s.b : tb === 0 ? r.a : tb === 1 ? r.b : h.p;
        if (ta > 0 && ta < 1) cuts[i]!.set(ta, p);
        if (tb > 0 && tb < 1) cuts[j]!.set(tb, p);
      }
    }
  }
  const pieces: { seg: Seg; op: number }[] = [];
  all.forEach(({ seg, op }, i) => {
    const ts = [...cuts[i]!.keys()].sort((a, b) => a - b);
    let from = 0;
    let fromPoint = seg.a;
    for (const t of [...ts, 1]) {
      if (t - from < 1e-9) continue;
      const piece = sub(seg, from, t);
      piece.a = fromPoint;
      piece.b = t === 1 ? seg.b : cuts[i]!.get(t)!;
      if (piece.line) {
        piece.c1 = piece.a;
        piece.c2 = piece.b;
      }
      // A piece with no length is no edge: the next one starts where this one would have.
      const h = hull(piece);
      if (Math.max(h.width, h.height) <= tol * 10) continue;
      pieces.push({ seg: piece, op });
      from = t;
      fromPoint = piece.b;
    }
  });
  return pieces;
}

/* ---------- Chaining ---------- */

function reverse(s: Seg): Seg {
  return { ...s, a: s.b, c1: s.c2, c2: s.c1, b: s.a, t0: s.t1, t1: s.t0 };
}

const samePoint = (p: Point, q: Point, tol: number) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;

/** Chains pieces that each keep the result on their left into closed loops. */
function chain(pieces: Seg[], tol: number): Seg[][] {
  const unused = new Set(pieces.map((_, i) => i));
  const loops: Seg[][] = [];
  const key = (p: Point) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const byStart = new Map<string, number[]>();
  pieces.forEach((s, i) => {
    const k = key(s.a);
    byStart.set(k, [...(byStart.get(k) ?? []), i]);
  });
  const next = (p: Point): number | undefined => {
    const [gx, gy] = [Math.round(p.x / tol), Math.round(p.y / tol)];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of byStart.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (unused.has(i) && samePoint(pieces[i]!.a, p, tol)) return i;
        }
      }
    }
    return undefined;
  };
  while (unused.size) {
    const first = unused.values().next().value as number;
    unused.delete(first);
    const loop = [pieces[first]!];
    for (let guard = 0; guard < pieces.length; guard++) {
      const end = loop[loop.length - 1]!.b;
      if (samePoint(end, loop[0]!.a, tol)) break;
      const i = next(end);
      if (i === undefined) break;
      unused.delete(i);
      loop.push(pieces[i]!);
    }
    // A loop that could not be closed is a sliver left by rounding; it encloses nothing.
    if (samePoint(loop[loop.length - 1]!.b, loop[0]!.a, tol * 4)) loops.push(loop);
  }
  return loops;
}

/** Joins back what cutting separated: pieces of one segment in a row, and lines in line. */
function tidy(loop: Seg[], tol: number, source: readonly Seg[]): Seg[] {
  const out: Seg[] = [];
  const joinable = (p: Seg, q: Seg): Seg | null => {
    if (p.line && q.line) {
      const d1 = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
      const d2 = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
      const cross = d1.x * d2.y - d1.y * d2.x;
      const dot = d1.x * d2.x + d1.y * d2.y;
      const scale = Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y);
      if (dot > 0 && Math.abs(cross) <= 1e-9 * scale) return { ...p, b: q.b, c2: q.b };
      return null;
    }
    // Two pieces of one curve, running on from each other the same way: one piece again.
    if (!p.line && !q.line && p.origin === q.origin && Math.abs(p.t1 - q.t0) < 1e-9) {
      const src = source[p.origin]!;
      const lo = Math.min(p.t0, q.t1);
      const hi = Math.max(p.t0, q.t1);
      let joined = sub({ ...src, t0: 0, t1: 1 }, lo, hi);
      if (p.t0 > q.t1) joined = reverse(joined);
      return { ...joined, a: p.a, b: q.b, origin: p.origin, t0: p.t0, t1: q.t1 };
    }
    return null;
  };
  for (const s of loop) {
    const last = out[out.length - 1];
    const joined = last ? joinable(last, s) : null;
    if (joined) out[out.length - 1] = joined;
    else out.push(s);
  }
  // The loop's last piece may run on into its first.
  while (out.length > 1) {
    const joined = joinable(out[out.length - 1]!, out[0]!);
    if (!joined) break;
    out.pop();
    out[0] = joined;
  }
  return out.filter((s) => !samePoint(s.a, s.b, tol) || !s.line);
}

/** Whether two handles at a point run on through it: a smooth point. */
function inLine(p: Point, hIn: Point, hOut: Point): boolean {
  const a = { x: p.x - hIn.x, y: p.y - hIn.y };
  const b = { x: hOut.x - p.x, y: hOut.y - p.y };
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (!la || !lb) return false;
  return Math.abs(a.x * b.y - a.y * b.x) / (la * lb) < 1e-3 && a.x * b.x + a.y * b.y > 0;
}

function loopToAnchors(loop: Seg[]): Anchor[] {
  return loop.map((s, i) => {
    const prev = loop[(i + loop.length - 1) % loop.length]!;
    const hIn = prev.line ? null : { x: prev.c2.x, y: prev.c2.y };
    const hOut = s.line ? null : { x: s.c1.x, y: s.c1.y };
    return {
      x: s.a.x,
      y: s.a.y,
      smooth: !!hIn && !!hOut && inLine(s.a, hIn, hOut),
      hIn,
      hOut,
    };
  });
}

/* ---------- The operation ---------- */

/**
 * `op` applied to `elements`, in the order given (subtract takes the rest from the first), as
 * one path in `style`, or null when nothing is left.
 */
export function combine(
  elements: readonly SceneElement[],
  op: BooleanOp,
  style: StyleCarrier
): PathElement | null {
  const regions = elements.filter(canCombine).map(regionOf);
  if (regions.length < 2) return null;
  let box: BBox | null = null;
  for (const r of regions) {
    for (const loop of r.loops) {
      for (const s of loop) {
        const h = hull(s);
        if (!box) box = { ...h };
        else {
          const x = Math.min(box.x, h.x);
          const y = Math.min(box.y, h.y);
          box = {
            x,
            y,
            width: Math.max(box.x + box.width, h.x + h.width) - x,
            height: Math.max(box.y + box.height, h.y + h.height) - y,
          };
        }
      }
    }
  }
  if (!box) return null;
  const scale = Math.max(box.width, box.height, 1e-6);
  const tol = scale * 1e-7;
  const pieces = cutAll(regions, tol);
  const source = pieces.map((p) => p.seg);
  // The segments before cutting, in the order `cutAll` numbered them: `tidy` re-cuts from these.
  const uncut: Seg[] = [];
  regions.forEach((r) => r.loops.forEach((loop) => loop.forEach((s) => uncut.push(s))));

  const eps = scale * 1e-5;
  const kept: Seg[] = [];
  const seen: Seg[] = [];
  for (const s of source) {
    const m = at(s, 0.5);
    const d = tangent(s, 0.5);
    const len = Math.hypot(d.x, d.y) || 1;
    // With y running down the page, (d.y, -d.x) points to the left of the direction of travel.
    const n = { x: d.y / len, y: -d.x / len };
    const left = resultAt(op, regions, { x: m.x + n.x * eps, y: m.y + n.y * eps });
    const right = resultAt(op, regions, { x: m.x - n.x * eps, y: m.y - n.y * eps });
    if (left === right) continue;
    const piece = left ? s : reverse(s);
    // A shared edge arrives twice, once from each shape; the second is the same edge again.
    const mid = at(piece, 0.5);
    const dup = seen.some(
      (o) =>
        samePoint(o.a, piece.a, tol * 10) &&
        samePoint(o.b, piece.b, tol * 10) &&
        samePoint(at(o, 0.5), mid, tol * 10)
    );
    if (dup) continue;
    seen.push(piece);
    kept.push(piece);
  }
  const loops = chain(kept, tol * 10)
    .map((loop) => tidy(loop, tol * 10, uncut))
    .filter((loop) => loop.length >= 2 || (loop.length === 1 && !loop[0]!.line));
  if (!loops.length) return null;
  const points: Anchor[] = [];
  const subpaths: number[] = [];
  for (const loop of loops) {
    if (points.length) subpaths.push(points.length);
    points.push(...loopToAnchors(loop));
  }
  const { fillRule: _rule, ...rest } = style;
  const path = createPath(points, true, rest);
  if (subpaths.length) path.subpaths = subpaths;
  return path;
}
