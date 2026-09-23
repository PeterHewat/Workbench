import type { WorkbenchApp } from "@workbench/catalog";
import { SITE } from "@workbench/catalog/site";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One index card. `base` is the site root, so the link is `<base><slug>/`. An app with art gets
 * its picture across the top, served from its own folder.
 */
export function cardHtml(app: WorkbenchApp, base: string): string {
  const tags = app.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const status =
    app.status === "stable"
      ? ""
      : `<span class="status status--${app.status}">${app.status}</span>`;
  const art = app.art
    ? `<img class="card-art" src="${base}${app.slug}/art.svg" alt="" width="512" height="320" loading="lazy" />`
    : "";
  return `<a class="card" href="${base}${app.slug}/">
      ${art}
      <span class="card-row">
      <span class="card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28">
          <path d="${app.icon}" fill="none" stroke="currentColor" stroke-width="1.75"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="card-body">
        <span class="card-title">${escapeHtml(app.name)}${status}</span>
        <span class="card-blurb">${escapeHtml(app.blurb)}</span>
        <ul class="card-tags">${tags}</ul>
      </span>
      </span>
    </a>`;
}

export function pageHtml(apps: readonly WorkbenchApp[], base: string): string {
  return `
    <header class="masthead">
      <button type="button" class="wb-theme-toggle" id="theme-toggle"></button>
      <h1>${escapeHtml(SITE.name)}</h1>
      <p class="tagline">${escapeHtml(SITE.tagline)}</p>
    </header>
    <main>
      ${
        apps.length
          ? `<ul class="grid">${apps.map((a) => `<li>${cardHtml(a, base)}</li>`).join("")}</ul>`
          : `<p class="empty">Nothing here yet.</p>`
      }
    </main>
    <footer>
      <p>
        Everything runs in your browser — nothing is uploaded.
        <a href="${SITE.repo}">Source on GitHub</a> · MIT
      </p>
    </footer>
  `;
}
