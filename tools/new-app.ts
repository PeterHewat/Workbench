#!/usr/bin/env bun
/**
 * Scaffolds a new app: `bun run new-app <slug> "Display Name"`.
 *
 * Creates apps/<slug> wired the same way as every other app and adds its entry to the catalog.
 * App #5 stays structured like app #1 because nobody has to remember what app #1 looked like.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CATALOG = join(ROOT, "packages", "catalog", "src", "index.ts");

const [slug, ...nameParts] = Bun.argv.slice(2);
const name = nameParts.join(" ").trim();

if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug) || slug === "home") {
  console.error('Usage: bun run new-app <slug> "Display Name"');
  console.error("  <slug> is lowercase, digits and dashes, e.g. `color-forge`");
  process.exit(1);
}
const title = name || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const dir = join(ROOT, "apps", slug);

if (existsSync(dir)) {
  console.error(`apps/${slug} already exists`);
  process.exit(1);
}

const catalog = await readFile(CATALOG, "utf8");
const listEnd = catalog.indexOf("\n];", catalog.indexOf("export const APPS"));
if (listEnd < 0) {
  console.error("Could not find the end of APPS in packages/catalog/src/index.ts");
  process.exit(1);
}
const entry = `
  {
    slug: ${JSON.stringify(slug)},
    name: ${JSON.stringify(title)},
    blurb: "One line about what it does.",
    icon: "M4 4h16v16H4z",
    tags: [],
    status: "experiment",
    listed: false,
  },`;

const files: Record<string, string> = {
  "package.json": `{
  "name": "@workbench/${slug}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "devDependencies": {
    "@workbench/ui": "workspace:*",
    "typescript": "~6.0.3",
    "vite": "^8.3.0"
  }
}
`,
  "tsconfig.json": `{
  "extends": "../../packages/tsconfig/app.json",
  "compilerOptions": {
    "types": ["vite/client", "bun"]
  },
  "include": ["src/**/*.ts", "vite.config.ts"]
}
`,
  "vite.config.ts": `import { defineConfig } from "vite";
import { workbenchApp } from "@workbench/ui/vite";

export default defineConfig(workbenchApp("${slug}"));
`,
  // Title, description, colour scheme, icon and manifest are added at build time.
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <header class="wb-header">
      <a class="wb-home" href="../">← Workbench</a>
      <h1>${title}</h1>
      <button type="button" class="wb-theme-toggle" id="theme-toggle"></button>
    </header>
    <main class="wb-main" id="app"></main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  "src/main.ts": `import { bindThemeToggle, byId, registerServiceWorker } from "@workbench/ui";
import "@workbench/ui/base.css";
import "./styles.css";

bindThemeToggle(byId("theme-toggle"));
byId("app").textContent = "Nothing here yet.";

registerServiceWorker();
`,
  "src/styles.css": `/* ${title}'s own layout. Tokens and controls come from @workbench/ui/base.css. */
`,
  "public/icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#5b8def" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/></svg>
`,
};

for (const [rel, body] of Object.entries(files)) {
  const path = join(dir, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body, "utf8");
}
await writeFile(CATALOG, catalog.slice(0, listEnd) + entry + catalog.slice(listEnd), "utf8");

console.log(`Created apps/${slug} and added it to packages/catalog/src/index.ts (unlisted).

Next:
  1. Fill in its blurb, icon and tags in the catalog; set listed: true when it is ready
  2. bun install
  3. bun run dev ${slug}
`);
