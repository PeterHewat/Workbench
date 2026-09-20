import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const SW_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "sw.js"));

/** Serves and bundles the shared `sw.js` next to each app (dev, preview, and per-app build). */
export function workbenchServiceWorker(): Plugin {
  return {
    name: "workbench-service-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (!path.endsWith("/sw.js")) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.end(SW_SOURCE);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: SW_SOURCE,
      });
    },
  };
}
