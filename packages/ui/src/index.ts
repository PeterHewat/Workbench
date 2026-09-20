/** Browser helpers shared by every Workbench app. */

/**
 * Registers the app's service worker so it keeps working offline.
 *
 * These are tools people return to, and several of them keep their data in the browser, so a
 * tool that needs the network to open is a worse tool. Silently does nothing where service
 * workers are unavailable (private windows, `file://`, older browsers) — the app still runs.
 */
export function registerServiceWorker(url = "sw.js"): void {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(url, { scope: "./" }).catch(() => {
      /* offline support is a bonus, never a hard requirement */
    });
  });
}
