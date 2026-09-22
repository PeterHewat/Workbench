#!/usr/bin/env bun
/**
 * Scaffolds a new app: `bun run new-app <slug> "Display Name"`.
 *
 * Creates apps/<slug> wired the same way as every other app, then prints the catalog entry to
 * paste into packages/catalog. App #5 stays structured like app #1 because nobody has to
 * remember what app #1 looked like.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const [slug, ...nameParts] = Bun.argv.slice(2);
const name = nameParts.join(" ").trim();

if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) {
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

const files: Record<string, string> = {
  "package.json": `{
  "name": "@workbench/${slug}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "${title}",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "devDependencies": {
    "@workbench/catalog": "workspace:*",
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
import { appBase } from "@workbench/catalog/site";
import { workbenchServiceWorker } from "@workbench/ui/vite";

export default defineConfig({
  plugins: [workbenchServiceWorker()],
  base: appBase("${slug}"),
  build: {
    outDir: "../../dist/${slug}",
    emptyOutDir: true,
    target: "es2022",
  },
});
`,
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${title}" />
    <meta name="color-scheme" content="dark" />
    <link rel="manifest" href="manifest.webmanifest" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  "src/main.ts": `import { registerServiceWorker } from "@workbench/ui";

const root = document.getElementById("app");
if (root) root.textContent = "${title}";

registerServiceWorker();
`,
  "public/manifest.webmanifest": `{
  "name": "${title}",
  "short_name": "${title}",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "background_color": "#17181c",
  "theme_color": "#17181c",
  "icons": []
}
`,
};

for (const [rel, body] of Object.entries(files)) {
  const path = join(dir, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body, "utf8");
}

console.log(`Created apps/${slug}

Next:
  1. Add this to APPS in packages/catalog/src/index.ts:

  {
    slug: "${slug}",
    name: "${title}",
    blurb: "One line about what it does.",
    icon: "M4 4h16v16H4z",
    tags: [],
    status: "experiment",
    listed: true,
  },

  2. bun install
  3. bun run dev ${slug}
`);
