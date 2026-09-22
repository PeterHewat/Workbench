# AGENTS.md

## Agent behavior

- Execute with tools; stay concise unless the user wants detail
- Prefer editing existing files; no secrets in code or logs
- No `git add` / `commit` / `push` unless the user asks
- Run the [format gate](#format-gate) after editing, and the [verify gate](#verify-gate) before finishing
- **Greenfield (pre-release):** Workbench is unreleased. Do **not** add backwards compatibility, migration shims, deprecated aliases, or "read the old format then rewrite" logic. When a persisted format changes, fail closed and **tell the user** to re-import or clear browser storage — do not migrate in code.

## Project conventions

- **Shape:** Bun workspaces. Apps in `apps/`, shared code in `packages/`, repo scripts in `tools/`.
- **Apps are independent and dependency-free at runtime.** Vite is a build tool, not a framework: an app compiles to plain static files that work off any file server. Do not add a runtime framework (React, Svelte, …) to an app. That rule is what keeps these tools working years from now.
- **Catalog:** `packages/catalog/src/index.ts` is the single source of truth for which apps exist. Adding an app means one entry there plus one folder under `apps/`. The index page, the build and the deploy all read it — never hand-maintain a second list.
- **Deploy path:** `packages/catalog/src/site.ts` decides it, from `WORKBENCH_BASE`. GitHub Pages serves a project site from `/<repo>/`, so apps build with `base: /Workbench/<slug>/`. Moving to a custom domain is a one-line change there, not a grep.
- **Package manager:** Bun. Do not add an npm or pnpm lockfile.
- **TypeScript:** strict, `verbatimModuleSyntax`, ESM with `.js` import specifiers. `noUncheckedIndexedAccess` is deliberately **off**: the geometry code is full of indexed loops where it buys assertions rather than safety.
- **Names:** kebab-case files; camelCase functions; PascalCase types. App slugs are lowercase and dash-separated, and match the folder name.
- **New app:** `bun run new-app <slug> "Display Name"` — it also adds an unlisted catalog entry to fill in.
- **App wiring:** an app's `vite.config.ts` is `defineConfig(workbenchApp("<slug>"))` from `@workbench/ui/vite`. It sets the base path and output folder, and injects `<title>`, description, icon and manifest from the catalog — so an app's `index.html` must not set those itself (the build fails if it does). Each app keeps its own `public/icon.svg`.
- **Offline:** apps call `registerServiceWorker()` from `@workbench/ui`. The same plugin emits `packages/ui/sw.js` into the build with a version hash and the list of files to precache, so every deploy replaces the previous cache. The worker is not registered under the dev server.

## Format gate

After editing any file Prettier or ESLint cares about, format **before** finishing the task — do not rely on `verify` alone.

| Touched paths                      | Command                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `.ts` / `.js`                      | `bunx eslint --fix <paths>` then `bunx prettier --write <paths>` |
| `.json` / `.md` / `.css` / `.html` | `bunx prettier --write <paths>`                                  |

Pass explicit paths for the files you changed, not a blind repo-wide format.

## Verify gate

| Change                   | Command          |
| ------------------------ | ---------------- |
| Any TypeScript           | `bun run check`  |
| Logic in a shared module | `bun run test`   |
| Task complete            | `bun run verify` |

`check` is lint + typecheck + format; `verify` adds tests and a full site build.

## Tests

- `bun test`, with happy-dom registered for apps that touch the DOM (see `apps/vellum/bunfig.toml`).
- Pure logic over plain data is where the tests belong — `model.ts` and `io.ts` in Vellum are the model for this.
- **`apps/vellum/src/lib/io.test.ts` guards one invariant worth understanding:** export → import → export must be byte-for-byte stable. Vellum's live SVG panel re-imports its own output whenever typing pauses, so any instability there makes shapes drift or duplicate as the user types. Do not weaken that test.

## Running it

Do not start `bun run dev <slug>` — it is probably already running. Use `bun run build` to validate.
To preview the built site locally, build with the base at the root:

```bash
WORKBENCH_BASE=/ bun run build && bunx serve dist
```

On Windows, run that from PowerShell (`$env:WORKBENCH_BASE = '/'; bun run build`) or prefix it
with `MSYS_NO_PATHCONV=1`. Git Bash rewrites the bare `/` into a Windows path and the build bakes
that in as the base, which fails quietly: the page loads and every asset 404s.

## Shell

- **Scripted edits and one-off scripts: write them in TypeScript and run with `bun`**, not Python, sed or awk. Bun is already required by this repo and behaves the same on Windows, macOS and Linux. Do not assume `python`/`python3` exists or means a real interpreter: on Windows, `python3` is often a Microsoft Store stub that fails. For a handful of edits, the Edit tool is fine.
- If a tool or command fails for an environmental reason, note the cause and switch to a portable route — do not retry variants of the same command.

Do not leave background servers running. Bounded commands (`check`, `verify`, `build`) should use a timeout with buffer. Interactive auth CLIs: ask the user to run them.
