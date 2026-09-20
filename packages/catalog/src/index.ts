/**
 * The app catalog: the single source of truth for what lives in this repo.
 *
 * Adding an app means adding one entry here and one folder under `apps/`.
 * The site index, each app's document head, and the build all read from this —
 * nothing about the list is maintained by hand in two places.
 */

export type AppStatus = "stable" | "beta" | "experiment";

export interface WorkbenchApp {
  /** URL segment and workspace folder name under `apps/`. */
  readonly slug: string;
  /** Display name. */
  readonly name: string;
  /** One line, shown on the index card and used as the meta description. */
  readonly blurb: string;
  /** Longer description for the app's own page head. Falls back to `blurb`. */
  readonly description?: string;
  /** Inline SVG path data for the index card icon, drawn on a 24x24 grid. */
  readonly icon: string;
  readonly tags: readonly string[];
  readonly status: AppStatus;
  /** Hidden from the index while false. Still built. */
  readonly listed: boolean;
}

export const APPS: readonly WorkbenchApp[] = [
  {
    slug: "vellum",
    name: "Vellum",
    blurb: "Trace reference images and export clean, pure SVG.",
    description:
      "A single-page SVG tracing editor. Place reference images, draw over them with a Bézier pen and standard shapes, then export pure SVG with no raster embedded.",
    icon: "M4 19c3-10 6-13 8-13s2 3 0 6-5 4-7 4 8 1 11-4",
    tags: ["svg", "vector", "drawing", "tracing"],
    status: "beta",
    listed: true,
  },
];

export function findApp(slug: string): WorkbenchApp | undefined {
  return APPS.find((a) => a.slug === slug);
}

export const listedApps = (): readonly WorkbenchApp[] => APPS.filter((a) => a.listed);
