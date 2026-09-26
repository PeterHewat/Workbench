/**
 * Sticky stand-ins for modifier keys, for a pointer with no keyboard to hold them on.
 *
 * Shift adds to a selection and Alt aligns to other shapes; a finger has neither. These are the
 * same two behaviours as switches that stay on until switched off. They belong to the session,
 * not the drawing: they are kept out of the editor state so that undo never flips them back.
 */

import { setState } from "./state.js";

let selectMore = false;
let alignSnap = false;

/** Taps add shapes to the selection, or take them out, instead of replacing it (Shift). */
export function isSelectMore(): boolean {
  return selectMore;
}

export function setSelectMore(on: boolean): void {
  if (selectMore === on) return;
  selectMore = on;
  setState({});
}

/** Points snap to other shapes' points, as with Alt held, instead of to the grid. */
export function isAlignSnap(): boolean {
  return alignSnap;
}

/**
 * The two snaps are one choice: a point lands on the grid or on another shape's line, never both,
 * so switching this on switches grid snap off. Alt held borrows it without touching either switch.
 */
export function setAlignSnap(on: boolean): void {
  if (alignSnap === on) return;
  alignSnap = on;
  setState((s) => (on && s.grid.snap ? { ...s, grid: { ...s.grid, snap: false } } : { ...s }));
}
