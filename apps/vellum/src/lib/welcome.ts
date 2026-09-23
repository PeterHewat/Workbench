/**
 * The drawing a first visit opens on, instead of an empty artboard.
 *
 * It is `public/art.svg`: the same file the index page shows across the top of Vellum's card,
 * so there is one picture to keep, not two. An isometric workbench, written as Vellum exports
 * it, whose named groups (desk, laptop, ruler, pencil, mug, plant) read like a layers list. It
 * shows polygons, arcs and Béziers, ellipses that stay ellipses when rotated, gradients, and a
 * translucent backdrop that takes on whatever is behind it, light or dark.
 */

import { importSvgFile } from "./io.js";
import { setState } from "./state.js";

export const WELCOME_NAME = "Vellum Workbench";

/**
 * In the app's own folder, addressed from its base rather than from the page, which may have been
 * reached at some other path. Precached for offline with the rest of the build.
 */
const welcomeUrl = () => `${import.meta.env.BASE_URL}art.svg`;

/** Puts the welcome drawing on the (empty) canvas. False if it could not be loaded. */
export async function loadWelcome(): Promise<boolean> {
  let imported: ReturnType<typeof importSvgFile>;
  try {
    const res = await fetch(welcomeUrl());
    if (!res.ok) return false;
    imported = importSvgFile(await res.text());
  } catch {
    // Offline before the first load, or something that is not the drawing: start empty instead.
    return false;
  }
  const { artboard, background, elements, groupNames } = imported;
  setState((s) => ({
    ...s,
    elements,
    groupNames,
    artboard: artboard ?? s.artboard,
    background: background ?? s.background,
  }));
  return true;
}
