import { defineConfig } from "vite";
import { siteBase } from "@workbench/catalog/site";

// The index page sits at the site root; each app is built into its own folder beside it.
export default defineConfig({
  base: siteBase(),
  build: {
    outDir: "../../dist",
    emptyOutDir: false,
    target: "es2022",
  },
});
