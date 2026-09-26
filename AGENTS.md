# AGENTS.md

## Agent behavior

- Execute with tools; stay concise unless the user wants detail
- Prefer editing existing files; no secrets in code or logs
- No `git add` / `commit` / `push` unless the user asks
- Branch or PR work follows [Git](#git)
- Run the [format gate](#format-gate) after editing, and the [verify gate](#verify-gate) before finishing
- **Saved formats:** Vellum is released. A change to its IndexedDB documents (`ProjectFile`) or exported SVG keeps existing files opening: bump `PROJECT_VERSION` (`types.ts`) and add the step up from the previous version in `readProject` (`io.ts`); the database's own `DB_VERSION` (`storage.ts`) is for its stores. Exported SVG carries no marker, so an SVG change must still import files written before it. An app that is not released yet has no migration — when its stored format changes, fail closed and tell the person to clear that app's storage.

## Project conventions

- **Shape:** Bun workspaces. Apps in `apps/`, shared code in `packages/`, repo scripts in `tools/`.
- **Apps are independent and dependency-free at runtime.** Vite is a build tool, not a framework: an app compiles to plain static files that work off any file server. Do not add a runtime framework (React, Svelte, …) to an app. That rule is what keeps these tools working years from now.
- **Catalog:** `packages/catalog/src/index.ts` is the single source of truth for which apps exist. Adding an app means one entry there plus one folder under `apps/`. The index page, the build and the deploy all read it — never hand-maintain a second list. An entry with `art: true` ships `apps/<slug>/public/art.svg` (512 × 320, translucent or no background so it suits both themes), shown across the top of its index card.
- **Deploy path:** `packages/catalog/src/site.ts` decides it, from `WORKBENCH_BASE`. GitHub Pages serves a project site from `/<repo>/`, so apps build with `base: /Workbench/<slug>/`. Moving to a custom domain is a one-line change there, not a grep.
- **Package manager:** Bun. Do not add an npm or pnpm lockfile.
- **TypeScript:** strict, `verbatimModuleSyntax`, ESM with `.js` import specifiers. `noUncheckedIndexedAccess` is deliberately **off**: the geometry code is full of indexed loops where it buys assertions rather than safety.
- **Names:** kebab-case files; camelCase functions; PascalCase types. App slugs are lowercase and dash-separated, and match the folder name.
- **New app:** `bun run new-app <slug> "Display Name"` — it also adds an unlisted catalog entry to fill in.
- **App wiring:** an app's `vite.config.ts` is `defineConfig(workbenchApp("<slug>"))` from `@workbench/ui/vite`. It sets the base path and output folder, and injects `<title>`, description, icon and manifest from the catalog — so an app's `index.html` must not set those itself (the build fails if it does). Each app keeps its own `public/icon.svg`.
- **Light / dark:** every page follows the browser until someone presses a theme switch; from then on the choice (`workbench.theme` in localStorage, shared by the whole site) is light or dark, never "system" again. The Vite plugin inlines a script that applies it before first paint. Colours are CSS custom properties with a dark base and a light override keyed on `prefers-color-scheme` and `<html data-theme>` (see `packages/ui/base.css`); an app adds a button and calls `bindThemeToggle(button)` from `@workbench/ui`, and repaints anything drawn outside CSS (a canvas) on `THEME_EVENT`.
- **Offline:** apps call `registerServiceWorker()` from `@workbench/ui`. The same plugin emits `packages/ui/sw.js` into the build with a version hash and the list of files to precache, so every deploy replaces the previous cache. The worker is not registered under the dev server.

## Git

GitHub protects the default branch (`main`) with an active ruleset: pull requests only (squash merge), linear history, required CI (“Lint, typecheck, test, build”), and related checks. Do not commit or push on `main`; land changes with a PR from a feature branch.

Before changing code — on any branch, not only `main` — and whenever the user asks to create a branch, open or update a pull request, or push for review:

1. **Inspect first** — `git fetch origin`, then the current branch, clean or dirty tree, upstream tracking, and ahead/behind vs upstream and vs `origin/main`. Say what you found if it affects the plan.
2. **Check the branch is still open** — on a feature branch, ask GitHub whether its PR was already merged (`gh pr list --head <branch> --state all`). A squash-merged branch is finished: its commits reach `main` as one new commit with a different hash, so git no longer recognises them. Never add work to it or merge `origin/main` into it — both replay the merged changes as conflicts. Start a new branch from refreshed `main` instead, and carry over only commits made after the merge (`git rebase --onto origin/main <last-merged-commit>`, or `git cherry-pick`).
3. **Use a feature branch** — if the checkout is `main`, propose a concrete branch name (kebab-case, short and descriptive — e.g. `agents-git-sync`, `vellum-export-fix`) and create/check it out before edits or commits unless the user already named a branch.
4. **Refresh `main`** — do not assume local `main` matches GitHub. Fast-forward it from `origin/main` (`git pull --ff-only origin main` while on `main`) before branching off it. Refreshing `main` never adds commits to it.
5. **Base the feature branch on current `main`** — before the first push, put work on top of `origin/main` (rebase while the branch is local-only; once it is on the remote, merge `origin/main`, or rebase only if the user accepts the force-push). Do not open a PR against a stale base and patch it up later with a merge commit.
6. **PR diffs use remote `main`** — compare against `origin/main` (`git log origin/main..HEAD`, `git diff origin/main...HEAD`), never a local `main` that may be stale. Before pushing, check that list holds only this branch's commits.

Default integration branch is `main`; use another base only when the user names one.

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
