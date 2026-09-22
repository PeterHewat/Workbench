import { listedApps } from "@workbench/catalog";
import { registerServiceWorker } from "@workbench/ui";
import { pageHtml } from "./render.js";
import "./home.css";

// Vite substitutes BASE_URL at build time from the `base` in vite.config.ts, which comes from
// `siteBase()`. Reading it here rather than calling siteBase() again keeps the links correct
// whatever the site was built for — a project path, or `/` behind a custom domain.
const root = document.getElementById("app");
if (root) root.innerHTML = pageHtml(listedApps(), import.meta.env.BASE_URL);

registerServiceWorker();
