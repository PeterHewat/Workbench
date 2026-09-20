import { defineConfig } from "vite";
import { appBase } from "@workbench/catalog/site";
import { workbenchServiceWorker } from "@workbench/ui/vite";

// Built into `dist/vellum/` so the site build can drop every app next to the index page.
export default defineConfig({
  plugins: [workbenchServiceWorker()],
  base: appBase("vellum"),
  build: {
    outDir: "../../dist/vellum",
    emptyOutDir: true,
    target: "es2022",
  },
});
