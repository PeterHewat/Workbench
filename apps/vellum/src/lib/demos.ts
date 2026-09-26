/**
 * Demo drawings: a few finished pieces added to the Documents list beside the welcome drawing, to
 * show what Vellum draws and to take apart. Each is a file in `public/demos/`, written as Vellum
 * exports it, so it opens exactly as drawn: smooth curves on few points, shapes cut and joined
 * with Combine, gradients that fade out.
 *
 * This list is the one place a demo is named: its file, its name in the list, and its tags.
 */

import { importSvgFile, serializeProject } from "./io.js";
import { createInitialState } from "./state.js";
import type { ProjectFile } from "./types.js";

export interface Demo {
  /** The file in `public/demos/`, and what a browser remembers it by once added. */
  file: string;
  name: string;
  tags: string[];
}

export const DEMOS: readonly Demo[] = [
  { file: "jellyfish.svg", name: "Jellyfish", tags: ["sea", "gradient", "cute"] },
  { file: "goldfish.svg", name: "Goldfish", tags: ["fish", "gradient", "cute"] },
  { file: "starfish.svg", name: "Starfish", tags: ["sea", "outline", "cute"] },
  { file: "crab.svg", name: "Crab", tags: ["sea", "crustacean", "outline", "cute"] },
  { file: "octopus.svg", name: "Octopus", tags: ["sea", "outline", "cute"] },
];

/** The name of a demo's backdrop: the gradient behind the drawing, filling the artboard. */
export const BACKDROP_NAME = "backdrop";

/**
 * A demo's file as a document, ready to store. Its backdrop comes locked, so taking the drawing
 * apart never grabs the sea behind it; the lock is the document's, as the SVG cannot carry one.
 * Throws when the file cannot be read.
 */
export function demoDocument(svg: string): ProjectFile {
  const { artboard, background, elements, groupNames } = importSvgFile(svg);
  const base = createInitialState();
  return serializeProject({
    ...base,
    artboard: artboard ?? base.artboard,
    background: background ?? base.background,
    elements: elements.map((e) => (e.name === BACKDROP_NAME ? { ...e, locked: true } : e)),
    groupNames,
  });
}

/** Where a demo is fetched from: the app's own folder, precached for offline with the build. */
export const demoUrl = (d: Demo): string => `${import.meta.env.BASE_URL}demos/${d.file}`;

/**
 * The demos a browser has not been given yet. Added ones are remembered by file, so one that is
 * deleted stays deleted, and a demo added to this list later still reaches everyone.
 */
export function demosToAdd(given: readonly string[]): Demo[] {
  return DEMOS.filter((d) => !given.includes(d.file));
}
