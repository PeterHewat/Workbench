/**
 * Build-time wiring every Workbench page shares, so an app's `vite.config.ts` is one line:
 *
 *     export default workbenchApp("vellum");
 *
 * From the catalog it sets the base path and output folder, writes the document `<title>`,
 * description and manifest, and emits the offline service worker with the build's file list.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { HtmlTagDescriptor, Plugin, UserConfig } from "vite";
import { findApp, type WorkbenchApp } from "@workbench/catalog";
import { SITE, appBase, siteBase } from "@workbench/catalog/site";

const SW_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "sw.js"),
  "utf8"
);

/** Served in dev instead of the real worker: it removes itself, so hot reload never sees a cache. */
const DEV_SW = "self.registration.unregister();\n";

const ICON = "icon.svg";
const MANIFEST = "manifest.webmanifest";

/** Vite config for the app at `apps/<slug>`. Fails the build if the catalog does not list it. */
export function workbenchApp(slug: string): UserConfig {
  const app = findApp(slug);
  if (!app) throw new Error(`"${slug}" is not in packages/catalog — add it there first`);
  return {
    base: appBase(slug),
    plugins: [pageHead(app), manifest(app), serviceWorker()],
    build: { outDir: `../../dist/${slug}`, emptyOutDir: true, target: "es2022" },
  };
}

/** Vite config for the index page, at the site root. Each app is built into a folder beside it. */
export function workbenchHome(): UserConfig {
  return {
    base: siteBase(),
    plugins: [pageHead(null), serviceWorker()],
    // Not emptied: the site build writes the index first, then each app into its own folder.
    build: { outDir: "../../dist", emptyOutDir: false, target: "es2022" },
  };
}

/** The web app manifest for one app, as served next to its page. */
export function manifestFor(app: WorkbenchApp): Record<string, unknown> {
  return {
    name: app.name,
    short_name: app.name,
    description: app.blurb,
    start_url: ".",
    scope: ".",
    display: "standalone",
    background_color: SITE.themeColor,
    theme_color: SITE.themeColor,
    icons: [{ src: ICON, sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}

/** The head tags a page gets from the catalog; `null` is the index page. */
export function headTags(app: WorkbenchApp | null): HtmlTagDescriptor[] {
  const title = app
    ? `${app.name} — ${SITE.name}`
    : `${SITE.name} — ${SITE.tagline.replace(/.$/, "")}`;
  const description = app ? (app.description ?? app.blurb) : SITE.description;
  const tags: HtmlTagDescriptor[] = [
    { tag: "title", children: title },
    { tag: "meta", attrs: { name: "description", content: description } },
    { tag: "meta", attrs: { name: "theme-color", content: SITE.themeColor } },
    { tag: "meta", attrs: { property: "og:title", content: title } },
    { tag: "meta", attrs: { property: "og:description", content: description } },
    { tag: "meta", attrs: { property: "og:type", content: "website" } },
    { tag: "link", attrs: { rel: "icon", href: ICON, type: "image/svg+xml" } },
  ];
  if (app) tags.push({ tag: "link", attrs: { rel: "manifest", href: MANIFEST } });
  return tags.map((t) => ({ ...t, injectTo: "head" }));
}

function pageHead(app: WorkbenchApp | null): Plugin {
  return {
    name: "workbench-page-head",
    transformIndexHtml(html) {
      // One source for the copy: a hand-written title would silently disagree with the catalog.
      if (/<title>|name="description"|rel="manifest"/.test(html)) {
        throw new Error("index.html must not set its own title, description or manifest");
      }
      return headTags(app);
    },
  };
}

function manifest(app: WorkbenchApp): Plugin {
  const body = `${JSON.stringify(manifestFor(app), null, 2)}\n`;
  return {
    name: "workbench-manifest",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? "").split("?")[0]!.endsWith(`/${MANIFEST}`)) return next();
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: MANIFEST, source: body });
    },
  };
}

function serviceWorker(): Plugin {
  let publicDir = "";
  return {
    name: "workbench-service-worker",
    // After Vite's own HTML plugin, so index.html is already in the bundle when this runs.
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? "").split("?")[0]!.endsWith("/sw.js")) return next();
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.end(DEV_SW);
      });
    },
    generateBundle(_options, bundle) {
      const hash = createHash("sha256");
      const files: string[] = [];
      for (const [name, chunk] of Object.entries(bundle)) {
        files.push(name);
        hash.update(name).update(chunk.type === "chunk" ? chunk.code : chunk.source);
      }
      for (const name of listFiles(publicDir)) {
        files.push(name);
        hash.update(name).update(readFileSync(join(publicDir, name)));
      }
      files.sort();
      const head =
        `const VERSION = ${JSON.stringify(hash.digest("hex").slice(0, 16))};\n` +
        `const PRECACHE = ${JSON.stringify(files)};\n`;
      this.emitFile({ type: "asset", fileName: "sw.js", source: head + SW_SOURCE });
    },
  };
}

function listFiles(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)).replace(/\\/g, "/"));
}
