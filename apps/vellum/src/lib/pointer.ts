/** What kind of pointer is driving the app, so hit targets can be sized for it. */

let coarse: boolean | null = null;

/** Pointer target radius, screen pixels. Coarse is ~44px across, the usual touch minimum. */
export const HIT_R_FINE = 11;
export const HIT_R_COARSE = 22;
/** How far the rotate handle sits from the shape, screen pixels. */
export const ROTATE_REACH_FINE = 28;
export const ROTATE_REACH_COARSE = 48;

function query(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(pointer: coarse)");
}

/**
 * True on touch screens and other imprecise pointers. Answered on the first call rather than at
 * startup, because the initial state is built before anything has had a chance to set this up.
 */
export function isCoarsePointer(): boolean {
  if (coarse === null) coarse = query()?.matches ?? false;
  return coarse;
}

/**
 * How far a rect's extra handles - the corner radius one inside the top-right corner, the square
 * one outside the bottom-right - sit from the corner they work from, per axis, in screen pixels.
 *
 * Derived from the pointer's own target radius (see HIT_R_* in render.ts) rather than picked by
 * eye, so two handles can never share a target: they sit on the diagonal, which puts their
 * centres `inset * sqrt(2)` apart, which is both radii plus a little air.
 */
export function cornerHandleInset(): number {
  const targetR = isCoarsePointer() ? HIT_R_COARSE : HIT_R_FINE;
  return Math.round((targetR * 2 + 4) / Math.SQRT2);
}

export function initPointerKind(onChange: () => void): void {
  const mq = query();
  if (!mq) return;
  coarse = mq.matches;
  mq.addEventListener("change", (e) => {
    coarse = e.matches;
    onChange();
  });
}
