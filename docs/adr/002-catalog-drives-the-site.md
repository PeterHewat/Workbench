# ADR-002: One catalog drives the site

**Status:** Accepted

## Context

A collection needs an index page. The obvious approach — hand-writing the index and adding a
card per app — means every new app touches several places, and the index drifts out of date the
first time one is renamed.

Separately, GitHub Pages serves a project site from `/<repo>/`, so every app has to be built with
a base path. Hard-coding that in each app's Vite config would need a grep to change.

## Decision

`packages/catalog` holds both:

- `APPS` — the list of apps, with the copy the index page needs (name, blurb, icon, tags, status).
- `siteBase()` / `appBase()` — the deploy path, read from `WORKBENCH_BASE`.

The index page renders from `APPS`. The build script iterates `APPS`. Each app's Vite config is
`workbenchApp(slug)` from `@workbench/ui/vite`, which takes the base path, page title, description
and manifest from the catalog. Nothing else keeps a list of apps, a copy of the base path, or a
copy of an app's copy.

## Consequences

- Adding an app is one catalog entry plus one folder; `bun run new-app` scaffolds the folder.
- The build fails loudly if the catalog names an app with no folder.
- Moving to a custom domain is setting `WORKBENCH_BASE=/` in the deploy workflow.
- The catalog must stay free of app code so anything can import it — it holds data, not behavior.
