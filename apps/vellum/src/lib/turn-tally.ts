/**
 * How far the shapes of a group - or of a selection turned as one - have been rotated since they
 * were chosen. A group keeps no angle (every turn is baked into its members' coordinates), so the
 * Rotate field would otherwise read 0 again after every entry. Instead it reads this running
 * total, and typing a new value turns by the difference. Where you are, not part of the drawing:
 * never saved, and forgotten when the selection changes or history jumps.
 */

let key = "";
let degrees = 0;

const keyOf = (ids: Iterable<string>): string => [...ids].sort().join(",");

/** The running total for exactly these shapes; 0 for any other set. */
export function turnedBy(ids: Iterable<string>): number {
  return key && keyOf(ids) === key ? degrees : 0;
}

/** Adds a turn of these shapes to their total, starting a new one for a different set. */
export function addTurn(ids: Iterable<string>, by: number): void {
  const k = keyOf(ids);
  degrees = Math.round(((k === key ? degrees : 0) + by) * 100) / 100;
  key = k;
}

export function forgetTurns(): void {
  key = "";
  degrees = 0;
}
