#!/usr/bin/env bun
/**
 * Serves one app with hot reload: `bun run dev <slug>`, or `bun run dev home` for the index page.
 *
 * Reads the catalog, so a new app needs no script of its own. Each app is its own Vite root on
 * its own port; the index's links only resolve in a built site (see README).
 */
import { join } from "node:path";
import { APPS } from "../packages/catalog/src/index.ts";

const ROOT = join(import.meta.dir, "..");
const slugs = ["home", ...APPS.map((a) => a.slug)];
const [slug, ...rest] = Bun.argv.slice(2);

if (!slug || !slugs.includes(slug)) {
  console.error("Usage: bun run dev <app> [vite args]");
  console.error(`  <app> is one of: ${slugs.join(", ")}`);
  process.exit(1);
}

const proc = Bun.spawn(["bun", "run", "dev", ...rest], {
  cwd: join(ROOT, "apps", slug),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await proc.exited);
