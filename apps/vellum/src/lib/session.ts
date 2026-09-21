/**
 * What belongs to this tab rather than to the document: where you were looking, and which
 * panels were open.
 *
 * Reloading the page used to drop all of it - the artboard jumped back to a fitted view and the
 * panels closed - because none of it is part of the drawing. It is not part of the drawing here
 * either: it lives in `sessionStorage`, so a refresh puts you back exactly where you were while
 * a new tab still starts clean, and nothing follows the document when it is exported or shared.
 */

import type { Viewport } from "./types.js";

const KEY = "vellum.view";

export interface SessionView {
  /** The document the viewport belongs to: another document deserves its own fitted view. */
  docId: string | null;
  viewport: Viewport | null;
  docPanel: boolean;
  help: boolean;
}

const EMPTY: SessionView = { docId: null, viewport: null, docPanel: false, help: false };

function isViewport(v: unknown): v is Viewport {
  const p = v as Viewport | null;
  return (
    !!p &&
    typeof p.panX === "number" &&
    typeof p.panY === "number" &&
    typeof p.zoom === "number" &&
    Number.isFinite(p.panX) &&
    Number.isFinite(p.panY) &&
    p.zoom > 0
  );
}

export function readSessionView(): SessionView {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<SessionView>;
    return {
      docId: typeof parsed.docId === "string" ? parsed.docId : null,
      viewport: isViewport(parsed.viewport) ? parsed.viewport : null,
      docPanel: parsed.docPanel === true,
      help: parsed.help === true,
    };
  } catch {
    // Private windows and blocked site data both throw here; a lost view is not worth a failure.
    return { ...EMPTY };
  }
}

export function writeSessionView(patch: Partial<SessionView>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...readSessionView(), ...patch }));
  } catch {
    /* not remembered */
  }
}
