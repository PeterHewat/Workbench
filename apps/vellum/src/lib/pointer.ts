/** What kind of pointer is driving the app, so hit targets can be sized for it. */

let coarse: boolean | null = null;

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

/** True where hovering is impossible, so hover-only affordances must not be the only route. */
export function hasHover(): boolean {
  const mq =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(hover: hover)")
      : null;
  return mq ? mq.matches : true;
}

/**
 * How far inside a rect's top-right corner its radius handle sits, in screen pixels. Touch needs
 * the extra distance so the radius handle and the corner handle do not share the same target.
 */
export function cornerHandleInset(): number {
  return isCoarsePointer() ? 40 : 14;
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
