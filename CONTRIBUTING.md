# Contributing

Workbench is a set of small tools that run in the browser. A change keeps each app as static files: no runtime framework, and no runtime dependency in the shipped bundle. The decisions behind that are in [docs/adr](./docs/adr).

## Setup

Requires [Bun](https://bun.sh) 1.4.2 or newer.

```bash
bun install
bun run verify
```

`bun run verify` is lint, typecheck, format check, tests, and a full site build. CI runs those same steps. The [README](./README.md) covers `bun run dev` and the Windows note about `WORKBENCH_BASE`.

## Where to change things

- A new tool is `bun run new-app <slug> "Display Name"`. That creates `apps/<slug>` and an unlisted catalog entry. [`packages/catalog`](./packages/catalog/src/index.ts) is the only list of apps — the index, the build, and each page's title read it.
- Shared browser behaviour goes in `packages/ui`. Encoding helpers go in `packages/codec`. The catalog holds data, not app code.
- In Vellum, start with [`model.ts`](./apps/vellum/src/lib/model.ts) and [`io.ts`](./apps/vellum/src/lib/io.ts). Those are the document. [`interaction.ts`](./apps/vellum/src/lib/interaction.ts) and [`render.ts`](./apps/vellum/src/lib/render.ts) draw that document; change them when the gesture or the picture is what is wrong.

## Tests

Put a test next to the pure logic it covers, the way `model.test.ts` sits beside `model.ts`. Prefer plain data over a rendered page.

[`io.test.ts`](./apps/vellum/src/lib/io.test.ts) checks that export, then import, then export is byte-for-byte the same. The live SVG panel re-imports its own output, so an unstable serializer makes shapes drift while someone types. Leave that test as it is.

## Saved documents

Vellum is released. A drawing lives in the browser's IndexedDB (`ProjectFile`, currently version 1) and in exported SVG. A change to either keeps documents people already have opening: bump `PROJECT_VERSION` in `types.ts` and add the step up from the previous version in `readProject` (`io.ts`). Exported SVG carries no version marker, so an importer change must still read files written before it.

An app that is not released yet has no saved documents to carry forward. When its stored format changes, fail and tell the person to clear that app's storage.

## Docs

Reference docs describe the code as it is. When a doc and the code disagree, fix the doc. Intent that is not built yet goes in [`docs/plan`](./docs/plan).
