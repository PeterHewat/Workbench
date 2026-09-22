#!/usr/bin/env bun
/**
 * Builds the whole site into `dist/`: the index page at the root, then one folder per app.
 *
 * Apps come from the catalog, so adding one to `packages/catalog` is all it takes to get it
 * built and listed. Each app's own Vite build emits the shared service worker into its folder
 * (see `@workbench/ui/vite`), since a worker only controls the scope it is served from.
 */
import { rm, mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APPS } from "../packages/catalog/src/index.ts";
import { siteBase } from "../packages/catalog/src/site.ts";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

async function run(cmd: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed in ${cwd} (exit ${code})`);
}

async function main(): Promise<void> {
  console.log(`Building site at base ${siteBase()}`);
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // The index page first: it writes into dist/ with emptyOutDir off, so app folders survive.
  await run(["bun", "run", "build"], join(ROOT, "apps", "home"));

  for (const app of APPS) {
    const dir = join(ROOT, "apps", app.slug);
    if (!existsSync(dir)) {
      throw new Error(`Catalog lists "${app.slug}" but apps/${app.slug} does not exist`);
    }
    console.log(`\n→ ${app.name}`);
    await run(["bun", "run", "build"], dir);
  }

  // GitHub Pages serves 404.html for unknown paths; point it at the index.
  await copyFile(join(DIST, "index.html"), join(DIST, "404.html"));

  const entries = await readdir(DIST);
  console.log(`\nBuilt ${APPS.length} app(s) + index into dist/ (${entries.length} entries)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
