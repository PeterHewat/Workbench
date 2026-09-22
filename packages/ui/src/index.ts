/** Browser helpers shared by every Workbench app. */

export * from "./dom.js";

/**
 * Registers the app's service worker so it keeps working offline.
 *
 * These are tools people return to, and several of them keep their data in the browser, so a
 * tool that needs the network to open is a worse tool. Silently does nothing where service
 * workers are unavailable (private windows, `file://`, plain http, older browsers) — the app
 * still runs. Skipped under the dev server, whose modules must never come from a cache.
 */
export function registerServiceWorker(url = "sw.js"): void {
  if (import.meta.env?.DEV) return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(url, { scope: "./" }).catch(() => {
      /* offline support is a bonus, never a hard requirement */
    });
  });
}
