/**
 * Elliptical arcs as cubic Béziers.
 *
 * The scene graph has one curve type - the cubic with two handles per anchor - which is what
 * makes point editing uniform. Arcs therefore become cubics: on import for an `A` command, and
 * in the arc tool for a fresh one. Four pieces per full turn keeps the error far below what is
 * visible at any zoom this tool reaches.
 */

import { createPath } from "./model.js";
import type { Anchor, PathElement, Point, StyleCarrier } from "./types.js";

export interface CubicSegment {
  c1: Point;
  c2: Point;
  to: Point;
}

/**
 * An elliptical arc as cubic Béziers, following the endpoint-to-centre conversion in the SVG
 * specification. Each piece covers at most a quarter turn, where a cubic matches an ellipse to
 * well under a tenth of a unit at the sizes this tool works at.
 */
export function arcToCubics(
  from: Point,
  rxIn: number,
  ryIn: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point
): CubicSegment[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  // A zero radius, or no distance to cover, means the arc is just a straight line.
  if (!rx || !ry || (from.x === to.x && from.y === to.y)) {
    return [{ c1: { ...from }, c2: { ...to }, to: { ...to } }];
  }
  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;

  // Radii too small to span the endpoints are scaled up until they just reach, per the spec.
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const centre = {
    x: cosPhi * cx1 - sinPhi * cy1 + (from.x + to.x) / 2,
    y: sinPhi * cx1 + cosPhi * cy1 + (from.y + to.y) / 2,
  };

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, len ? dot / len : 1)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let sweepAngle = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  else if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  // The epsilon keeps an exact quarter or half turn from rounding up to an extra segment.
  const steps = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2) - 1e-9));
  const step = sweepAngle / steps;
  // The control-point distance that makes a cubic follow a circular arc of this angle.
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): Point => ({
    x: centre.x + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
    y: centre.y + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
  });
  const derivative = (t: number): Point => ({
    x: -rx * Math.sin(t) * cosPhi - ry * Math.cos(t) * sinPhi,
    y: -rx * Math.sin(t) * sinPhi + ry * Math.cos(t) * cosPhi,
  });

  const out: CubicSegment[] = [];
  for (let n = 0; n < steps; n++) {
    const t0 = start + n * step;
    const t1 = t0 + step;
    const p0 = at(t0);
    const p1 = at(t1);
    const d0 = derivative(t0);
    const d1 = derivative(t1);
    out.push({
      c1: { x: p0.x + k * d0.x, y: p0.y + k * d0.y },
      c2: { x: p1.x - k * d1.x, y: p1.y - k * d1.y },
      to: p1,
    });
  }
  // The last point is recomputed from the angle; snap it back to the exact endpoint asked for.
  const lastSeg = out[out.length - 1];
  if (lastSeg) lastSeg.to = { ...to };
  return out;
}

/**
 * A path along an arc from `from` to `to`, bulging by `sweepDegrees` of turn. The tool draws the
 * chord and picks the radius that gives that much of a turn; after that it is an ordinary path,
 * so reshaping it means dragging its handles like any other curve.
 */
export function createArcPath(
  from: Point,
  to: Point,
  sweepDegrees: number,
  clockwise: boolean,
  style: StyleCarrier = {}
): PathElement | null {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  if (chord < 1e-6) return null;
  const theta = (Math.min(359, Math.max(1, sweepDegrees)) * Math.PI) / 180;
  const radius = chord / (2 * Math.sin(theta / 2));
  const segments = arcToCubics(from, radius, radius, 0, theta > Math.PI, clockwise, to);

  const points: Anchor[] = [
    { x: from.x, y: from.y, smooth: true, hIn: { ...from }, hOut: { ...from } },
  ];
  for (const seg of segments) {
    const last = points[points.length - 1]!;
    last.hOut = { ...seg.c1 };
    points.push({
      x: seg.to.x,
      y: seg.to.y,
      smooth: true,
      hIn: { ...seg.c2 },
      hOut: { ...seg.to },
    });
  }
  return createPath(points, false, style);
}
